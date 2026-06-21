// `mage nudge` (ADR-0009 §24 step 2; ADR-0029; ADR-0030). The Claude-Code adapter's boundary
// SAFETY-NET + work-list for the organic grooming loop. Fired from a SessionStart hook on
// `compact` / `startup` / `resume` (NOT `clear`). On `compact` it renders the just-closed
// chapter's earned-signals (failures, external commands, corrections) into a read-only DIGEST;
// at every firing source it also surfaces a deterministic three-part capped BACKLOG tally
// (staged drafts · unmined closed chapters · graduation-eligible signatures, ADR-0030 §2) and
// templates a per-AUTONOMY-LEVEL mandate (operator/approver/overseer) into `additionalContext`
// for the host agent. mage does NOT decide what a lesson is, never calls a model, and NEVER
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

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { computeDigest, lastClosedChapter, renderDigest } from "../distill/digest.js";
import { distillWatermarkPath } from "../distill/watermark.js";
import { readSessionStreams } from "../distill/reader.js";
import { type BacklogTally, computeBacklog } from "../grooming/backlog.js";
import { type Autonomy, mandateFor } from "../grooming/autonomy-ladder.js";
import { readGrooming } from "../grooming/config.js";
import type { ObserveEvent } from "../observe/types.js";
import {
  type ResolvedDocsRoot,
  absolutePath,
  learningsPath,
  metricsPath,
  resolveDocsRoot,
  stagingPath,
} from "../paths.js";

/** Anti-nag throttle + mtime cache: the backlog reminder fires at most once per window. */
const NUDGE_THROTTLE_FILE = "nudge-throttle.json";
/** Fallback backlog-reminder window when `grooming.nudgeThrottleHours` is absent/junk (ADR-0030 §5). */
const DEFAULT_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours
const MS_PER_HOUR = 60 * 60 * 1000;

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
  /** The additionalContext nudge (digest and/or backlog mandate), or null when nothing surfaced. */
  nudge: string | null;
}

const NONE: NudgeResult = { ran: false, drafted: 0, pending: 0, nudge: null };

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
 * (never throttled — new content each compact); at every source, append the per-autonomy-level
 * BACKLOG mandate when the throttle window has elapsed (ADR-0030 §5). NO drafts are written. The
 * three-part tally is mtime-gated so a no-new-scratch startup reuses cached counts.
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

  // The backlog line is throttled (once per window, all sources); the digest is not.
  const throttlePath = join(metricsPath(root), NUDGE_THROTTLE_FILE);
  const windowMs = throttleWindowMs(nudgeThrottleHours);
  const showBacklog = hasBacklog(tally) && (force || (await throttleElapsed(throttlePath, windowMs)));
  const mandate = showBacklog ? renderMandate(level, tally) : "";
  if (showBacklog) await writeThrottle(throttlePath, Date.now());

  const nudge = composeNudge(rendered, mandate);
  if (nudge === null) return { ran: true, drafted: 0, pending, nudge: null };
  return { ran: true, drafted: 0, pending, nudge };
}

/** Join the fresh digest and the backlog mandate; null when neither has anything to say. */
function composeNudge(digest: string, mandate: string): string | null {
  if (digest.length > 0 && mandate.length > 0) return `${digest}\n\n${mandate}`;
  if (digest.length > 0) return digest;
  if (mandate.length > 0) return mandate;
  return null;
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
  const cached = await readThrottle(join(metricsPath(root), NUDGE_THROTTLE_FILE));
  if (fp.length > 0 && cached.fp === fp && cached.tally) return cached.tally;
  const tally = await computeBacklog(root, sensitivity);
  // Persist the fresh fingerprint + tally so a later no-change startup skips the scan. The
  // throttle timestamp is written separately when the backlog line actually surfaces.
  await writeThrottle(join(metricsPath(root), NUDGE_THROTTLE_FILE), undefined, fp, tally);
  return tally;
}

/**
 * An mtime fingerprint of the scratch that feeds the backlog scan: the `.learnings/` dir mtime
 * (new/removed/rewritten session streams bump it), the distill watermark file mtime (a `mage
 * distill --seen` advances the unmined cursor), and the `.mage/staging/` dir mtime (a `mage stage`
 * adds a draft / a groom drains one — the staged count must not go stale across a stage/groom that
 * never touched `.learnings/`). "" when none can be stat'd → never gate (always recompute), the
 * safe-open behaviour.
 */
