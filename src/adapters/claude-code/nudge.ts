// `mage nudge` (ADR-0009 §24 step 2; ADR-0029; ADR-0030). The Claude-Code adapter's boundary
// SAFETY-NET + work-list for the organic grooming loop. Fired from a SessionStart hook on
// `compact` / `startup` / `resume` (NOT `clear`). On `compact` it renders the just-closed
// chapter's earned-signals (failures, external commands, corrections) into a read-only DIGEST;
// at every firing source it also surfaces a deterministic three-part capped BACKLOG tally
// (staged drafts · unmined closed chapters · graduation-eligible signatures, ADR-0030 §2) and
// templates a per-AUTONOMY-LEVEL mandate (operator/approver/overseer). It emits on TWO channels:
// a user-visible `systemMessage` (the terse line the human sees in the terminal) and the
// model-only `additionalContext` (the digest + mandate the agent acts on). The mandate is written
// to be ACTED ON warmly: at operator the agent offers in its own voice and names a genuine keeper
// from the digest (it does not relay the raw tally); at approver/overseer it is authorized to groom
// and then tells the user what it filed. A weekly DREAM-HEALTH tick folds a read-only rot summary
// (stale · dangling · orphans) into both channels on its own clock — and, on the model channel,
// asks the agent to OFFER `mage dream`. mage
// does NOT decide what a lesson is, never calls a model, and NEVER
// commits (ADR-0009/0013): the deterministic layer NARROWS + templates a mandate, the host model
// JUDGES + writes uncommitted, the human's git commit confirms. Inline capture stays PRIMARY
// (AGENTS.md); the digest only catches what the agent forgot.
//
// Throttle: the fresh-chapter digest is NEVER throttled (new content each compact); the BACKLOG
// line is throttled to once per window (grooming.nudgeThrottleHours ?? 4h) across all sources.
// The backlog scan is mtime-gated — a no-new-scratch startup reuses the cached counts so it stays
// ~instant. Verified hook contract: SessionStart carries `source` and its structured stdout
// becomes context; SessionEnd cannot inject context, so it is NOT used here. NEVER throws to the
// host (fail-open, exit 0).

import { Command } from "commander";
import { type DreamReport, analyzeDream } from "../../dream.js";
import { type Digest, computeDigest, lastClosedChapter, renderDigest } from "../../distill/digest.js";
import { readSessionStreams } from "../../distill/reader.js";
import { type BacklogTally, computeBacklogFromStreams } from "../../grooming/backlog.js";
import { type Autonomy, mandateFor } from "../../grooming/autonomy-ladder.js";
import { readGrooming } from "../../grooming/config.js";
import { type KeepRateSummary, reconcileKeepRate, summarizeKeepRate } from "../../grooming/reconcile.js";
import type { ObserveEvent } from "../../observe/types.js";
import { type ResolvedDocsRoot, absolutePath, learningsPath, resolveDocsRoot } from "../../paths.js";
import {
  cacheTally,
  cachedTally,
  elapsedSince,
  elapsedSinceDream,
  lastShownChapterTs,
  markChapterShown,
  markDreamShown,
  markReminded,
  scratchFingerprint,
} from "./nudge-state.js";

/** Fallback backlog-reminder window when `grooming.nudgeThrottleHours` is absent/junk (ADR-0030 §5). */
const DEFAULT_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours
const MS_PER_HOUR = 60 * 60 * 1000;

/** The dream-health tick runs on its own slow clock — a read-only rot scan at most once per week. */
const DREAM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** SessionStart sources that fire the nudge (ADR-0030 §5): NOT `clear`. */
const FIRING_SOURCES = new Set(["compact", "startup", "resume"]);

/**
 * The offer-first instruction appended to the digest on session ENTRY (startup/resume) — ADR-0030
 * amendment §4. The compact path carries its own autonomy mandate; on entry the agent must NAME a
 * genuine keeper and offer, never auto-file, whatever the autonomy level (opening the CLI is the
 * user's moment). Kept out of the compact path so compact behaviour is unchanged.
 */
