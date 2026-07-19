// The recurrence tally fold (ADR-0019 §1/§2). promote's "second deterministic fold
// over the same scratch" — distill's sibling. Where the rollup folds skill_load
// outcomes and distill reads first-sight clusters, this folds CLOSED segments into a
// per-NOTE read count that COUNTS DISTINCT CHAPTERS
// (compact/session_end segments clearing a min-work floor), not raw hits — a pattern
// across 3 separate chapters is signal; 3 times in one chapter is not. A chapter is the
// recurrence work-unit (0.0.11): a single continuously-compacted chat still accrues
// recurrence (session_id is constant across compaction), while a multi-session user's
// sessions are each ≥1 chapter. It reuses the rollup mould VERBATIM (rollup.ts): a gitignored
// `.mage/metrics/promote.json`, a per-session bookmark, an idempotent never-regress
// `Math.max` fold over CLOSED segments only, fail-open read. PURE compute (foldSession)
// + an fs orchestrator (foldTally). No model in the fold (ADR-0009).
//
// The global `notes` counts SURVIVE the raw-event purge; the per-session `sessions`
// fold-memory is PRUNABLE — when a session's `.learnings` file vanishes, its fold entry
// is dropped while its already-counted contribution persists in `notes`. This is the
// purge-surviving second counter ADR-0018 §3 forward-committed.
//
// ADR-0038 §7 swapped WHAT is counted, not HOW. The chapter segmentation, the min-work
// floor, and the never-regress offset are unchanged — that machinery was never the bug;
// the keyword KEY was. Chapters now contribute note READS (note-reads.ts) instead of
// (wing+keywords) signatures.

import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { metricsPath } from "../paths.js";
import { type ObserveEvent, isTerminator } from "../observe/types.js";
import type { NoteReadStat, PromoteTally, SessionFold } from "./types.js";
import { chapterNoteReads } from "./note-reads.js";
import { MIN_CHAPTER_WORK_EVENTS } from "./thresholds.js";

// ─── consts ──────────────────────────────────────────────────────────────────

/** The single tally file, sibling of the context-match rollup + distill bookmark. */
export const PROMOTE_FILE = "promote.json";
/**
 * Bump when the tally's MEANING or shape changes — `normalizeTally` then discards an
 * older-version tally and re-folds from the live `.learnings`. v2 (0.0.11): the
 * recurrence unit is a distinct compact-CHAPTER, not a session_id. v3 (0.0.11): the
 * signature KEY semantics changed — de-noised keywords (Candidate 3) + de-containered
 * project wings (Candidate 2) — so old-key buckets must rebuild under the new keys.
 *
 * v4 (ADR-0038 §7): the tally counts NOTE READS, not (wing+keywords) signatures. A v3
 * bucket has no v4 interpretation — it is keyed on a different thing entirely — so the
 * reset is the only honest migration, not a convenience. EXPECT THE VISIBLE DROP: every
 * note's count restarts at 0 and must be re-earned from live `.learnings` against a
 * stricter signal, so "N eligible to graduate" falls to 0 on first fold after upgrade.
 * That is the designed outcome. Do NOT "fix" it by lowering `graduateSessions`.
 */
export const PROMOTE_VERSION = 4;

/** A fresh, empty tally at the current version. */
function emptyTally(): PromoteTally {
  return { v: PROMOTE_VERSION, notes: {}, sessions: {} };
}


// ─── path ──────────────────────────────────────────────────────────────────────

/** The on-disk tally path under a docs root. */
export function promoteTallyPath(docsRoot: string): string {
  return join(metricsPath(docsRoot), PROMOTE_FILE);
}

// ─── readTally — fail-open on missing/corrupt ───────────────────────────────────

/**
 * Read the persisted tally. Missing file (ENOENT) or corrupt JSON → a fresh empty
 * tally. This is reachable from a host hook (the read path folds+writes, like the
 * rollup Stop-fold), so it must NEVER throw — a bad file just re-folds from scratch.
 */
export async function readTally(docsRoot: string): Promise<PromoteTally> {
  let raw: string;
  try {
    raw = await readFile(promoteTallyPath(docsRoot), "utf8");
  } catch {
    return emptyTally(); // missing (ENOENT) or unreadable → fresh.
  }
  try {
    return normalizeTally(JSON.parse(raw) as unknown);
  } catch {
    return emptyTally(); // corrupt JSON → fail-open to fresh.
  }
}

