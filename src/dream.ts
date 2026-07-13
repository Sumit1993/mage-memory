import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { isCcShaped } from "./adapters/claude-code/cc-note.js";
import { type Note, readNote } from "./note.js";
import { type HubMetadata, PROJECTS_DIR, exists } from "./paths.js";
import { type ScannedNote, scanNotes } from "./scan.js";

/**
 * `mage dream` — read-only knowledge-base health.
 *
 * The v0.1 slice of the maintenance pass (CONTEXT.md "Dream"): deterministic,
 * zero-LLM, no mutation. It *reports* rot — it does not heal it. The healing
 * sweep (decay / consolidate / re-verify / prune) is the v0.2 `/dream` skill,
 * which needs judgment (ADR-0007). Everything here is pure filesystem +
 * frontmatter + the note graph, so the same KB always yields the same findings.
 */

export interface DreamOptions {
  /** Reference "now" for staleness (injectable for deterministic tests). */
  now?: Date;
  /** Flag notes whose `last_reviewed` is older than this many days. */
  staleDays?: number;
  /** Hub registry, when scanning a hub — enables the project drift signals. */
  hubMeta?: HubMetadata | null;
}

/** A base needs at least this many untagged notes (and ≥25% of the total) to earn a nudge. */
const UNTAGGED_NUDGE_MIN = 5;

export interface DreamFinding {
  /** Note relpath (relative to the docs root). */
  note: string;
  detail: string;
}

export interface DreamReport {
  root: string;
  noteCount: number;
  /** A note marked superseded by an edge but still `status: active` (full supersession only). */
  supersededButActive: DreamFinding[];
  /** A relative markdown link whose target file does not exist. */
  danglingLinks: DreamFinding[];
  /** A note with no graph edges in or out. */
  orphans: DreamFinding[];
  /** Missing, unparseable, or older-than-threshold `last_reviewed`. */
  stale: DreamFinding[];
  /** True iff every (failure-tier) finding list is empty. INFO drift below is excluded. */
  clean: boolean;
  // ─── info-tier drift (advisory, NEVER affects `clean`; ADR-0011 §7, ADR-0012 §7) ───
  /** Registered hub-owned projects with zero indexed notes (the silent-empty trap). */
  emptyProjects: string[];
  /** On-disk `projects/<name>/` dirs absent from the hub registry. */
  unregisteredProjectDirs: string[];
  /** A gentle suggestion when many notes are untagged (wings are optional). */
  untaggedNudge: string[];
}

const MS_PER_DAY = 86_400_000;
/** Relation verbs that assert a *full* supersession (partial `revises` is deliberately excluded). */
const SUPERSEDES = "supersedes";
const SUPERSEDED_BY = "superseded_by";

/** Strip fenced + inline code so example links like `[x](x.md)` are never treated as real. */
function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/**
 * A `.md` link target plus an optional `#heading` fragment. The fragment is matched but
 * NOT captured: `plan.md#the-autonomy-track` addresses a section of a file whose existence
 * is still decided by `plan.md` alone.
 */
const MD_TARGET = String.raw`([^)\s]+\.md)(?:#[^)\s]*)?`;
const LINK_RE = new RegExp(String.raw`\]\(${MD_TARGET}\)`, "g");

/**
 * An external target is not a path on disk. `https://github.com/e2b-dev/infra/blob/main/self-host.md`
 * ends in `.md`, but resolving it against the linking note yields nonsense, so it must never
 * reach the exists() check.
 */
function isExternal(target: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

/** All *local* markdown links to `.md` targets, fragment stripped. */
function extractLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1]?.trim();
    if (target && !isExternal(target)) out.push(target);
  }
  return out;
}

/**
 * An Obsidian wikilink: `[[target]]`, `[[target#heading]]`, `[[target^block]]`,
 * `[[target|alias]]`, `[[dir/target]]`. Only the target is captured. A same-file link
 * (`[[#heading]]`) has an empty target and is deliberately not matched.
 */
const WIKI_TARGET = String.raw`\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]`;
const WIKI_RE = new RegExp(WIKI_TARGET, "g");

/** All wikilink targets, alias + fragment stripped. */
function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(WIKI_RE)) {
    const target = m[1]?.trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * Typed relation bullets, in either link form:
 *   `- supersedes [text](target.md)`   ·   `- supersedes [[target]]`
 */
const REL_RE = new RegExp(
  String.raw`^[-*]\s+([A-Za-z_]\w*)\s+(?:\[[^\]]*\]\(${MD_TARGET}\)|${WIKI_TARGET})`,
);
interface Relation {
  verb: string;
  target: string;
  /** Wikilinks resolve by name across the vault; markdown links resolve relative to the note. */
  wiki: boolean;
}
function extractRelations(body: string): Relation[] {
  const out: Relation[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(REL_RE);
    const verb = m?.[1];
    if (!verb) continue;
    const mdTarget = m[2]?.trim();
    const wikiTarget = m[3]?.trim();
    if (mdTarget && !isExternal(mdTarget)) out.push({ verb, target: mdTarget, wiki: false });
    else if (wikiTarget) out.push({ verb, target: wikiTarget, wiki: true });
  }
  return out;
}

/** Resolve a link target (relative to the linking note) to a root-relative posix path. */
function resolveRel(noteRel: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(noteRel), target));
}

