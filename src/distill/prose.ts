// The prose-keyed capture detector (ADR-0028). PURE — NO model, NO fs, NO network.
//
// Supersedes Faultline's tool-transition detector (ADR-0027), which its own pre-registered
// replay gate KILLED (0/62 keeps). Faultline detected friction *position* (a failing action,
// then a different approach-key succeeds) but discarded the *content*; the real earned lessons
// in ops work live in **correction PROSE** and **recurrent-failure STRINGS** — "copy git
// history, don't fork", `git --no-verify` blocked across sessions, context-mode intercepting
// WebFetch→ctx_* seven times — none of which leave a tool-swap signature, so a tried→worked
// detector is structurally blind to them. This surfaces that CONTENT for the host agent to
// judge at `mage:groom` (ADR-0009 — surface text, the agent judges; no model in mage's engine).
//
// Two asymmetric content signals (ADR-0028 §3):
//   • a substantive CORRECTION — surfaced at ANY frequency (a human bothering to steer is
//     inherently high-signal). We surface the correction TEXT and filter only OBVIOUS noise
//     (continuation tokens, compaction/local-command boilerplate, very short acks). We do NOT
//     classify "correction vs next-task" — we can't; we surface broad and the agent culls.
//   • a RECURRENT FAILURE — surfaced ONLY when its conservative skeleton recurs across ≥K
//     distinct chapters KB-wide (a one-off failure is noise; recurrence IS the signal).
//
// The capture unit is per-correction / per-recurrent-failure (NOT a per-chapter grab-bag — the
// distill flaw the 0.0.12 proving run found). It reuses reader.ts's correction-adjacency rule
// and the compact-chapter recurrence unit (tally.ts); the production wiring repoints signature.ts's
// failure key to {@link failureSkeleton} and gates corrections in reader.ts via
// {@link isSubstantiveCorrection} — both deferred until the replay gate passes.

import type { ObserveEvent } from "../observe/types.js";
import { redact } from "../redact.js";

// ─── tunable bounds (provisional; gate/soak-tunable per ADR-0028 §5/§8) ────────

/** Distinct chapters KB-wide a failure skeleton must recur in to surface (mirrors promoteSessions). */
export const DEFAULT_RECURRENCE_K = 3;
/** Min words a correction needs (unless it carries a contradiction cue) to be substantive. */
const MIN_CORRECTION_WORDS = 3;
/** Min chars a correction needs (unless it carries a contradiction cue) to be substantive. */
const MIN_CORRECTION_CHARS = 12;
/** Cap on a surfaced correction's prose (enough for the agent to judge; redacted). */
const CORRECTION_TEXT_MAX = 400;
/** Cap on the "what the agent did just before" context line. */
const PRECEDED_BY_MAX = 120;
/** Cap on a representative raw failure example. */
const FAILURE_EXAMPLE_MAX = 160;
/** Cap on a failure skeleton (the bucket key). */
const SKELETON_MAX = 200;
/** Representative raw failure examples carried per recurrent-failure candidate. */
const FAILURE_EXAMPLES = 3;

// ─── candidate shapes (the capture unit) ───────────────────────────────────────

/** A substantive user correction — surfaced at any frequency; the lesson lives in `text`. */
export interface CorrectionCandidate {
  kind: "correction";
  session: string;
  /** The correction prose (redacted, capped). */
  text: string;
  /** A short redacted line for what the agent did immediately before (context). */
  precededBy: string;
  /** True iff `text` carries a contradiction cue (no/don't/instead/actually/wrong/should/rather). */
  cue: boolean;
}

/** A failure whose conservative skeleton recurred across ≥K distinct chapters KB-wide. */
export interface RecurrentFailureCandidate {
  kind: "recurrent-failure";
  /** The conservative failure skeleton — the recurrence bucket key. */
  skeleton: string;
  /** Distinct chapters KB-wide this skeleton recurred in (≥K). */
  chapters: number;
  /** Distinct sessions it spanned (cross-session is the strong signal). */
  sessions: string[];
  /** A few representative raw failure strings (redacted, capped). */
  examples: string[];
}

export type ProseCandidate = CorrectionCandidate | RecurrentFailureCandidate;

