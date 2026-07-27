import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix, relative } from "node:path";
import {
  AUTO_MEMORY_MAX_BYTES,
  AUTO_MEMORY_MAX_LINES,
} from "../adapters/claude-code/constants.js";
import { logger } from "../logger.js";
import {
  foldRollup,
  type SkillMetricRow,
  summarize,
  writeRollup,
} from "../metrics/rollup.js";
import { readNote } from "../note.js";
import {
  absolutePath,
  learningsPath,
  readGenreOverrides,
  resolveDocsRoot,
} from "../paths.js";
import { type ScannedNote, scanNotes } from "../scan.js";
import { type Genre, genreOf } from "../scanner/genre-map.js";
import {
  GEN_MARKER,
  TARGET_AGENT_DIRS,
  WING_PREFIX,
} from "../skills-shared.js";

/**
 * Section cap for the generated "Governing decisions" list (ADR-0041 §4).
 * The auto-memory ceiling (lines/bytes) is a whole-file backstop that cannot
 * engage until ~164 entries, which is far past the point where a wall of ADR
 * links stops being contextual recall. The 12 MOST RECENT (highest-numbered)
 * are kept; the rest fold into one "…and N more in decisions/" pointer.
 */
const MAX_GOVERNING_LINES = 12;

/** Note types worth surfacing as the auto-loaded "nudge" for a wing. */
const NUDGE_TYPES = new Set([
  "playbook",
  "gotcha",
  "interface",
  "tooling",
  "relationship",
  "topology",
]);

export interface SkillsOptions {
  dir?: string;
  /** Read-only context-match metrics mode (ADR-0016 §1). Never regenerates skills. */
  metrics?: boolean;
  /** Emit the metric rows as JSON instead of the plain-text table (metrics mode only). */
  json?: boolean;
  /** Silent fold (the Stop-hook path): fold + write the rollup, print nothing. */
  quiet?: boolean;
}

export interface SkillsResult {
  repo: string;
  wings: string[];
  /** Generated `mage-wing-*` skill paths. */
  written: string[];
  /** Advisory metric rows (metrics mode only; absent for skill generation). */
  metricsRows?: SkillMetricRow[];
}

interface GoverningAdr {
  adrNum: number;
  relPath: string;
  repoRelPath: string;
  title: string;
}

/**
 * Generate one auto-loaded skill per wing (ADR-0006). Each wing skill is the
 * wing's procedural entry point: it points at the wing's index + notes and
 * surfaces its playbooks/gotchas. Written into project-local agent skill dirs
 * and marked GENERATED so regeneration never clobbers hand-authored skills.
 */
export async function skills(opts: SkillsOptions = {}): Promise<SkillsResult> {
  const start = absolutePath(opts.dir ?? process.cwd());
  if (opts.metrics) return skillsMetrics(start, opts);

  const resolved = await resolveDocsRoot(start);
  if (!resolved) {
    throw new Error(
      `No mage knowledge base found at or above ${start}. Run \`mage init\` first.`,
    );
  }
  const { root, repo } = resolved;
  const docsRel = toRel(relative(repo, root));
  const genreOverrides = await readGenreOverrides(resolved);

  const notes = await scanNotes(root);
  const noteMap = new Map<string, ScannedNote>();
  for (const n of notes) noteMap.set(n.relPath, n);
  const wikiResolver = makeWikiResolver(notes.map((n) => n.relPath));

  // Wings are the UNION of every note's tag-wings; a multi-homed note's skill is
  // cross-listed into each tagged wing (consistency with `mage index`, ADR-0012 §5).
  const wings = [
    ...new Set(notes.flatMap((n) => n.wings.map((w) => w.wing))),
  ].sort();

  const written: string[] = [];
  for (const base of TARGET_AGENT_DIRS) {
    const skillsRoot = join(repo, base);
    await cleanGeneratedWingSkills(skillsRoot, wings);
    for (const wing of wings) {
      const dir = join(skillsRoot, `${WING_PREFIX}${wing}`);
      await mkdir(dir, { recursive: true });
      const wingNotes = notes.filter((n) =>
        n.wings.some((w) => w.wing === wing),
      );
      const governing = await collectGoverningDecisions(
        root,
        wingNotes,
        noteMap,
        wikiResolver,
        docsRel,
        genreOverrides,
      );
      await writeFile(
        join(dir, "SKILL.md"),
        renderWingSkill(wing, wingNotes, docsRel, governing),
      );
      written.push(join(base, `${WING_PREFIX}${wing}`, "SKILL.md"));
    }
  }

  if (wings.length === 0) {
    logger.warn(
      "No wings found (no notes tagged `#<wing>/...`). Nothing to generate.",
    );
  } else {
    logger.success(
      `Generated ${wings.length} wing skill(s) × ${TARGET_AGENT_DIRS.length} target dir(s).`,
    );
    for (const w of written) logger.detail(w);
  }
  return { repo, wings, written };
}