/** Coerce a parsed value into a well-shaped tally, defaulting absent fields. */
function normalizeTally(parsed: unknown): PromoteTally {
  if (parsed === null || typeof parsed !== "object") return emptyTally();
  const p = parsed as Partial<PromoteTally>;
  // A version bump changes the recurrence unit's MEANING (v1 distinct sessions →
  // v2 distinct chapters), so an older tally's counts are not comparable — discard it
  // and re-fold from the live `.learnings` under the current algorithm.
  if (p.v !== PROMOTE_VERSION) return emptyTally();
  return {
    v: PROMOTE_VERSION,
    notes: isRecord(p.notes) ? (p.notes as Record<string, NoteReadStat>) : {},
    sessions: isRecord(p.sessions) ? (p.sessions as Record<string, SessionFold>) : {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ─── writeTally ─────────────────────────────────────────────────────────────────

/** Persist the tally (creating `.mage/metrics/`), pretty-printed with a trailing NL. */
export async function writeTally(docsRoot: string, t: PromoteTally): Promise<void> {
  await mkdir(metricsPath(docsRoot), { recursive: true });
  await writeFile(promoteTallyPath(docsRoot), JSON.stringify(t, null, 2) + "\n", "utf8");
}

// ─── CLOSED-segment helpers (mirror reader.ts) ──────────────────────────────────

/**
 * The CLOSED prefix length: the index just past the LAST terminator, or 0 if the
 * stream has none (a wholly in-flight session is never folded). Mirrors
 * reader.ts closedCountOf.
 */
function closedCountOf(events: ObserveEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) return i + 1;
  }
  return 0;
}

/** One mechanical chapter: a run of events `[start, end)` ending at a terminator. */
interface Segment {
  start: number;
  end: number;
}

/**
 * Chop `events[from, upto)` into segments at terminator boundaries — each runs up to
 * AND INCLUDING its terminator. Because `upto` is closedCount, the region divides
 * evenly with no trailing unterminated remainder. Mirrors reader.ts segmentClosed.
 */
function segmentClosed(events: ObserveEvent[], from: number, upto: number): Segment[] {
  const segments: Segment[] = [];
  let start = from;
  for (let i = from; i < upto; i++) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) {
      segments.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  return segments;
}

// ─── foldSession — PURE distinct-CHAPTER fold (the crux) ────────────────────────

/**
 * Fold ONE session's newly-closed region into the tally and return a NEW tally
 * (inputs never mutated). THE DISTINCT-CHAPTER ALGORITHM (ADR-0019 §2; revised 0.0.11):
 *
 *   1. closedCount = index just past the LAST terminator. Region to fold =
 *      [fold.offset, closedCount). offset >= closedCount → nothing new closed.
 *   2. Segment the region into CHAPTERS at compact/session_end boundaries.
 *   3. For EACH chapter that clears the MIN_CHAPTER_WORK_EVENTS floor, collect its
 *      distinct SignatureHits (dedupe by `key` within the chapter, merging lens).
 *   4. For each such chapter a note is READ in: notes[rel].chapters += 1 and merge
 *      lastSeen. → a note read across N qualifying chapters counts N, whether those
 *      chapters fall in one session or many (the unit is the chapter, so a single
 *      continuously-compacted chat accrues usage too). A chapter that loaded one of
 *      mage's own skills contributes NOTHING (self-reference exclusion, ADR-0038 §2).
 *   5. sessions[session].offset = Math.max(prev.offset, closedCount) — never regress.
 *
 * Idempotent (re-folding an unchanged file adds nothing: the offset watermark skips the
 * already-closed region), purge-safe (global counts persist after a session prunes). A
 * chapter is folded EXACTLY ONCE — the offset advances past its terminator — so a count
 * never doubles across folds. (`sessions[session].sigs` is retained empty: the chapter
 * granularity + the offset now do the dedupe the per-session set used to.)
 */
export function foldSession(
  tally: PromoteTally,
  session: string,
  events: ObserveEvent[],
  docsRoot: string,
  repoRoot: string | null,
): PromoteTally {
  const prevFold = tally.sessions[session] ?? { offset: 0, sigs: [] };
  const closedCount = closedCountOf(events);
  const from = Math.max(0, prevFold.offset);

  // ── step 1/5: nothing new closed → just guard the never-regress offset. ──
  if (from >= closedCount) {
    if (prevFold.offset >= closedCount) return tally; // truly nothing changed.
    return {
      ...tally,
      sessions: {
        ...tally.sessions,
        [session]: { offset: Math.max(prevFold.offset, closedCount), sigs: [...prevFold.sigs] },
      },
    };
  }

  // ── steps 2–4: count each QUALIFYING chapter a signature appears in. The chapter
  //    (a compact/session_end segment clearing the min-work floor) is the recurrence
  //    work-unit; the offset watermark guarantees each is folded exactly once. ──
  const segments = segmentClosed(events, from, closedCount);
  const notes: Record<string, NoteReadStat> = { ...tally.notes };

  for (const seg of segments) {
    if (chapterWorkCount(events, seg) < MIN_CHAPTER_WORK_EVENTS) continue; // floor: skip trivial chapters.
    const segTs = lastTsOf(events, seg);
    // The distinct notes READ in this chapter — [] for a self-referential chapter, so
    // mage's own capture skills can never inflate the counts that trigger graduation.
    for (const rel of chapterNoteReads(events, seg, docsRoot, repoRoot)) {
      notes[rel] = mergeRead(notes[rel], segTs);
    }
  }

  // ── step 5: advance the offset, never regress. `sigs` no longer gates counting (the
  //    offset watermark + per-chapter granularity do) — retained empty for shape. ──
  return {
    ...tally,
    notes,
    sessions: {
      ...tally.sessions,
      [session]: { offset: Math.max(prevFold.offset, closedCount), sigs: [] },
    },
  };
}

/**
 * Merge one chapter's read of a note into its global stat (immutable replace). Every
 * qualifying chapter a note is read in bumps `chapters` by exactly 1 — the read set is
 * already deduped within the chapter, and the offset watermark guarantees a chapter is
 * folded once, so a count can never double.
 */
function mergeRead(prev: NoteReadStat | undefined, lastTs: string): NoteReadStat {
  const cur: NoteReadStat = prev ?? { chapters: 0, lastSeen: "" };
  return {
    chapters: cur.chapters + 1,
    lastSeen: lastTs > cur.lastSeen ? lastTs : cur.lastSeen,
  };
}

/** Count of a chapter's WORK events (user_prompt | tool_use) — the min-work floor
 *  metric that keeps a trivial `/compact` from minting a recurrence unit. */
function chapterWorkCount(events: ObserveEvent[], seg: Segment): number {
  let n = 0;
  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e !== undefined && (e.type === "user_prompt" || e.type === "tool_use")) n += 1;
  }
  return n;
}