const ENTRY_DIGEST_NOTE =
  "(session start) The digest above is from your LAST session's final chapter. If one entry is a " +
  "genuine keeper (a gotcha, a hard-won procedure, an env/API constraint), name it to the user in a " +
  "line and offer to capture it with `mage:learn` — do NOT auto-file on entry, whatever the autonomy level.";

export interface NudgeOptions {
  /** Working directory used to resolve the KB (default: cwd). */
  cwd?: string;
  /** The hook `source`; only compact/startup/resume act (clear + others are a no-op). */
  source?: string;
  /** Bypass the anti-nag throttle (testing / explicit re-nudge). */
  force?: boolean;
}

export interface NudgeResult {
  /** True when the nudge acted (a firing source AND a KB resolved). */
  ran: boolean;
  /** Always 0 — the digest path writes no drafts (ADR-0029); kept for the result shape. */
  drafted: number;
  /** Total staged drafts pending in `.mage/staging/` after the run. */
  pending: number;
  /** The model-only additionalContext (digest · mandate · health), or null when nothing surfaced. */
  nudge: string | null;
  /** The user-visible systemMessage (terminal-rendered), or null when nothing needs the human's eye. */
  notice: string | null;
}

const NONE: NudgeResult = { ran: false, drafted: 0, pending: 0, nudge: null, notice: null };

/**
 * Render the boundary nudge (ADR-0029 digest + ADR-0030 autonomy-scaled backlog mandate) and COMPUTE
 * the result. Pure of stdout — the caller (the hook command) emits `nudge` as additionalContext — so
 * this is directly unit-testable. May throw in tests; the command wraps it fail-open.
 */
export async function nudgeCmd(opts: NudgeOptions): Promise<NudgeResult> {
  // Only compact/startup/resume reflect + nudge; `clear` (and any other source) is a no-op.
  if (!opts.source || !FIRING_SOURCES.has(opts.source)) return NONE;

  const resolved = await resolveDocsRoot(absolutePath(opts.cwd ?? process.cwd())).catch(() => null);
  if (!resolved) return NONE;
  return await digestNudge(resolved, opts.source, opts.force === true);
}

// ─── the digest + backlog nudge (ADR-0029 / ADR-0030) ───────────────────────────

/**
 * Compose the boundary nudge: render the last-closed chapter's earned-signal DIGEST on ANY firing
 * source (ADR-0030 amendment — a chapter is closed by a compact OR a session_end, so startup/resume
 * carry the prior session's final chapter), de-duped once per chapter by terminator ts; append the
 * BACKLOG mandate when the throttle window has elapsed — or immediately on `compact`, which bypasses
 * the window so a `resume` firing seconds earlier can't eat it (ADR-0030 §5). On session ENTRY the
 * mandate drops to offer-first regardless of the configured autonomy. NO drafts are written. The
 * digest + the tally SHARE ONE stream read behind the fingerprint cache (see {@link scanBoundary}),
 * so a no-new-scratch startup reads nothing and stays ~instant.
 */