/**
 * Read-only context-match metrics (ADR-0016 §1). This is ALSO the Stop-hook path
 * (`mage skills --metrics --quiet`), so the fold MUST NEVER throw to the host: the
 * whole branch — including resolveDocsRoot, which can reject on fs errors — fails
 * open. metrics mode is READ-ONLY: it never regenerates wing skills.
 *
 *  - no KB found → print "No knowledge base found." (unless --quiet) and return empty.
 *  - --quiet     → fold + write the rollup silently (no output): the Stop fold.
 *  - --json      → print the summarized rows as JSON.
 *  - else        → print a plain-text table (or the empty-state line).
 */
async function skillsMetrics(
  start: string,
  opts: SkillsOptions,
): Promise<SkillsResult> {
  const resolved = await resolveDocsRoot(start).catch(() => null);
  if (!resolved) {
    if (!opts.quiet) logger.info("No knowledge base found.");
    return { repo: start, wings: [], written: [], metricsRows: [] };
  }
  const { root, repo } = resolved;

  // Fold + write are wrapped so the Stop hook survives ANY fs/parse error.
  let rows: SkillMetricRow[] = [];
  try {
    const learningsDir = learningsPath(root);
    const rollup = await foldRollup(root, learningsDir, repo);
    await writeRollup(root, rollup);
    rows = summarize(rollup);
  } catch {
    /* fail-open: the Stop-hook metrics fold must never break the host */
  }

  if (opts.quiet) return { repo, wings: [], written: [], metricsRows: rows };
  if (opts.json) console.log(JSON.stringify(rows, null, 2));
  else renderMetricsTable(rows);
  return { repo, wings: [], written: [], metricsRows: rows };
}

/** Plain-text advisory table (worst-first), mirroring `mage list`'s table style. */
function renderMetricsTable(rows: SkillMetricRow[]): void {
  if (rows.length === 0) {
    logger.info("No skill-load metrics yet.");
    return;
  }
  const skillWidth = Math.max(5, ...rows.map((r) => r.skill.length));
  const header = `${"SKILL".padEnd(skillWidth)}  LOADS  MATCH-RATE  STATUS`;
  logger.info(header);
  logger.detail("─".repeat(header.length));
  for (const r of rows) {
    const rate = `${(r.matchRate * 100).toFixed(0)}%`;
    logger.info(
      `${r.skill.padEnd(skillWidth)}  ${String(r.loads).padStart(5)}  ${rate.padStart(10)}  ${r.status}`,
    );
    logger.detail(
      `dims paths=${r.dims.paths} keywords=${r.dims.keywords} wing=${r.dims.wing}`,
    );
  }
}

function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

const MD_TARGET = String.raw`([^)\s]+\.md)(?:#[^)\s]*)?`;
const LINK_RE = new RegExp(String.raw`\]\(${MD_TARGET}\)`, "g");

function isExternal(target: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function extractLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1]?.trim();
    if (target && !isExternal(target)) out.push(target);
  }
  return out;
}

const WIKI_TARGET = String.raw`\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]`;
const WIKI_RE = new RegExp(WIKI_TARGET, "g");

function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(WIKI_RE)) {
    const target = m[1]?.trim();
    if (target) out.push(target);
  }
  return out;
}

