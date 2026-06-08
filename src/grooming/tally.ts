// The recurrence tally fold (ADR-0019 §1/§2). promote's "second deterministic fold
// over the same scratch" — distill's sibling. Where the rollup folds skill_load
// outcomes and distill reads first-sight clusters, this folds CLOSED segments into a
// per-`(wing+keywords)`-signature recurrence count that COUNTS DISTINCT SESSIONS, not
// raw hits ("came up in 3 separate sessions" is signal; "3 times in one chatty
// session" is not). It reuses the rollup mould VERBATIM (rollup.ts): a gitignored
// `.metrics/promote.json`, a per-session bookmark, an idempotent never-regress
// `Math.max` fold over CLOSED segments only, fail-open read. PURE compute (foldSession)
// + an fs orchestrator (foldTally). No model in the fold (ADR-0009).
//
// The global `signatures` counts SURVIVE the raw-event purge; the per-session
// `sessions` fold-memory is PRUNABLE — when a session's `.learnings` file vanishes,
// its fold entry is dropped while its already-counted contribution persists in
// `signatures`. This is the purge-surviving second counter ADR-0018 §3 forward-committed.

import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { METRICS_DIR } from "../paths.js";
import type { ObserveEvent } from "../observe/types.js";
import type {
  Lens,
  LensCounts,
  PromoteTally,
  SessionFold,
  SignatureHit,
  SignatureStat,
} from "./types.js";
import { segmentSignatures } from "./signature.js";

// ─── consts ──────────────────────────────────────────────────────────────────

/** The single tally file, sibling of the context-match rollup + distill bookmark. */
export const PROMOTE_FILE = "promote.json";
/** Bump when the on-disk tally shape changes (a fresh empty tally re-stamps). */
export const PROMOTE_VERSION = 1;

/** A fresh, empty tally at the current version. */
function emptyTally(): PromoteTally {
  return { v: PROMOTE_VERSION, signatures: {}, sessions: {} };
}

/** A zeroed per-lens count Record with all four keys present (fully-keyed). */
function freshLenses(): LensCounts {
  return { correction: 0, failure: 0, workflow: 0, preference: 0 };
}

// ─── path ──────────────────────────────────────────────────────────────────────