async function digestNudge(resolved: ResolvedDocsRoot, source: string, force: boolean): Promise<NudgeResult> {
  const { root } = resolved;

  // One grooming-config read (config.ts) feeds the level, the dial, the throttle window, and the
  // crown threshold — replacing separate metadata reads (and the old lazy import that dodged a cycle).
  const { autonomy: level, sensitivity, nudgeThrottleHours, crownThreshold } = await readGrooming(resolved).catch(
    () => ({
      autonomy: "operator" as Autonomy,
      sensitivity: "normal" as const,
      nudgeThrottleHours: undefined,
      crownThreshold: undefined,
    }),
  );

  // ONE fingerprint-gated scan feeds both the digest and the tally from a single stream read.
  const { tally, chapter } = await scanBoundary(root, sensitivity, source, force);
  const pending = tally.staged;

  // The backlog line rides a throttle (once per window) so routine startups/resumes don't re-nag —
  // EXCEPT on `compact`, a real chapter boundary the user expects to see. The morning resume→compact
  // pattern fires a `resume` seconds before the `compact`; the resume used to arm the throttle and eat
  // the compact's line, so `compact` now bypasses the window.
  const windowMs = throttleWindowMs(nudgeThrottleHours);
  const throttleElapsed = force || source === "compact" || (await elapsedSince(root, windowMs));
  const showBacklog = hasBacklog(tally) && throttleElapsed;
  // Offer-first on session ENTRY (ADR-0030 amendment §4): the backlog mandate is scaled by the
  // configured autonomy only on `compact`; on startup/resume it drops to the operator (offer-first)
  // mandate, so opening the CLI never triggers autonomous grooming, whatever the level.
  const mandateLevel: Autonomy = source === "compact" ? level : "operator";
  const mandate = showBacklog ? renderMandate(mandateLevel, tally) : "";
  if (showBacklog) await markReminded(root);

  // Stamp the once-per-chapter watermark iff a digest surfaced this run, so the same chapter never
  // re-surfaces across the compact + startup/resume paths.
  if (chapter.chapterTs.length > 0) await markChapterShown(root, chapter.chapterTs);

  // The weekly dream-health tick — a read-only rot summary on its own slow clock.
  const health = await healthTick(root, force);

  // The autonomy reject-ledger reconcile (ADR-0031 P2) — deterministic, cheap, idempotent, so it
  // runs every firing (no slow-clock gate). Fail-open: a failed reconcile returns null (the ledger
  // is left untouched), and we summarize ONLY a non-null result — so a broken reconcile surfaces no
  // stale keep-rate line.
  const keepLedger = await reconcileKeepRate(root, resolved.repo).catch(() => null);
  const keepRate = keepLedger ? summarizeKeepRate(keepLedger) : null;

  // additionalContext (model-only): the digest (+ an offer-first note on session entry) + the autonomy
  // mandate + a health block that tells the agent to OFFER the read-only scan. systemMessage
  // (user-visible): the deterministic, UNRANKED chapter teaser + the backlog/health lines.
  const digestContext =
    chapter.rendered.length > 0 && source !== "compact"
      ? `${chapter.rendered}\n\n${ENTRY_DIGEST_NOTE}`
      : chapter.rendered;
  const nudge = composeContext(digestContext, mandate, healthContext(health));
  const notice = noticeLine(tally, showBacklog, health, chapter.teaser, keepRateLine(keepRate, crownThreshold));
  return { ran: true, drafted: 0, pending, nudge, notice };
}

// ─── the shared, fingerprint-gated boundary scan (ADR-0030 amendment) ─────────────

interface ChapterDigest {
  /** The rendered digest markdown for `additionalContext` ("" when nothing surfaced). */
  rendered: string;
  /** The deterministic, unranked one-line teaser for the user-visible `systemMessage` ("" when none). */
  teaser: string;
  /** Terminator ts of the surfaced chapter ("" when nothing surfaced) — the watermark to stamp. */
  chapterTs: string;
}

const NO_CHAPTER: ChapterDigest = { rendered: "", teaser: "", chapterTs: "" };

/**
 * The single fingerprint-gated read that feeds BOTH the backlog tally and the digest (ADR-0030
 * amendment). `computeBacklogFromStreams` already needed every session stream; the digest needs the
 * same events, so we read them ONCE and hand both consumers the result.
 *
 *  - `bypassCache = force || source === "compact"`: a `compact` closed a fresh chapter the user
 *    expects to see (and its appended terminator may not bump the scratch fingerprint), so it always
 *    re-reads — which also refreshes the tally past a would-be stale cache. `force` re-reads too.
 *  - Otherwise a fingerprint CACHE HIT (a no-new-scratch startup/resume) reuses the cached tally and
 *    skips the read entirely → NO_CHAPTER (nothing changed, so no fresh chapter to surface). This is
 *    the ~instant path. A cache MISS reads once, computes the tally, pins it, and digests the chapter.
 *
 * Fail-open throughout (every read `.catch()`'d by its callee).
 */