/** The lexical-max ts within a segment — the stat's lastSeen source. "" if none. */
function lastTsOf(events: ObserveEvent[], seg: Segment): string {
  let max = "";
  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e !== undefined && e.ts > max) max = e.ts;
  }
  return max;
}

// ─── foldTally — the fs orchestrator (folds every session, prunes vanished ones) ──

/**
 * List the per-session `.learnings/*.jsonl` full streams, {@link foldSession} each
 * into the tally, PRUNE session-fold entries whose files have vanished (their global
 * `notes` contribution persists — purge-safe), and return a NEW tally. Lists
 * EXACTLY like rollup.ts — top-level `*.jsonl`, EXCLUDING `*.skills.jsonl` sidecars
 * and the `.archive` subdir — and skips a torn file (fail-open). Does NOT write (the
 * caller persists; mirrors readDistill's read/compute split, but this one mutates the
 * tally functionally like foldRollup).
 */
export async function foldTally(
  docsRoot: string,
  learningsDir: string,
  repoRoot: string | null,
): Promise<PromoteTally> {
  const prev = await readTally(docsRoot);
  const files = await listSessionStreams(learningsDir);

  // Fold each live session forward.
  let tally = prev;
  const live = new Set<string>();
  for (const file of files) {
    const session = basename(file, ".jsonl");
    live.add(session);
    const events = await parseStream(join(learningsDir, file));
    tally = foldSession(tally, session, events, docsRoot, repoRoot);
  }

  // Prune fold-memory for sessions whose `.learnings` file vanished. Their global
  // `notes` counts persist — the purge-surviving second counter (ADR-0019 §1).
  const prunedSessions: Record<string, SessionFold> = {};
  for (const [session, fold] of Object.entries(tally.sessions)) {
    if (live.has(session)) prunedSessions[session] = fold;
  }

  return { v: PROMOTE_VERSION, notes: tally.notes, sessions: prunedSessions };
}

/**
 * The full per-session streams to fold: top-level `*.jsonl`, EXCLUDING the
 * `*.skills.jsonl` sidecars (the endswith check is ordered FIRST — a sidecar's
 * basename would corrupt the session key) and the `.archive` subdir (only files, not
 * dirs, are read). Mirrors rollup.ts / reader.ts listSessionStreams exactly.
 */
async function listSessionStreams(learningsDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(learningsDir, { withFileTypes: true });
  } catch {
    return []; // no `.learnings/` dir yet → nothing to fold.
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue; // skips the `.archive` subdir.
    const name = ent.name;
    if (name.endsWith(".skills.jsonl")) continue; // sidecar — ordered FIRST.
    if (!name.endsWith(".jsonl")) continue;
    out.push(name);
  }
  return out;
}

/** Parse a `.jsonl` stream into events; unparseable lines are skipped (fail-open). */
async function parseStream(path: string): Promise<ObserveEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const events: ObserveEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(JSON.parse(trimmed) as ObserveEvent);
    } catch {
      // Skip a torn/garbage line — a partial last write must not abort the fold.
    }
  }
  return events;
}