/** The on-disk tally path under a docs root. */
export function promoteTallyPath(docsRoot: string): string {
  return join(docsRoot, METRICS_DIR, PROMOTE_FILE);
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
  return {
    v: typeof p.v === "number" ? p.v : PROMOTE_VERSION,
    signatures: isRecord(p.signatures) ? (p.signatures as Record<string, SignatureStat>) : {},
    sessions: isRecord(p.sessions) ? (p.sessions as Record<string, SessionFold>) : {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ─── writeTally ─────────────────────────────────────────────────────────────────

/** Persist the tally (creating `.metrics/`), pretty-printed with a trailing NL. */
export async function writeTally(docsRoot: string, t: PromoteTally): Promise<void> {
  await mkdir(join(docsRoot, METRICS_DIR), { recursive: true });
  await writeFile(promoteTallyPath(docsRoot), JSON.stringify(t, null, 2) + "\n", "utf8");
}

// ─── CLOSED-segment helpers (mirror reader.ts) ──────────────────────────────────

/** A terminator = a compact or session_end event — the chapter boundary. */
function isTerminator(e: ObserveEvent): boolean {
  return e.type === "compact" || e.type === "session_end";
}

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

// ─── foldSession — PURE distinct-session fold (the crux) ────────────────────────

/**
 * Fold ONE session's newly-closed region into the tally and return a NEW tally
 * (inputs never mutated). THE DISTINCT-SESSION ALGORITHM (ADR-0019 §2):
 *
 *   1. closedCount = index just past the LAST terminator. Region to fold =
 *      [fold.offset, closedCount). offset >= closedCount → nothing new closed.
 *   2. Segment the region at terminator boundaries.
 *   3. Collect the SET of SignatureHits across the region (dedupe by `key`, merging
 *      lens per key — a key seen under two lenses in this region carries both).
 *   4. For each signature key in the region's set: if it is NOT already in
 *      sessions[session].sigs, then signatures[key].sessions += 1, push the key into
 *      sessions[session].sigs, and merge lens/keywords/wing/lastSeen/hint into the
 *      stat. If it IS already there, only merge lens/lastSeen (NO session increment).
 *      → a session counts each signature AT MOST ONCE EVER.
 *   5. sessions[session].offset = Math.max(prev.offset, closedCount) — never regress.
 *
 * Idempotent (re-folding an unchanged file adds nothing: the region is empty AND every
 * key is already in sigs), purge-safe (global counts persist after a session prunes),
 * and correct across multi-pass folds of a still-closing session (each fold advances
 * the offset, so a signature recurring within ONE session across folds counts once).
 */
export function foldSession(
  tally: PromoteTally,
  session: string,
  events: ObserveEvent[],
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

  // ── steps 2–3: segment the region, collect the deduped SET of hits (merge lens). ──
  const segments = segmentClosed(events, from, closedCount);
  const hitByKey = new Map<string, { hit: SignatureHit; lenses: Set<Lens>; lastTs: string }>();
  for (const seg of segments) {
    const segTs = lastTsOf(events, seg);
    for (const hit of segmentSignatures(events, seg, repoRoot)) {
      const cur = hitByKey.get(hit.key);
      if (cur === undefined) {
        hitByKey.set(hit.key, { hit, lenses: new Set<Lens>([hit.lens]), lastTs: segTs });
      } else {
        cur.lenses.add(hit.lens);
        if (segTs > cur.lastTs) cur.lastTs = segTs;
      }
    }
  }

  // ── step 4: per-session distinct dedupe → increment global counts. ──
  const signatures: Record<string, SignatureStat> = { ...tally.signatures };
  const seen = new Set(prevFold.sigs);
  const newSigs = [...prevFold.sigs];

  for (const { hit, lenses, lastTs } of hitByKey.values()) {
    const isNewForSession = !seen.has(hit.key);
    signatures[hit.key] = mergeStat(signatures[hit.key], hit, lenses, lastTs, isNewForSession);
    if (isNewForSession) {
      seen.add(hit.key);
      newSigs.push(hit.key);
    }
  }

  // ── step 5: advance the offset, never regress. ──
  return {
    ...tally,
    signatures,
    sessions: {
      ...tally.sessions,
      [session]: { offset: Math.max(prevFold.offset, closedCount), sigs: newSigs },
    },
  };
}

/**
 * Merge one region's contribution to a signature into its global stat (immutable
 * replace). `bumpSession` adds 1 to the DISTINCT-session count ONLY when this is the
 * first time the session contributes this signature; otherwise lens/lastSeen merge
 * but the recurrence count holds. Lens counts accumulate every contributing lens.
 * `hint` is first-non-empty-wins (stable); `wing`/`keywords` adopt the hit's (they're
 * key-derived, so identical across hits of the same key).
 */
function mergeStat(
  prev: SignatureStat | undefined,
  hit: SignatureHit,
  lenses: Set<Lens>,
  lastTs: string,
  bumpSession: boolean,
): SignatureStat {
  const cur: SignatureStat =
    prev ?? { sessions: 0, lenses: freshLenses(), wing: hit.wing, keywords: hit.keywords, lastSeen: "", hint: "" };
  const mergedLenses: LensCounts = { ...cur.lenses };
  for (const l of lenses) mergedLenses[l] += 1;
  return {
    sessions: cur.sessions + (bumpSession ? 1 : 0),
    lenses: mergedLenses,
    wing: hit.wing,
    keywords: hit.keywords,
    lastSeen: lastTs > cur.lastSeen ? lastTs : cur.lastSeen,
    hint: cur.hint.length > 0 ? cur.hint : hit.hint, // first non-empty wins (stable).
  };
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
 * `signatures` contribution persists — purge-safe), and return a NEW tally. Lists
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
    tally = foldSession(tally, session, events, repoRoot);
  }

  // Prune fold-memory for sessions whose `.learnings` file vanished. Their global
  // `signatures` counts persist — the purge-surviving second counter (ADR-0019 §1).
  const prunedSessions: Record<string, SessionFold> = {};
  for (const [session, fold] of Object.entries(tally.sessions)) {
    if (live.has(session)) prunedSessions[session] = fold;
  }

  return { v: PROMOTE_VERSION, signatures: tally.signatures, sessions: prunedSessions };
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