async function scanBoundary(
  root: string,
  sensitivity: "low" | "normal" | "high",
  source: string,
  force: boolean,
): Promise<{ tally: BacklogTally; chapter: ChapterDigest }> {
  const bypassCache = force || source === "compact";
  const fp = await scratchFingerprint(root);
  const cached = bypassCache ? null : await cachedTally(root, fp);
  if (cached) return { tally: cached, chapter: NO_CHAPTER };

  const streams = await readSessionStreams(learningsPath(root)).catch(
    () => [] as Array<{ session: string; events: ObserveEvent[] }>,
  );
  const tally = await computeBacklogFromStreams(root, sensitivity, streams);
  // Pin the fresh tally to its fingerprint so a later no-change startup skips the whole scan.
  await cacheTally(root, fp, tally);
  const chapter = await digestFromStreams(root, streams, force);
  return { tally, chapter };
}

/**
 * Build the last-closed chapter's digest from PRE-READ streams, de-duped once per chapter (ADR-0030
 * amendment). Picks the most-recently-closed chapter (latest terminator ts) and — unless it was
 * already surfaced (its terminator ts equals the stored watermark) or carries no earned signal —
 * returns the rendered digest + a deterministic teaser + the terminator ts to stamp. `force` bypasses
 * the de-dup (testing / explicit re-nudge). A no-signal chapter is deliberately NOT stamped (it's
 * cheap to re-check and never surfaces).
 */
async function digestFromStreams(
  root: string,
  streams: Array<{ session: string; events: ObserveEvent[] }>,
  force: boolean,
): Promise<ChapterDigest> {
  const chapter = latestClosedChapter(streams);
  if (chapter.length === 0) return NO_CHAPTER;
  const ts = chapter[chapter.length - 1]?.ts ?? "";
  // Once per chapter: a terminator ts equal to the stored watermark was already surfaced.
  if (!force && ts.length > 0 && ts === (await lastShownChapterTs(root))) return NO_CHAPTER;
  const digest = computeDigest(chapter);
  if (digest.isEmpty) return NO_CHAPTER; // no earned signal → surface nothing (and don't stamp).
  return { rendered: renderDigest(digest), teaser: teaserLine(digest), chapterTs: ts };
}

/**
 * The deterministic, UNRANKED chapter teaser for the user-visible systemMessage (ADR-0030 amendment
 * §3): plain-language category counts only, never a picked "keeper" — mage narrows, the agent judges
 * (ADR-0004, ADR-0029 §5). Source-neutral ("recent work" is honest for a compacted chapter, a prior
 * session, or a first-run stale one). "" when the digest carries no counted signal.
 */