/** One compact chapter's raw failure strings — the recurrence work-unit (tally.ts mirror). */
export interface Chapter {
  session: string;
  /** Raw `error_summary` strings observed in this chapter (un-skeletonized). */
  failures: string[];
}

// ─── contradiction cue + noise filters ────────────────────────────────────────

/**
 * Contradiction cues (ADR-0028 §6). A correction carrying one is a stronger steer ("no, do X
 * instead") and ranks above a cue-less one. Used for RANKING, never as a hard filter — a cue-less
 * correction ("use the staging dir, not metrics") is still surfaced.
 */
const CUE_RE = /\b(no|nope|don'?t|instead|actually|wrong|should|rather|revert|undo)\b/i;

/** True iff the text carries a contradiction cue. */
export function hasContradictionCue(text: string): boolean {
  return CUE_RE.test(text);
}

/**
 * Bare continuation / acknowledgement tokens — a whole prompt that is just one of these is the
 * human waving the agent on, not steering it. Matched against the lowercased prompt with trailing
 * punctuation stripped. Kept deliberately small + obvious (ADR-0028 §3 "filter only obvious noise").
 */
const CONTINUATION_TOKENS: ReadonlySet<string> = new Set([
  "continue", "next", "ok", "okay", "yes", "y", "yep", "yeah", "sure", "k", "go", "proceed",
  "commit", "done", "good", "great", "perfect", "nice", "cool", "thanks", "thank you", "ty",
  "go ahead", "do it", "continue please", "please continue", "keep going", "carry on",
]);

/**
 * A "resume from where you left off" continuation PHRASE (not a bare token) — the harness/agent
 * resuming after a compaction, never a human steer. Drops "Continue from where you left off." but
 * NOT "continue, but commit first" (no "left off" tail → keeps a real steer). Obvious noise only.
 */
const CONTINUATION_PHRASE_RE =
  /^(please\s+)?(continue|resume|carry on|pick up|keep going|go on)\b.*\b(left off|where (you|we|i) (left|were)|you left)/i;

/**
 * Compaction / local-command / system boilerplate that rides in as a "user" turn but is never a
 * human steer. These are obvious, harness-injected strings (the /compact summary, the local-command
 * caveat, an interrupt marker). Conservative — only unambiguous machine text.
 */
const BOILERPLATE_RE: readonly RegExp[] = [
  /^this session is being continued/i,
  /continue the conversation from where it left off/i,
  /^\s*caveat: the messages below/i,
  /\[request interrupted/i,
  /^\s*<command-(name|message|args)/i,
  /^\s*<local-command/i,
  /^\s*<system-reminder/i,
  /^\s*api error/i,
];

/**
 * True iff a user prompt is a SUBSTANTIVE correction worth surfacing (ADR-0028 §3). Drops obvious
 * noise only: boilerplate, slash-commands, bare continuation tokens, and very short acks WITHOUT a
 * contradiction cue (a short steer like "no, fork it" survives via the cue exception). Everything
 * else passes — we do not try to tell a correction from a next-task instruction (the agent culls).
 */
export function isSubstantiveCorrection(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.startsWith("/")) return false; // a slash-command, not prose.
  if (BOILERPLATE_RE.some((re) => re.test(t))) return false;

  const lower = t.toLowerCase();
  const bare = lower.replace(/[.!…\s]+$/u, "").trim(); // strip trailing ack punctuation.
  if (CONTINUATION_TOKENS.has(bare)) return false;
  if (CONTINUATION_PHRASE_RE.test(t)) return false; // "continue from where you left off".

  // A very short prompt with no contradiction cue is almost always an ack/continuation, not a
  // steer. The cue exception keeps terse-but-real corrections ("no — use .mage/").
  const cue = hasContradictionCue(t);
  if (cue) return true;
  const words = t.split(/\s+/u).filter(Boolean).length;
  if (words < MIN_CORRECTION_WORDS) return false;
  if (t.length < MIN_CORRECTION_CHARS) return false;
  return true;
}

// ─── conservative failure-skeleton normalization (ADR-0028 §4) ─────────────────

/**
 * Harness-protocol failures — never a domain lesson, just a tool-usage rule the agent hit and
 * immediately fixed. Default = Claude Code's Edit/Read protocol strings. Dropped BEFORE skeletoning
 * so they never flood the high-precision recurrent-failure channel. PARAMETERIZED per ADR-0027 §8
 * (harness-specific lists live outside the detector); another harness passes its own.
 */
export const DEFAULT_PROTOCOL_PATTERNS: readonly RegExp[] = [
  /file has not been read yet/i,
  /string to replace was not found/i,
  /found \d+ matches of the string to replace/i,
  /no replacement was performed/i,
  /old_string and new_string are exactly the same/i,
  /has been (unexpectedly )?modified (since|after) read/i,
  /this operation requires permission/i,
  /the user (doesn't|does not) want to (proceed|take this action)/i,
  /request interrupted by user/i,
];

/** True iff a raw failure string is a known harness-protocol failure (not a domain lesson). */
export function isProtocolFailure(
  raw: string,
  patterns: readonly RegExp[] = DEFAULT_PROTOCOL_PATTERNS,
): boolean {
  return patterns.some((re) => re.test(raw));
}

/**
 * Reduce a raw failure string to a CONSERVATIVE skeleton (ADR-0028 §4): the bucket key recurrence
 * is counted on. Lowercase, then strip ONLY clearly-variable parts so the SAME error recurring with
 * a different URL/path/id still clusters — while keeping the structural error phrase + short status
 * codes so DIFFERENT errors do NOT collapse. Conservative = miss-don't-manufacture: when in doubt we
 * keep a specific (risking a missed recurrence, which is lossless — inline `mage stage` still catches
 * it) rather than strip it (risking manufactured recurrence, which poisons a precision-only channel).
 *
 * Returns "" when nothing structural survives (e.g. the whole string was a path) — such a failure
 * does not bucket. PURE + idempotent.
 */
export function failureSkeleton(raw: string): string {
  let s = raw.toLowerCase();
  // URLs (host + path + query are all incidental).
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/g, " ");
  // ISO-8601 timestamps.
  s = s.replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, " ");
  // Windows paths (C:\foo\bar) and absolute/relative unix paths (≥2 segments, or ./ ../).
  s = s.replace(/[a-z]:\\[^\s"']+/g, " ");
  s = s.replace(/\.{1,2}\/[\w./@-]+/g, " ");
  s = s.replace(/(?:\/[\w.@-]+){2,}\/?/g, " ");
  // UUIDs and long hex hashes/ids.
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, " ");
  s = s.replace(/\b[0-9a-f]{7,}\b/g, " ");
  // Quoted specifics — keep the empty quotes as a structural marker, drop the variable content.
  s = s.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, "``");
  // Long numbers (≥4 digits) are incidental; 1–3 digit codes (403/500) survive.
  s = s.replace(/\b\d{4,}\b/g, " ");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  // A skeleton with no letters left carries no structural phrase — do not bucket it.
  if (!/[a-z]/.test(s)) return "";
  return s.slice(0, SKELETON_MAX);
}

