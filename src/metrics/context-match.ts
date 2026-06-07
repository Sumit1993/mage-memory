// Context-match compute (ADR-0016 §1). PURE — no fs, no model, no network.
// Reads the captured `.learnings/*.jsonl` event stream (ObserveEvent) and, for
// each `skill_load` carrying a `match:{wing,keywords,paths}` snapshot, decides
// whether the forward window of work "touched" the declared context. OR over
// three dimensions, recording which fired so optimize can reword a dead one.
//
// Thresholds here are PROVISIONAL for 0.0.6's read-only metrics; the FINAL
// thresholds land in 0.0.8 (per the build brief; ADR-0016 stages acting at
// 0.0.10/0.0.11). 0.0.6 only flags — it never acts.

import type { ObserveEvent, SkillLoadEvent } from "../observe/types.js";

// ─── consts ──────────────────────────────────────────────────────────────────

/** Forward window size: the next N tool_use/user_prompt events (ADR-0016 §1). */
export const MATCH_WINDOW = 20;
/** Persistently-low match rate below which optimize rewords a trigger (ADR-0016 §1). */
export const LOW_MATCH_RATE = 0.4;
/** Match rate below which a demote is suggested (provisional; final = 0.0.8). */
export const DEMOTE_MATCH_RATE = 0.2;
/** Minimum loads before any suggestion is meaningful (provisional; final = 0.0.8). */
export const MIN_LOADS_FOR_SUGGESTION = 5;

// ─── types ───────────────────────────────────────────────────────────────────

/** Which predicate dimension fired for a load (ADR-0016 §1 dim_breakdown). */
export type MatchDimension = "paths" | "keywords" | "wing";

/** The per-load outcome the rollup folds. One per CLOSED load, in causal order. */
export interface LoadOutcome {
  skill: string;
  trigger_hash: string | null;
  matched: boolean;
  dims: MatchDimension[];
  /** The load.ts — the rollup's lexical-max(ts) `last_seen` source. */
  lastTs: string;
}

// ─── loadMatches — the per-load predicate ────────────────────────────────────

/**
 * Decide whether the forward `window` touches `load.match`. OR over three
 * dimensions, recording which fired (ADR-0016 §1). A foreign skill (match
 * === null) is NEVER scored → {matched:false, dims:[]}.
 *
 *   keywords: any user_prompt.text OR tool_use.detail contains any match.keywords
 *             term — case-folded, word-boundary (\b<escaped-term>\b).
 *   wing:     any tool_use.paths[] entry contains match.wing as a case-insensitive
 *             path SEGMENT (relative to repoRoot when absolute+under it, else raw).
 *   paths:    any tool_use.paths[] matches any match.paths glob (tiny glob). NOTE
 *             match.paths is [] in 0.0.6 → this dim is dormant/forward-compat.
 */
export function loadMatches(
  load: SkillLoadEvent,
  window: ObserveEvent[],
  repoRoot: string | null,
): { matched: boolean; dims: MatchDimension[] } {
  const match = load.match;
  if (match === null) return { matched: false, dims: [] };

  const dims: MatchDimension[] = [];
  if (keywordsFired(match.keywords, window)) dims.push("keywords");
  if (wingFired(match.wing, window, repoRoot)) dims.push("wing");
  if (pathsFired(match.paths, window)) dims.push("paths");

  return { matched: dims.length > 0, dims };
}

// ─── dimension predicates ────────────────────────────────────────────────────

/** keywords: a whole-word, case-insensitive hit in any prompt text or tool detail. */
function keywordsFired(keywords: string[], window: ObserveEvent[]): boolean {
  // Bound regex compilation against a crafted `.learnings` file. Well-formed
  // snapshots are already capped at MAX_KEYWORDS (12) at capture time.
  const terms = keywords.filter((k) => k.length > 0).slice(0, 64);
  if (terms.length === 0) return false;
  const res = terms.map((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, "i"));
  for (const e of window) {
    const haystack = textOf(e);
    if (haystack === null) continue;
    if (res.some((r) => r.test(haystack))) return true;
  }
  return false;
}

/** The keyword-bearing text of an event: user_prompt.text or tool_use.detail. */
function textOf(e: ObserveEvent): string | null {
  if (e.type === "user_prompt") return e.text;
  if (e.type === "tool_use") return e.detail;
  return null;
}

