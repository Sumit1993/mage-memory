// `mage nudge` (ADR-0009 §24 step 2; ADR-0029). The Claude-Code adapter's boundary
// SAFETY-NET for the organic grooming loop. Fired from a SessionStart hook; on
// `source: "compact"` it renders the just-closed chapter's earned-signals (failures,
// external commands, corrections) into a read-only DIGEST and surfaces it as
// `additionalContext` for the host agent to MINE — the agent stages any durable lesson
// via inline `mage stage`. mage does NOT decide what a lesson is (two pre-registered
// replay gates killed deterministic candidate-selection — ADR-0027/0028; the digest→agent
// pivot is ADR-0029): the deterministic layer NARROWS, the host model JUDGES, the human at
// `mage:groom` confirms. Inline capture stays PRIMARY (AGENTS.md); the digest only catches
// what the agent forgot. Verified hook contract: SessionStart carries `source` and its
// structured stdout becomes context; SessionEnd cannot inject context, so it is NOT used
// here. NEVER throws to the host (fail-open, exit 0).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { computeDigest, lastClosedChapter, renderDigest } from "../distill/digest.js";
import { readSessionStreams } from "../distill/reader.js";
import { readStagedDrafts, type StagedDraft } from "../grooming/staging.js";
import type { ObserveEvent } from "../observe/types.js";
import { absolutePath, learningsPath, metricsPath, resolveDocsRoot, stagingPath } from "../paths.js";

/** Anti-nag throttle: a pending-batch reminder fires at most once per window. */
const NUDGE_THROTTLE_FILE = "nudge-throttle.json";
const NUDGE_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface NudgeOptions {
  /** Working directory used to resolve the KB (default: cwd). */
  cwd?: string;
  /** The hook `source`; only "compact" acts (others are a no-op). */
  source?: string;
  /** Bypass the anti-nag throttle (testing / explicit re-nudge). */
  force?: boolean;
}

export interface NudgeResult {
  /** True when the nudge acted (source was "compact" and a KB resolved). */
  ran: boolean;
  /** Always 0 — the digest path writes no drafts (ADR-0029); kept for the result shape. */
  drafted: number;
  /** Total drafts pending in `.mage/staging/` after the run. */
  pending: number;
  /** The one-line additionalContext nudge, or null when nothing was surfaced. */
  nudge: string | null;
}

const NONE: NudgeResult = { ran: false, drafted: 0, pending: 0, nudge: null };

/**
 * Render the just-closed chapter's earned-signal DIGEST and COMPUTE the nudge (ADR-0029). Pure of
 * stdout — the caller (the hook command) emits `nudge` as additionalContext — so this is directly
 * unit-testable. May throw in tests; the command wraps it fail-open.
 */
export async function nudgeCmd(opts: NudgeOptions): Promise<NudgeResult> {
  // Only the post-compaction boundary reflects + nudges. Other SessionStart sources
  // (startup/resume/clear) are no-ops — nothing closed to reflect on.
  if (opts.source !== "compact") return NONE;

  const resolved = await resolveDocsRoot(absolutePath(opts.cwd ?? process.cwd())).catch(() => null);
  if (!resolved) return NONE;
  const { root } = resolved;
  return await digestNudge(root, stagingPath(root), opts.force === true);
}

// ─── the digest nudge (ADR-0029) ───────────────────────────────────────────────

/**
 * Render the just-closed chapter's earned-signal DIGEST as the nudge (the host agent mines it and
 * stages durable lessons via `mage stage`). NO drafts are written — `.mage/staging/` holds only
 * agent-chosen lessons. Surfaces a fresh digest whenever one exists; otherwise falls back to the
 * throttled pending-drafts reminder. `drafted` is always 0.
 */
async function digestNudge(root: string, stagingDir: string, force: boolean): Promise<NudgeResult> {
  const streams = await readSessionStreams(learningsPath(root)).catch(
    () => [] as Array<{ session: string; events: ObserveEvent[] }>,
  );
  const chapter = latestClosedChapter(streams);
  const rendered = chapter.length > 0 ? renderDigest(computeDigest(chapter)) : "";
  const pending = (await readStagedDrafts(stagingDir).catch(() => [] as StagedDraft[])).length;

  if (rendered.length > 0) {
    const note =
      pending > 0
        ? `\n\n(${pending} lesson draft${plural(pending)} also pending in .mage/staging/ — review with \`mage:groom\`.)`
        : "";
    return { ran: true, drafted: 0, pending, nudge: rendered + note };
  }
  // No fresh chapter to surface → the throttled pending-batch reminder (or nothing).
  const nudge = await pendingReminder(root, pending, force);
  return { ran: true, drafted: 0, pending, nudge };
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

// ─── anti-nag nudge decision ───────────────────────────────────────────────────

/**
 * The throttled pending-batch reminder — used when no fresh digest is surfaced (e.g. nothing closed
 * since last time, but agent-staged drafts still await `mage:groom`). Reminds at most once per
 * {@link NUDGE_THROTTLE_MS}; null when nothing is pending or the window has not elapsed. Persists the
 * throttle timestamp when it surfaces.
 */
async function pendingReminder(root: string, pending: number, force: boolean): Promise<string | null> {
  if (pending === 0) return null; // nothing to say.
  const throttlePath = join(metricsPath(root), NUDGE_THROTTLE_FILE);
  if (!force) {
    const last = await readThrottle(throttlePath);
    if (Date.now() - last < NUDGE_THROTTLE_MS) return null; // a recent reminder already fired.
  }
  await writeThrottle(throttlePath, Date.now());
  return `mage: ${pending} lesson draft${plural(pending)} pending in .mage/staging/ — review with \`mage:groom\`.`;
}

async function readThrottle(path: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { lastNudge?: unknown };
    return typeof parsed.lastNudge === "number" ? parsed.lastNudge : 0;
  } catch {
    return 0; // missing/corrupt → never throttled.
  }
}

async function writeThrottle(path: string, ts: number): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ v: 1, lastNudge: ts })}\n`);
  } catch {
    // Fail-open: a throttle write failure must never break the host session start.
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/**
 * Emit a one-line nudge as Claude Code `additionalContext`. The structured form is
 * the documented contract for a SessionStart hook (plain stdout also works); exit 0
 * is required for stdout to be consumed.
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
      "Hook-fired boundary nudge: on a post-compaction SessionStart, surface the closed chapter's earned-signal digest (failures, external commands, corrections) for the agent to mine and `mage stage` (ADR-0029; never blocks the host)",
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