// ─── correction candidates (any frequency) ─────────────────────────────────────

/**
 * Extract substantive CORRECTION candidates from one session's events (ADR-0028 §3). Mirrors
 * reader.ts / signature.ts adjacency: a `user_prompt` whose nearest preceding NON-terminator event
 * is a `tool_use` OR an `assistant_msg` (the agent acted/replied → the human reacted). Each passing
 * the {@link isSubstantiveCorrection} noise filter becomes one candidate, carrying the redacted
 * prose, a short "what was done just before" context line, and the contradiction-cue flag (ranking).
 * One candidate per correction (never a chapter grab-bag). PURE.
 */
export function correctionCandidates(events: ObserveEvent[]): CorrectionCandidate[] {
  const out: CorrectionCandidate[] = [];
  let prevType: ObserveEvent["type"] | null = null;
  let lastAction = ""; // a short redacted line for the most recent tool_use.

  for (const e of events) {
    if (e.type === "user_prompt") {
      if ((prevType === "tool_use" || prevType === "assistant_msg") && isSubstantiveCorrection(e.text)) {
        out.push({
          kind: "correction",
          session: e.session,
          text: redact(oneLine(e.text)).text.slice(0, CORRECTION_TEXT_MAX),
          precededBy: lastAction,
          cue: hasContradictionCue(e.text),
        });
      }
      prevType = "user_prompt";
      continue;
    }
    if (e.type === "tool_use") {
      lastAction = redact(toolLine(e)).text.slice(0, PRECEDED_BY_MAX);
      prevType = "tool_use";
      continue;
    }
    // assistant_msg / skill_load / session_start update the adjacency; terminators do not.
    if (e.type === "assistant_msg" || e.type === "skill_load" || e.type === "session_start") {
      prevType = e.type;
    }
  }
  return out;
}