/** wing: a touched path has `wing` as a path segment (case-insensitive). */
function wingFired(wing: string, window: ObserveEvent[], repoRoot: string | null): boolean {
  if (wing.length === 0) return false;
  const target = wing.toLowerCase();
  for (const e of window) {
    if (e.type !== "tool_use") continue;
    for (const p of e.paths) {
      if (pathSegments(p, repoRoot).includes(target)) return true;
    }
  }
  return false;
}

/**
 * Split a touched path into lower-cased segments. An absolute path under
 * `repoRoot` is made relative first (so the repo prefix's own segments don't
 * spuriously match a wing). Otherwise the raw path is split on "/".
 */
function pathSegments(rawPath: string, repoRoot: string | null): string[] {
  let p = rawPath;
  if (repoRoot !== null && isAbsoluteUnder(rawPath, repoRoot)) {
    p = rawPath.slice(repoRoot.length);
  }
  return p
    .split("/")
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);
}

/** True iff `p` is `repoRoot` followed by a "/" boundary (so it's strictly under it). */
function isAbsoluteUnder(p: string, repoRoot: string): boolean {
  if (!p.startsWith(repoRoot)) return false;
  const rest = p.slice(repoRoot.length);
  return rest.length === 0 || rest.startsWith("/");
}

/** paths: any touched path matches any glob in `globs` (tiny glob). Empty → false. */
function pathsFired(globs: string[], window: ObserveEvent[]): boolean {
  if (globs.length === 0) return false; // dormant in 0.0.6 (match.paths is []).
  const res = globs.map(globToRegExp);
  for (const e of window) {
    if (e.type !== "tool_use") continue;
    for (const p of e.paths) {
      if (res.some((r) => r.test(p))) return true;
    }
  }
  return false;
}

/** Tiny glob → RegExp: escape regex, `**` → `.*`, `*` → `[^/]*`, anchored. */
function globToRegExp(glob: string): RegExp {
  const body = escapeRegExp(glob)
    .replace(/\\\*\\\*/g, "\x00") // placeholder for ** so single-* pass leaves it.
    .replace(/\\\*/g, "[^/]*")
    .replace(/\x00/g, ".*");
  return new RegExp(`^${body}$`);
}

/** Escape a literal string for safe embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── computeSessionMatches — windowing + closed/open semantics ────────────────

/**
 * Score one session's event stream in causal order. For each `skill_load` with
 * match !== null, build its forward window (subsequent events, counting
 * tool_use/user_prompt toward MATCH_WINDOW, terminating early on
 * session_end/compact). A load is CLOSED iff the window reached MATCH_WINDOW
 * counted events OR a terminator appeared after it. Emit a LoadOutcome ONLY for
 * CLOSED loads (in causal order); OPEN trailing loads are not emitted — they fold
 * on a later turn once their window closes, which makes the rollup watermark a
 * stable growing prefix. lastTs is the load.ts.
 */
export function computeSessionMatches(
  events: ObserveEvent[],
  repoRoot: string | null,
): { outcomes: LoadOutcome[]; closedCount: number } {
  const outcomes: LoadOutcome[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined || ev.type !== "skill_load" || ev.match === null) continue;
    const window = collectWindow(events, i + 1);
    if (!window.closed) continue; // OPEN trailing load — fold later, not now.
    const { matched, dims } = loadMatches(ev, window.events, repoRoot);
    outcomes.push({
      skill: ev.skill,
      trigger_hash: ev.trigger_hash,
      matched,
      dims,
      lastTs: ev.ts,
    });
  }
  return { outcomes, closedCount: outcomes.length };
}

/**
 * Build a load's forward window starting at index `from`. Counts only tool_use /
 * user_prompt toward MATCH_WINDOW. Closes when MATCH_WINDOW counted events are
 * reached OR a session_end/compact terminator appears. Returns the gathered
 * events plus whether the window is CLOSED (any other trailing run is OPEN).
 */
function collectWindow(
  events: ObserveEvent[],
  from: number,
): { events: ObserveEvent[]; closed: boolean } {
  const window: ObserveEvent[] = [];
  let counted = 0;
  for (let j = from; j < events.length; j++) {
    const e = events[j];
    if (e === undefined) continue;
    if (e.type === "session_end" || e.type === "compact") {
      return { events: window, closed: true }; // terminator closes the window.
    }
    window.push(e);
    if (e.type === "tool_use" || e.type === "user_prompt") {
      counted += 1;
      if (counted >= MATCH_WINDOW) return { events: window, closed: true };
    }
  }
  return { events: window, closed: false }; // ran off the end → still OPEN.
}