/**
 * A wikilink addresses a note by NAME, not by path — `[[0011-engine-is-library]]` resolves from
 * anywhere in the vault. Obsidian also accepts a folder-qualified form, so try the literal path
 * first and fall back to the basename index. Ties break on the shortest path, then
 * lexicographically, so a resolution never depends on scan order. Returns null when no note
 * carries that name (a dead wikilink).
 */
function makeWikiResolver(noteRelPaths: string[]): (target: string) => string | null {
  const byPath = new Set(noteRelPaths);
  const byName = new Map<string, string[]>();
  for (const rel of noteRelPaths) {
    const name = posix.basename(rel, ".md");
    const hits = byName.get(name);
    if (hits) hits.push(rel);
    else byName.set(name, [rel]);
  }
  for (const hits of byName.values()) {
    hits.sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1));
  }
  return (target) => {
    const withExt = target.toLowerCase().endsWith(".md") ? target : `${target}.md`;
    if (byPath.has(withExt)) return withExt;
    return byName.get(posix.basename(withExt, ".md"))?.[0] ?? null;
  };
}

function isActive(status: string | undefined): boolean {
  return !status || status === "active";
}

function byNote(a: DreamFinding, b: DreamFinding): number {
  if (a.note !== b.note) return a.note < b.note ? -1 : 1;
  return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
}

export async function analyzeDream(root: string, opts: DreamOptions = {}): Promise<DreamReport> {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? 180;

  // dream works by relPath, not by wing. Multi-home (ADR-0012 §5) keys a note's
  // wings on one ScannedNote row, so there is no duplication today — but de-dup
  // defensively by relPath so the by-relPath model holds regardless of how the
  // scanner represents wings.
  const raw = await scanNotes(root);
  const deduped = [...new Map(raw.map((s) => [s.relPath, s])).values()];

  // Read each note body once (scan already gave us status/lastReviewed/title), and
  // drop UNGROOMED CAPTURES while we have the frontmatter: Gate-0/adopt place native
  // memories (`metadata.node_type: memory`) at the docs-root top as an inbox awaiting
  // `mage groom` (ADR-0032/0034). They are not notes yet — counting them as orphans,
  // stale, or untagged is pure noise, so they never enter the health scan.
  const bodies = new Map<string, string>();
  const scanned: ScannedNote[] = [];
  for (const s of deduped) {
    let note: Note | null = null;
    try {
      note = await readNote(join(root, s.relPath));
    } catch {
      note = null;
    }
    if (note && isCcShaped(note.frontmatter)) continue;
    scanned.push(s);
    bodies.set(s.relPath, note?.body ?? "");
  }
  const noteSet = new Set(scanned.map((s) => s.relPath));
  const statusOf = new Map(scanned.map((s) => [s.relPath, s.status]));

  const danglingLinks: DreamFinding[] = [];
  const supersededButActive: DreamFinding[] = [];
  const hasOut = new Set<string>();
  const hasIn = new Set<string>();

  const resolveWiki = makeWikiResolver(scanned.map((s) => s.relPath));

  for (const s of scanned) {
    const body = stripCode(bodies.get(s.relPath) ?? "");

    for (const target of extractLinks(body)) {
      const resolved = resolveRel(s.relPath, target);
      if (!(await exists(join(root, resolved)))) {
        danglingLinks.push({ note: s.relPath, detail: `link → ${target} (target missing)` });
        continue;
      }
      if (noteSet.has(resolved)) {
        hasOut.add(s.relPath);
        hasIn.add(resolved);
      }
    }

    // Wikilinks are first-class edges: an Obsidian vault (and mage's own note format) wires
    // notes together with `[[name]]` as often as with a relative path. Reading only markdown
    // links makes a densely-linked note look like an orphan.
    for (const target of extractWikiLinks(body)) {
      const resolved = resolveWiki(target);
      if (!resolved) {
        danglingLinks.push({ note: s.relPath, detail: `link → [[${target}]] (target missing)` });
        continue;
      }
      hasOut.add(s.relPath);
      hasIn.add(resolved);
    }

    for (const { verb, target, wiki } of extractRelations(body)) {
      if (verb === SUPERSEDED_BY && isActive(statusOf.get(s.relPath))) {
        supersededButActive.push({
          note: s.relPath,
          detail: `superseded_by ${target}, but status is active`,
        });
      } else if (verb === SUPERSEDES) {
        const resolved = wiki ? resolveWiki(target) : resolveRel(s.relPath, target);
        if (resolved && noteSet.has(resolved) && isActive(statusOf.get(resolved))) {
          supersededButActive.push({
            note: resolved,
            detail: `superseded by ${s.relPath}, but status is active`,
          });
        }
      }
    }
  }

  const orphans: DreamFinding[] = scanned
    .filter((s) => !hasOut.has(s.relPath) && !hasIn.has(s.relPath))
    .map((s) => ({ note: s.relPath, detail: "no links in or out" }));

  const stale: DreamFinding[] = [];
  for (const s of scanned) {
    if (!s.lastReviewed) {
      stale.push({ note: s.relPath, detail: "no last_reviewed date" });
      continue;
    }
    const d = new Date(s.lastReviewed);
    if (Number.isNaN(d.getTime())) {
      stale.push({ note: s.relPath, detail: `unparseable last_reviewed: ${s.lastReviewed}` });
      continue;
    }
    const ageDays = Math.floor((now.getTime() - d.getTime()) / MS_PER_DAY);
    if (ageDays > staleDays) {
      stale.push({
        note: s.relPath,
        detail: `last reviewed ${s.lastReviewed} (${ageDays}d ago, > ${staleDays}d)`,
      });
    }
  }

  const dedupedSBA = dedupe(supersededButActive).sort(byNote);
  danglingLinks.sort(byNote);
  orphans.sort(byNote);
  stale.sort(byNote);

  const clean =
    dedupedSBA.length === 0 &&
    danglingLinks.length === 0 &&
    orphans.length === 0 &&
    stale.length === 0;

  // Info-tier drift — advisory only, excluded from `clean` (ADR-0011 §7, ADR-0012 §7).
  const { emptyProjects, unregisteredProjectDirs } = await projectDrift(
    root,
    scanned,
    opts.hubMeta ?? null,
  );
  const untaggedNudge = untaggedNudgeFor(scanned);

  return {
    root,
    noteCount: scanned.length,
    supersededButActive: dedupedSBA,
    danglingLinks,
    orphans,
    stale,
    clean,
    emptyProjects,
    unregisteredProjectDirs,
    untaggedNudge,
  };
}