/** A short one-liner for a tool_use: `tool: <detail | joined-paths>` (the "what was done" context). */
function toolLine(e: Extract<ObserveEvent, { type: "tool_use" }>): string {
  const body = e.detail !== null && e.detail.trim().length > 0 ? e.detail : e.paths.join(",");
  return `${e.tool}: ${body}`.trim();
}

/** Collapse to a single trimmed line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ─── recurrent-failure candidates (≥K distinct chapters, KB-wide) ──────────────

/** Options for {@link recurrentFailures}. */
export interface RecurrentFailureOptions {
  /** Distinct chapters KB-wide a skeleton must recur in to surface (default {@link DEFAULT_RECURRENCE_K}). */
  k?: number;
  /** Harness-protocol patterns dropped before skeletoning (default {@link DEFAULT_PROTOCOL_PATTERNS}). */
  protocolPatterns?: readonly RegExp[];
}

/**
 * Surface RECURRENT FAILURE candidates from per-chapter raw failure strings (ADR-0028 §4/§5).
 * Drops harness-protocol failures, skeletonizes each remaining failure, dedupes within a chapter
 * (a skeleton seen 5× in one chapter counts once — DISTINCT chapters is the unit, mirroring
 * tally.ts), then counts distinct chapters + distinct sessions KB-wide and surfaces every skeleton
 * recurring in ≥K chapters. Conservative skeletoning (above) keeps this a precision channel. PURE.
 */
export function recurrentFailures(
  chapters: readonly Chapter[],
  opts: RecurrentFailureOptions = {},
): RecurrentFailureCandidate[] {
  const k = opts.k ?? DEFAULT_RECURRENCE_K;
  const protocol = opts.protocolPatterns ?? DEFAULT_PROTOCOL_PATTERNS;

  interface Acc {
    chapters: number;
    sessions: Set<string>;
    examples: string[];
  }
  const byKey = new Map<string, Acc>();

  for (const chapter of chapters) {
    const seenThisChapter = new Set<string>(); // distinct-chapter dedupe.
    for (const raw of chapter.failures) {
      if (isProtocolFailure(raw, protocol)) continue;
      const key = failureSkeleton(raw);
      if (key.length === 0) continue;
      if (seenThisChapter.has(key)) {
        // already counted this skeleton for this chapter; still capture a varied example.
        const acc = byKey.get(key);
        if (acc !== undefined && acc.examples.length < FAILURE_EXAMPLES) pushExample(acc.examples, raw);
        continue;
      }
      seenThisChapter.add(key);
      const acc = byKey.get(key) ?? { chapters: 0, sessions: new Set<string>(), examples: [] };
      acc.chapters += 1;
      acc.sessions.add(chapter.session);
      if (acc.examples.length < FAILURE_EXAMPLES) pushExample(acc.examples, raw);
      byKey.set(key, acc);
    }
  }

  const out: RecurrentFailureCandidate[] = [];
  for (const [skeleton, acc] of byKey) {
    if (acc.chapters < k) continue;
    out.push({
      kind: "recurrent-failure",
      skeleton,
      chapters: acc.chapters,
      sessions: [...acc.sessions].sort(),
      examples: acc.examples,
    });
  }
  // Strongest (most recurrent) first.
  out.sort((a, b) => b.chapters - a.chapters || b.sessions.length - a.sessions.length);
  return out;
}

/** Push a redacted, capped, de-duplicated raw failure example. */
function pushExample(examples: string[], raw: string): void {
  const ex = redact(oneLine(raw)).text.slice(0, FAILURE_EXAMPLE_MAX);
  if (ex.length > 0 && !examples.includes(ex)) examples.push(ex);
}