function teaserLine(d: Digest): string {
  const parts: string[] = [];
  if (d.failures.total > 0) parts.push(`${d.failures.total} error${d.failures.total === 1 ? "" : "s"}`);
  if (d.commands.total > 0) {
    parts.push(`${d.commands.total} command${d.commands.total === 1 ? "" : "s"}`);
  }
  if (d.corrections.total > 0) {
    parts.push(`${d.corrections.total} correction${d.corrections.total === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "";
  return `mage · recent work: ${parts.join(" · ")} — worth saving any? \`mage:learn\``;
}

/** Join the present context parts (digest · mandate · health) with blank lines; null when all empty. */
function composeContext(...parts: string[]): string | null {
  const present = parts.filter((p) => p.length > 0);
  return present.length > 0 ? present.join("\n\n") : null;
}

/**
 * The weekly dream-health tick: when the dream window has elapsed (or `force`), run the pure,
 * index-independent {@link analyzeDream} rot scan and stamp the clock; return a one-line summary
 * ONLY when there is failure-tier rot. Fail-open — a scan error surfaces no health line, never
 * breaks the nudge. The scan is gated to ~once/week so it never costs a normal session start.
 */
async function healthTick(root: string, force: boolean): Promise<string> {
  if (!force && !(await elapsedSinceDream(root, DREAM_WINDOW_MS))) return "";
  const report = await analyzeDream(root).catch(() => null);
  await markDreamShown(root);
  return report && !report.clean ? healthLine(report) : "";
}

/**
 * The user-facing systemMessage (terminal-visible): terse lines the HUMAN sees — the deterministic,
 * unranked chapter TEASER (ADR-0030 amendment §3, shown at every source once per chapter, un-throttled),
 * the backlog call-to-action when the reminder fired, and/or the health summary. null when none
 * surfaced. (`additionalContext` is model-only; `systemMessage` is the channel Claude Code renders to
 * the user — so the boundary nudge is no longer invisible to the person doing the work.)
 */
function noticeLine(
  t: BacklogTally,
  showBacklog: boolean,
  health: string,
  teaser: string,
  keepRate: string,
): string | null {
  const lines: string[] = [];
  if (teaser.length > 0) lines.push(teaser);
  if (showBacklog) {
    const unmined = t.unminedCapped ? "9+" : String(t.unmined);
    lines.push(
      `mage · ${t.staged} staged · ${unmined} unmined · ${t.graduable} graduable — ` +
        "`mage:groom` to file, `mage:learn` to capture one.",
    );
  }
  if (health.length > 0) lines.push(health);
  if (keepRate.length > 0) lines.push(keepRate);
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * The autonomy keep-rate line (ADR-0031 P2): the crown signal over `source === "capture"`
 * terminals ONLY. "" (hidden) when the reconcile failed or there are no capture terminals yet —
 * so the line appears only once the agent's autonomous notes have actually been kept or reverted.
 */
function keepRateLine(summary: KeepRateSummary | null, crownThreshold: number | undefined): string {
  if (!summary || summary.capture.terminals < 1) return "";
  const pct = Math.round(summary.capture.rate * 100);
  const n = summary.capture.terminals;
  const threshold =
    typeof crownThreshold === "number" ? `${Math.round(crownThreshold * 100)}%` : "unset";
  return `mage · autonomy keep-rate ${pct}% (${n} note${n === 1 ? "" : "s"}, threshold ${threshold})`;
}

/**
 * The MODEL-facing health block: the one-line health summary the user also sees, plus a short
 * instruction to OFFER `mage dream` (read-only) — so the agent suggests the fix rather than
 * leaving the finding as ambient context the human never hears about. "" when there is no rot.
 */
function healthContext(health: string): string {
  if (health.length === 0) return "";
  return (
    `${health}\n` +
    "The knowledge base has some rot — when you check in with the user, offer to run `mage dream` " +
    "(read-only) so they can see the stale / dangling / orphaned notes and decide what to prune."
  );
}

/** A one-line dream-health summary (failure-tier rot only); "" when the report is clean. */
function healthLine(r: DreamReport): string {
  const parts: string[] = [];
  if (r.stale.length > 0) parts.push(`${r.stale.length} stale`);
  if (r.danglingLinks.length > 0) {
    parts.push(`${r.danglingLinks.length} dangling link${r.danglingLinks.length === 1 ? "" : "s"}`);
  }
  if (r.orphans.length > 0) parts.push(`${r.orphans.length} orphan${r.orphans.length === 1 ? "" : "s"}`);
  if (r.supersededButActive.length > 0) {
    parts.push(`${r.supersededButActive.length} superseded-but-active`);
  }
  return parts.length > 0 ? `mage health · ${parts.join(" · ")} → \`mage dream\`` : "";
}

/** Events of the MOST-recently-closed chapter across all streams (latest terminator ts wins). */
function latestClosedChapter(
  streams: Array<{ session: string; events: ObserveEvent[] }>,
): ObserveEvent[] {
  let best: ObserveEvent[] = [];
  let bestTs = "";
  for (const { events } of streams) {
    const chapter = lastClosedChapter(events);
    if (chapter.length === 0) continue;
    const ts = chapter[chapter.length - 1]?.ts ?? "";
    if (best.length === 0 || ts >= bestTs) {
      best = chapter;
      bestTs = ts;
    }
  }
  return best;
}

// ─── backlog helpers ──────────────────────────────────────────────────────────────

/** True iff any of the three backlog parts has something to report. */
function hasBacklog(t: BacklogTally): boolean {
  return t.staged > 0 || t.unmined > 0 || t.graduable > 0;
}

// ─── per-level mandate templating (ADR-0030 §5) ──────────────────────────────────

/**
 * Template the autonomy-scaled mandate: the one-line backlog tally + the level-specific instruction.
 * The per-level prose lives in the {@link mandateFor autonomy ladder}; the nudge owns only the tally
 * line it feeds in.
 */
function renderMandate(level: Autonomy, t: BacklogTally): string {
  return mandateFor(level, backlogLine(t));
}

/**
 * The one-line backlog tally (ADR-0030 §2): `mage: 3 staged · 6 chapters unmined · up to 1 eligible to
 * graduate`. The graduable part is an UPPER BOUND — `graduableTally` counts recurrence-eligible
 * signatures without subtracting already-covered notes (backlog.ts), so the phrasing conveys eligibility,
 * not an exact proposal count.
 */
function backlogLine(t: BacklogTally): string {
  const unmined = t.unminedCapped ? "9+" : String(t.unmined);
  const parts = [
    `${t.staged} staged`,
    `${unmined} chapter${t.unmined === 1 && !t.unminedCapped ? "" : "s"} unmined`,
    `up to ${t.graduable} eligible to graduate`,
  ];
  return `mage: ${parts.join(" · ")} → mage:groom`;
}

// ─── throttle window ─────────────────────────────────────────────────────────────

/** The throttle window in ms: a positive `nudgeThrottleHours` (from {@link readGrooming}) → ms, else the 4h default. */
function throttleWindowMs(hours: number | undefined): number {
  if (typeof hours === "number" && Number.isFinite(hours) && hours > 0) return hours * MS_PER_HOUR;
  return DEFAULT_THROTTLE_MS;
}

// ─── stdout contract ─────────────────────────────────────────────────────────────

/**
 * Emit the boundary nudge to Claude Code on its two channels. `systemMessage` is USER-VISIBLE —
 * Claude Code renders it in the terminal — so the human actually sees the backlog/health line.
 * `hookSpecificOutput.additionalContext` is MODEL-ONLY — injected into Claude's context, never
 * shown to the user. Either may be null (emit just the other); when both are empty, emit nothing.
 * exit 0 is required for the output to be consumed (the command always exits 0, fail-open).
 */
export function emitNudge(notice: string | null, context: string | null): void {
  const out: {
    systemMessage?: string;
    hookSpecificOutput?: { hookEventName: "SessionStart"; additionalContext: string };
  } = {};
  if (notice && notice.length > 0) out.systemMessage = notice;
  if (context && context.length > 0) {
    out.hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: context };
  }
  if (out.systemMessage === undefined && out.hookSpecificOutput === undefined) return;
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

// ─── hook stdin (mirrors observe.ts's fail-open contract) ──────────────────────

/** Drain stdin to a UTF-8 string; resolves "" on empty/closed/errored streams. */
function readStdinSafe(): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/** Parse stdin → a plain object, or null for invalid/array/primitive/null JSON. */
function parseHookPayload(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ─── CLI registration (kept next to the handler so the flag list can't drift) ──

/**
 * Build the `nudge` plumbing-tier command (ADR-0009 §24 step 2). Reads the hook JSON
 * on stdin, extracts `source`/`cwd`, runs the nudge, and emits the user-visible
 * `systemMessage` + the model-only `additionalContext`. Wrapped fail-open: any error →
 * silent exit 0 (a boundary nudge must never break the host's session start).
 */
export function buildNudgeCommand(): Command {
  return new Command("nudge")
    .description(
      "Hook-fired boundary nudge: on a SessionStart (compact/startup/resume), surface the closed chapter's earned-signal digest plus the autonomy-scaled grooming backlog for the agent to mine and `mage stage`/`mage:groom` (ADR-0029/0030; never blocks the host)",
    )
    .option(
      "--cwd <dir>",
      "working directory used to locate the knowledge base (overrides the hook JSON cwd; defaults to it, then process.cwd())",
    )
    .action(async (opts: { cwd?: string }) => {
      try {
        const raw = await readStdinSafe();
        const payload = raw.trim().length === 0 ? null : parseHookPayload(raw);
        const result = await nudgeCmd({
          cwd: opts.cwd ?? str(payload?.cwd),
          source: str(payload?.source),
        });
        emitNudge(result.notice, result.nudge);
      } catch {
        // Fail open: a boundary nudge never breaks the host session start.
      }
    });
}
