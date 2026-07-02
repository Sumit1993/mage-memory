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
import { computeDigest, lastClosedChapter, renderDigest } from "../../distill/digest.js";
import { readSessionStreams } from "../../distill/reader.js";
import { type BacklogTally, computeBacklog } from "../../grooming/backlog.js";
import { type Autonomy, mandateFor } from "../../grooming/autonomy-ladder.js";
import { readGrooming } from "../../grooming/config.js";
import type { ObserveEvent } from "../../observe/types.js";
import { type ResolvedDocsRoot, absolutePath, learningsPath, resolveDocsRoot } from "../../paths.js";
import {
  cacheTally,
  cachedTally,
  elapsedSince,
  elapsedSinceDream,
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
 * Compose the boundary nudge: on `compact`, render the just-closed chapter's earned-signal DIGEST
 * (never throttled — new content each compact); append the per-autonomy-level BACKLOG mandate when
 * the throttle window has elapsed — or immediately on `compact`, which bypasses the window so a
 * `resume` firing seconds earlier can't eat it (ADR-0030 §5). NO drafts are written. The three-part
 * tally is mtime-gated so a no-new-scratch startup reuses cached counts.
 */
async function digestNudge(resolved: ResolvedDocsRoot, source: string, force: boolean): Promise<NudgeResult> {
  const { root } = resolved;

  // The fresh-chapter digest only exists on `compact` (a chapter just closed); startup/resume
  // carry no fresh chapter, so they ride the backlog reminder alone.
  let rendered = "";
  if (source === "compact") {
    const streams = await readSessionStreams(learningsPath(root)).catch(
      () => [] as Array<{ session: string; events: ObserveEvent[] }>,
    );
    const chapter = latestClosedChapter(streams);
    rendered = chapter.length > 0 ? renderDigest(computeDigest(chapter)) : "";
  }

  // One grooming-config read (config.ts) feeds the level, the dial, and the throttle window —
  // replacing three separate metadata reads (and the old lazy import that dodged a paths cycle).
  const { autonomy: level, sensitivity, nudgeThrottleHours } = await readGrooming(resolved).catch(
    () => ({ autonomy: "operator" as Autonomy, sensitivity: "normal" as const, nudgeThrottleHours: undefined }),
  );
  const tally = await backlogTally(root, sensitivity);
  const pending = tally.staged;

  // The backlog line rides a throttle (once per window) so routine startups/resumes don't re-nag —
  // EXCEPT on `compact`, a real chapter boundary the user expects to see. The morning resume→compact
  // pattern fires a `resume` seconds before the `compact`; the resume used to arm the throttle and eat
  // the compact's line, so `compact` now bypasses the window (the digest was never throttled either).
  const windowMs = throttleWindowMs(nudgeThrottleHours);
  const throttleElapsed = force || source === "compact" || (await elapsedSince(root, windowMs));
  const showBacklog = hasBacklog(tally) && throttleElapsed;
  const mandate = showBacklog ? renderMandate(level, tally) : "";
  if (showBacklog) await markReminded(root);

  // The weekly dream-health tick — a read-only rot summary on its own slow clock.
  const health = await healthTick(root, force);

  // additionalContext (model-only): the digest + autonomy mandate + a health block that tells the
  // agent to OFFER the read-only scan (not just see the finding). systemMessage (user-visible): the
  // terse line the human sees in the terminal — the same health summary, without the agent instruction.
  const nudge = composeContext(rendered, mandate, healthContext(health));
  const notice = noticeLine(tally, showBacklog, health);
  return { ran: true, drafted: 0, pending, nudge, notice };
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
 * The user-facing systemMessage (terminal-visible): a terse line the HUMAN sees — the backlog
 * call-to-action when the reminder fired, and/or the health summary. null when neither surfaced.
 * (`additionalContext` is model-only; `systemMessage` is the channel Claude Code renders to the
 * user — so the boundary nudge is no longer invisible to the person doing the work.)
 */
function noticeLine(t: BacklogTally, showBacklog: boolean, health: string): string | null {
  const lines: string[] = [];
  if (showBacklog) {
    const unmined = t.unminedCapped ? "9+" : String(t.unmined);
    lines.push(
      `mage · ${t.staged} staged · ${unmined} unmined · ${t.graduable} graduable — ` +
        "`mage:groom` to file, `mage:learn` to capture one.",
    );
  }
  if (health.length > 0) lines.push(health);
  return lines.length > 0 ? lines.join("\n") : null;
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

// ─── backlog tally (mtime-gated) ─────────────────────────────────────────────────

/** True iff any of the three backlog parts has something to report. */
function hasBacklog(t: BacklogTally): boolean {
  return t.staged > 0 || t.unmined > 0 || t.graduable > 0;
}

/**
 * The three-part capped backlog tally, MTIME-GATED (ADR-0030 §5): recompute only when `.learnings/`
 * or the distill watermark changed since the last nudge; otherwise reuse the cached counts so a
 * no-new-scratch startup stays ~instant. Fail-open — a stat/read miss recomputes (never throttles).
 */
async function backlogTally(root: string, sensitivity: "low" | "normal" | "high"): Promise<BacklogTally> {
  const fp = await scratchFingerprint(root);
  const cached = await cachedTally(root, fp);
  if (cached) return cached;
  const tally = await computeBacklog(root, sensitivity);
  // Pin the fresh fingerprint + tally so a later no-change startup skips the scan (the reminder
  // clock is stamped separately, by markReminded, when the backlog line actually surfaces).
  await cacheTally(root, fp, tally);
  return tally;
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