async function scratchFingerprint(root: string): Promise<string> {
  const parts: string[] = [];
  try {
    parts.push(String((await stat(learningsPath(root))).mtimeMs));
  } catch {
    // No `.learnings/` yet — leave it out; the watermark/staging may still pin the fingerprint.
  }
  try {
    parts.push(String((await stat(distillWatermarkPath(root))).mtimeMs));
  } catch {
    // No watermark yet — distill has not run; fine.
  }
  try {
    parts.push(String((await stat(stagingPath(root))).mtimeMs));
  } catch {
    // No `.mage/staging/` yet — nothing staged; fine.
  }
  return parts.join(":");
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

// ─── throttle + mtime-cache file I/O ─────────────────────────────────────────────

/** The throttle window in ms: a positive `nudgeThrottleHours` (from {@link readGrooming}) → ms, else the 4h default. */
function throttleWindowMs(hours: number | undefined): number {
  if (typeof hours === "number" && Number.isFinite(hours) && hours > 0) return hours * MS_PER_HOUR;
  return DEFAULT_THROTTLE_MS;
}

/** True iff the backlog window has elapsed since the last surfaced reminder (fail-open: yes). */
async function throttleElapsed(path: string, windowMs: number): Promise<boolean> {
  const { lastNudge } = await readThrottle(path);
  return Date.now() - lastNudge >= windowMs;
}

interface ThrottleState {
  /** Epoch ms of the last surfaced backlog reminder (0 = never). */
  lastNudge: number;
  /** The scratch mtime fingerprint at the last tally compute ("" = none cached). */
  fp: string;
  /** The cached three-part tally, when a fingerprint pinned it. */
  tally?: BacklogTally;
}

async function readThrottle(path: string): Promise<ThrottleState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const lastNudge = typeof parsed.lastNudge === "number" ? parsed.lastNudge : 0;
    const fp = typeof parsed.fp === "string" ? parsed.fp : "";
    const tally = isBacklogTally(parsed.tally) ? parsed.tally : undefined;
    return { lastNudge, fp, tally };
  } catch {
    return { lastNudge: 0, fp: "" }; // missing/corrupt → never throttled, no cache.
  }
}

/** Narrow a parsed value to a BacklogTally (drops a partial/corrupt cache). */
function isBacklogTally(v: unknown): v is BacklogTally {
  if (v === null || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.staged === "number" &&
    typeof t.unmined === "number" &&
    typeof t.unminedCapped === "boolean" &&
    typeof t.graduable === "number"
  );
}

/**
 * Persist the throttle/cache file. When `lastNudge` is given it stamps the reminder time; the `fp` +
 * `tally` (mtime cache) are merged with whatever is already on disk so a tally recompute does not
 * reset the throttle clock and vice versa. Fail-open: a write failure must never break session start.
 */
async function writeThrottle(
  path: string,
  lastNudge?: number,
  fp?: string,
  tally?: BacklogTally,
): Promise<void> {
  try {
    const prev = await readThrottle(path);
    const next: ThrottleState & { v: number } = {
      v: 2,
      lastNudge: lastNudge ?? prev.lastNudge,
      fp: fp ?? prev.fp,
      tally: tally ?? prev.tally,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(next)}\n`);
  } catch {
    // Fail-open: a throttle write failure must never break the host session start.
  }
}

// ─── stdout contract ─────────────────────────────────────────────────────────────

/**
 * Emit the nudge as Claude Code `additionalContext`. The structured form is the documented
 * contract for a SessionStart hook (plain stdout also works); exit 0 is required for stdout to
 * be consumed.
 */
export function emitAdditionalContext(context: string): void {
  const out = {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  };
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
 * on stdin, extracts `source`/`cwd`, runs the nudge, and emits the additionalContext
 * line. Wrapped fail-open: any error → silent exit 0 (a boundary nudge must never
 * break the host's session start).
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
        if (result.nudge !== null) emitAdditionalContext(result.nudge);
      } catch {
        // Fail open: a boundary nudge never breaks the host session start.
      }
    });
}