function makeWikiResolver(
  noteRelPaths: string[],
): (target: string) => string | null {
  const byPath = new Set(noteRelPaths);
  const byName = new Map<string, string[]>();
  for (const rel of noteRelPaths) {
    const name = posix.basename(rel, ".md");
    const hits = byName.get(name);
    if (hits) hits.push(rel);
    else byName.set(name, [rel]);
  }
  return (target: string): string | null => {
    const norm = target.replace(/\\/g, "/");
    const withExt = norm.endsWith(".md") ? norm : `${norm}.md`;
    if (byPath.has(withExt)) return withExt;
    const name = posix.basename(norm, ".md");
    const hits = byName.get(name);
    if (!hits || hits.length === 0) return null;
    return hits[0] ?? null;
  };
}

/**
 * Harvest the wing's governing ADRs from the link graph (ADR-0041 §4).
 *
 * SOURCES are memory-genre notes ONLY: per ADR-0041 §4, per-ADR recall rides
 * *linking memories* — the small note that carries the recallable one-liner and
 * links to its ADR. Decision, work, and doc notes are never harvest sources;
 * harvesting from them would re-derive the whole ADR corpus (every ADR's own
 * `## Relations` section links its neighbours), which is exactly the always-on
 * dump this ADR set out to delete.
 *
 * TARGET classification rides frontmatter `type:` only (ADR-0011 — folders are
 * conventions), with the per-KB `genres` overrides threaded through so a custom
 * type mapped onto the decision genre is recognized.
 */
async function collectGoverningDecisions(
  root: string,
  wingNotes: ScannedNote[],
  noteMap: Map<string, ScannedNote>,
  wikiResolver: (target: string) => string | null,
  docsRel: string,
  overrides: Record<string, Genre> = {},
): Promise<GoverningAdr[]> {
  const adrMap = new Map<string, GoverningAdr>();

  for (const note of wingNotes) {
    if (genreOf(note.type, overrides) !== "memory") continue;

    let body: string;
    try {
      const parsed = await readNote(join(root, note.relPath));
      body = parsed.body;
    } catch {
      continue;
    }

    const stripped = stripCode(body);
    const mdLinks = extractLinks(stripped);
    const wikiLinks = extractWikiLinks(stripped);

    const resolvedRelPaths = new Set<string>();

    for (const link of mdLinks) {
      const res = posix.normalize(
        posix.join(posix.dirname(note.relPath), link),
      );
      if (noteMap.has(res)) {
        resolvedRelPaths.add(res);
      }
    }

    for (const link of wikiLinks) {
      const res = wikiResolver(link);
      if (res && noteMap.has(res)) {
        resolvedRelPaths.add(res);
      }
    }

    for (const targetRelPath of resolvedRelPaths) {
      const targetNote = noteMap.get(targetRelPath);
      if (!targetNote) continue;

      // Genre rides frontmatter `type:` only — never the folder (ADR-0011).
      if (genreOf(targetNote.type, overrides) !== "decision") continue;
      if (targetNote.status !== "accepted" && targetNote.status !== "active")
        continue;

      if (!adrMap.has(targetRelPath)) {
        const base = posix.basename(targetRelPath);
        const m = base.match(/^(\d+)/) || targetNote.title.match(/^(\d+)/);
        const adrNumStr = m ? m[1] : "";
        const adrNum = adrNumStr
          ? parseInt(adrNumStr, 10)
          : Number.MAX_SAFE_INTEGER;
        const repoRelPath =
          docsRel === "." ? targetRelPath : `${docsRel}/${targetRelPath}`;

        let displayTitle = targetNote.title;
        if (adrNumStr && !/^\d+/.test(displayTitle)) {
          displayTitle = `${adrNumStr} — ${displayTitle}`;
        }

        adrMap.set(targetRelPath, {
          adrNum,
          relPath: targetRelPath,
          repoRelPath,
          title: displayTitle,
        });
      }
    }
  }

  const list = Array.from(adrMap.values());
  list.sort((a, b) => {
    if (a.adrNum !== b.adrNum) return a.adrNum - b.adrNum;
    return a.relPath.localeCompare(b.relPath);
  });

  return list;
}