/**
 * Drift between the hub registry and what's on disk (info-tier, never a failure):
 *   - a registered hub-owned project with zero indexed notes, and
 *   - a `projects/<name>/` dir that isn't registered.
 * No-op (empty) for an in-repo base (no registry).
 */
async function projectDrift(
  root: string,
  scanned: ScannedNote[],
  hubMeta: HubMetadata | null,
): Promise<{ emptyProjects: string[]; unregisteredProjectDirs: string[] }> {
  if (!hubMeta) return { emptyProjects: [], unregisteredProjectDirs: [] };

  const emptyProjects: string[] = [];
  for (const p of hubMeta.projects) {
    if (p.storage !== "hub-owned") continue; // in-repo members keep notes in their own repo
    const prefix = `${PROJECTS_DIR}/${p.name}/`;
    if (!scanned.some((s) => s.relPath.startsWith(prefix))) emptyProjects.push(p.name);
  }
  emptyProjects.sort();

  const registered = new Set(hubMeta.projects.map((p) => p.name));
  const unregisteredProjectDirs: string[] = [];
  try {
    for (const e of await readdir(join(root, PROJECTS_DIR), { withFileTypes: true })) {
      if (e.isDirectory() && !registered.has(e.name)) unregisteredProjectDirs.push(e.name);
    }
  } catch {
    /* no projects/ dir */
  }
  unregisteredProjectDirs.sort();

  return { emptyProjects, unregisteredProjectDirs };
}

/** A gentle nudge when a base is mostly untagged — wings are optional (ADR-0012 §7). */
function untaggedNudgeFor(scanned: ScannedNote[]): string[] {
  const untagged = scanned.filter((s) => s.wings.length === 0).length;
  if (untagged >= UNTAGGED_NUDGE_MIN && untagged >= scanned.length * 0.25) {
    return [
      `${untagged} of ${scanned.length} notes are untagged — consider a #wing/room tag so they ` +
        "group in the index (optional; untagged notes stay valid as Cross-cutting).",
    ];
  }
  return [];
}

function dedupe(findings: DreamFinding[]): DreamFinding[] {
  const seen = new Set<string>();
  const out: DreamFinding[] = [];
  for (const f of findings) {
    const k = `${f.note}|${f.detail}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(f);
    }
  }
  return out;
}
