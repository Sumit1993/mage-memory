import { join, posix } from "node:path";
import { readNote } from "./note.js";
import { exists } from "./paths.js";
import { scanNotes } from "./scan.js";

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
}

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
  /** True iff every finding list is empty. */
  clean: boolean;
}

const MS_PER_DAY = 86_400_000;
/** Relation verbs that assert a *full* supersession (partial `revises` is deliberately excluded). */
const SUPERSEDES = "supersedes";
const SUPERSEDED_BY = "superseded_by";

/** Strip fenced + inline code so example links like `[x](x.md)` are never treated as real. */
function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/** All relative markdown links to `.md` targets, as written. */
function extractLinks(body: string): string[] {
  const out: string[] = [];
  const re = /\]\(([^)]+\.md)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

/** Typed relation bullets: `- <verb> [text](target.md)`. */
const REL_RE = /^[-*]\s+([A-Za-z_]\w*)\s+\[[^\]]*\]\(([^)]+\.md)\)/;
function extractRelations(body: string): Array<{ verb: string; target: string }> {
  const out: Array<{ verb: string; target: string }> = [];
  for (const line of body.split("\n")) {
    const m = line.match(REL_RE);
    if (m?.[1] && m[2]) out.push({ verb: m[1], target: m[2].trim() });
  }
  return out;
}

/** Resolve a link target (relative to the linking note) to a root-relative posix path. */
function resolveRel(noteRel: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(noteRel), target));
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
  const scanned = [...new Map(raw.map((s) => [s.relPath, s])).values()];
  const noteSet = new Set(scanned.map((s) => s.relPath));
  const statusOf = new Map(scanned.map((s) => [s.relPath, s.status]));

  // Read each note body once (scan already gave us status/lastReviewed/title).
  const bodies = new Map<string, string>();
  for (const s of scanned) {
    try {
      bodies.set(s.relPath, (await readNote(join(root, s.relPath))).body);
    } catch {
      bodies.set(s.relPath, "");
    }
  }

  const danglingLinks: DreamFinding[] = [];
  const supersededButActive: DreamFinding[] = [];
  const hasOut = new Set<string>();
  const hasIn = new Set<string>();

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

    for (const { verb, target } of extractRelations(body)) {
      if (verb === SUPERSEDED_BY && isActive(statusOf.get(s.relPath))) {
        supersededButActive.push({
          note: s.relPath,
          detail: `superseded_by ${target}, but status is active`,
        });
      } else if (verb === SUPERSEDES) {
        const resolved = resolveRel(s.relPath, target);
        if (noteSet.has(resolved) && isActive(statusOf.get(resolved))) {
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

  return {
    root,
    noteCount: scanned.length,
    supersededButActive: dedupedSBA,
    danglingLinks,
    orphans,
    stale,
    clean,
  };
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