function renderWingSkill(
  wing: string,
  notes: ScannedNote[],
  docsRel: string,
  governing: GoverningAdr[] = [],
): string {
  const indexPath = docsRel === "." ? "INDEX.md" : `${docsRel}/INDEX.md`;
  const wingIndex =
    docsRel === "." ? `_index.${wing}.md` : `${docsRel}/_index.${wing}.md`;
  const nudges = notes.filter((n) => NUDGE_TYPES.has(n.type)).slice(0, 10);

  const buildContent = (
    govList: GoverningAdr[],
    truncatedCount: number,
  ): string => {
    const out: string[] = [
      "---",
      `name: ${WING_PREFIX}${wing}`,
      `description: Knowledge and procedures for the ${wing} wing of this repo's mage knowledge base — playbooks, gotchas, interfaces, and where to find more. Load when working on ${wing}.`,
      "---",
      "",
      GEN_MARKER,
      "",
      `# ${wing}`,
      "",
      `Procedural entry point for the **${wing}** wing. mage notes hold the facts; this skill points you at them and surfaces the ${wing}-specific procedures and gotchas so you don't repeat mistakes.`,
      "",
      "## Where the knowledge is",
      "",
      `- Start at the index: \`${indexPath}\` — this wing's detail lives in \`${wingIndex}\` when the index is hierarchical.`,
      "- Open only the notes a task touches; follow their `[text](path.md)` links.",
      "- Treat notes as point-in-time: verify `status: stale-suspect` or stale `last_reviewed` notes against the current code before relying on them.",
      "",
    ];
    if (nudges.length > 0) {
      out.push(`## ${wing} playbooks & gotchas`, "");
      for (const n of nudges)
        out.push(`- \`${n.type}\` ${n.title} — \`${n.relPath}\``);
      out.push("");
    } else {
      out.push(
        `_No playbook/gotcha/interface notes tagged \`#${wing}\` yet — capture them with \`mage:learn\`._`,
        "",
      );
    }
    out.push(
      "## Capture",
      "",
      "When you learn something durable in this wing, capture it with `mage:learn` (insight + procedure + pointers — never a copy of the source), then run `mage index` and `mage skills`.",
      "",
    );

    if (governing.length > 0) {
      out.push("## Governing decisions", "");
      for (const g of govList) {
        out.push(`- [${g.title}](${g.repoRelPath})`);
      }
      if (truncatedCount > 0) {
        out.push(`- …and ${truncatedCount} more in decisions/`);
      }
      out.push("");
    }

    const joined = out.join("\n");
    let end = joined.length;
    while (end > 0 && joined[end - 1] === "\n") end--;
    return `${joined.slice(0, end)}\n`;
  };

  // Section cap FIRST (ADR-0041 §4): keep the MAX_GOVERNING_LINES most recent
  // (highest-numbered) decisions. The auto-memory ceiling below stays as the
  // whole-file backstop, but it cannot engage until ~164 entries.
  const capped =
    governing.length > MAX_GOVERNING_LINES
      ? governing.slice(governing.length - MAX_GOVERNING_LINES)
      : governing;
  let content = buildContent(capped, governing.length - capped.length);

  const checkBreach = (text: string) => {
    const lines = text.split("\n").length;
    const bytes = Buffer.byteLength(text, "utf8");
    return lines > AUTO_MEMORY_MAX_LINES || bytes > AUTO_MEMORY_MAX_BYTES;
  };

  if (checkBreach(content) && capped.length > 0) {
    for (let k = capped.length - 1; k >= 0; k--) {
      // Keep the k MOST RECENT (highest-numbered) decisions; drop the oldest first.
      const candidate = buildContent(
        capped.slice(capped.length - k),
        governing.length - k,
      );
      if (!checkBreach(candidate) || k === 0) {
        content = candidate;
        break;
      }
    }
  }

  return content;
}

async function cleanGeneratedWingSkills(
  skillsRoot: string,
  keepWings: string[],
): Promise<void> {
  const keep = new Set(keepWings.map((w) => `${WING_PREFIX}${w}`));
  let entries: Dirent[];
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(WING_PREFIX) || keep.has(e.name))
      continue;
    const skillFile = join(skillsRoot, e.name, "SKILL.md");
    try {
      const content = await readFile(skillFile, "utf8");
      if (content.includes(GEN_MARKER))
        await rm(join(skillsRoot, e.name), { recursive: true, force: true });
    } catch {
      /* leave dirs that aren't ours */
    }
  }
}

function toRel(p: string): string {
  return p === "" ? "." : p.split(/[\\/]/).join("/");
}