// ─── chapterization (compact-chapter unit; window fallback for raw transcripts) ─

/** A per-session event stream to chapterize. */
export interface SessionStream {
  session: string;
  events: ObserveEvent[];
}

/** Options for {@link chapterize}. */
export interface ChapterizeOptions {
  /**
   * When a stream carries NO compact/session_end terminators (a raw, un-marked transcript), fall
   * back to fixed-size windows of this many events as a chapter proxy. 0/undefined → the whole
   * stream is one chapter. The production path always has terminators; this is for replay corpora.
   */
  windowSize?: number;
}

/**
 * Split per-session streams into {@link Chapter}s (raw failure strings per chapter). The recurrence
 * unit is a compact CHAPTER (tally.ts): events up to and including each compact/session_end. A
 * terminator-less stream falls back to {@link ChapterizeOptions.windowSize} windows (or one chapter).
 * Only `error_summary` of failed tool_uses is collected — the recurrent-failure signal. PURE.
 */
export function chapterize(
  streams: readonly SessionStream[],
  opts: ChapterizeOptions = {},
): Chapter[] {
  const chapters: Chapter[] = [];
  for (const { session, events } of streams) {
    const hasTerminator = events.some((e) => e.type === "compact" || e.type === "session_end");
    const bounds = hasTerminator
      ? terminatorBounds(events)
      : windowBounds(events.length, opts.windowSize);
    for (const [start, end] of bounds) {
      const failures: string[] = [];
      for (let i = start; i < end; i++) {
        const e = events[i];
        if (e !== undefined && e.type === "tool_use" && e.ok === false) {
          failures.push(e.error_summary ?? e.detail ?? `${e.tool} failed`);
        }
      }
      if (failures.length > 0) chapters.push({ session, failures });
    }
  }
  return chapters;
}

/** Segment bounds [start,end) at each compact/session_end terminator (inclusive of the terminator). */
function terminatorBounds(events: ObserveEvent[]): Array<[number, number]> {
  const bounds: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e !== undefined && (e.type === "compact" || e.type === "session_end")) {
      bounds.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < events.length) bounds.push([start, events.length]); // trailing open tail.
  return bounds;
}

/** Fixed-size window bounds; window 0/undefined → a single [0,len) chapter. */
function windowBounds(len: number, windowSize?: number): Array<[number, number]> {
  if (windowSize === undefined || windowSize <= 0) return len > 0 ? [[0, len]] : [];
  const bounds: Array<[number, number]> = [];
  for (let s = 0; s < len; s += windowSize) bounds.push([s, Math.min(s + windowSize, len)]);
  return bounds;
}

// ─── ranking (a gate-adjudicated hypothesis, NOT a locked principle — ADR-0028 §6) ─

/** Options for {@link rankProseCandidates}. */
export interface RankOptions {
  /** Max candidates surfaced (default: unbounded). Mirrors stagingBudget at the call site. */
  cap?: number;
}

/**
 * Rank prose candidates (ADR-0028 §6). The starting order is a HYPOTHESIS the replay gate
 * adjudicates — NOT a locked principle (Faultline hard-coded "corrections > failures" and the gate
 * disproved exactly that): recurrent-failures by distinct-chapter count, then cue-corrections, then
 * cue-less corrections. Per-type keep-rates from the gate set the real order. PURE.
 */
export function rankProseCandidates(
  candidates: readonly ProseCandidate[],
  opts: RankOptions = {},
): ProseCandidate[] {
  const rank = (c: ProseCandidate): number => {
    if (c.kind === "recurrent-failure") return 0;
    return c.cue ? 1 : 2;
  };
  const ordered = [...candidates].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    // Within recurrent-failures, the more-recurrent first.
    if (a.kind === "recurrent-failure" && b.kind === "recurrent-failure") {
      return b.chapters - a.chapters || b.sessions.length - a.sessions.length;
    }
    return 0;
  });
  return opts.cap !== undefined && opts.cap >= 0 ? ordered.slice(0, opts.cap) : ordered;
}
