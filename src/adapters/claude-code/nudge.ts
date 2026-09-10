// `mage nudge` (ADR-0009; ADR-0029; ADR-0030).
// On the Stop hook, emits a one-line session receipt (denied, corrected, new signatures, guard fires).
// On SessionStart (compact/startup/resume), plain startup is quiet unless a proposal is waiting or
// an external hub/grant check failed.
// Never blocks or throws to the host (fail-open, exit 0).

import { Command } from "commander";
import { readProposals } from "../../grooming/proposals.js";
import { measureFootprint } from "../../metrics/footprint.js";
import { appendTrendRow, type FootprintTrendRow } from "../../metrics/footprint-trend.js";
import {
  absolutePath,
  externalDocsRoot,
  findCodeRepoRoot,
  hubUnreachableMessage,
  redactUrl,
  resolveDocsRoot,
} from "../../paths.js";
import { reachGrantStatus } from "../../reach-grant.js";
import {
  type SessionReceiptCounts,
  computeReceipt,
  formatReceipt,
  sessionReceiptNudge,
} from "./receipt.js";

export { computeReceipt, formatReceipt, type SessionReceiptCounts };

/** SessionStart sources that fire the nudge (ADR-0030): NOT `clear`. */
const FIRING_SOURCES = new Set(["compact", "startup", "resume"]);

export interface NudgeOptions {
  /** Working directory used to resolve the KB (default: cwd). */
  cwd?: string;
  /** The hook `source`; only compact/startup/resume act (clear + others are a no-op). */
  source?: string;
  /** The observe session id from the hook. */
  sessionId?: string;
  /** Bypass checks (testing / explicit re-nudge). Kept for interface compatibility. */
  force?: boolean;
  /** Hook event name (e.g. "Stop" or "SessionStart"). */
  hookEventName?: string;
}

export interface NudgeResult {
  /** True when the nudge acted (a firing source AND a KB resolved). */
  ran: boolean;
  /** Always 0 (kept for interface compatibility). */
  drafted: number;
  /** Total staged drafts pending in `.mage/staging/` after the run. */
  pending: number;
  /** The model-only additionalContext, or null when nothing surfaced. */
  nudge: string | null;
  /** The user-visible systemMessage (terminal-rendered), or null when nothing needs the human's eye. */
  notice: string | null;
}

const NONE: NudgeResult = { ran: false, drafted: 0, pending: 0, nudge: null, notice: null };

/**
 * Handle boundary nudge execution.
 * On Stop: compute and emit the one-line session receipt.
 * On SessionStart: quiet unless a proposal is waiting or a check failed.
 * Pure of stdout so it is directly unit-testable.
 */
export async function nudgeCmd(opts: NudgeOptions): Promise<NudgeResult> {
  const isStop = opts.hookEventName === "Stop" || opts.source === "stop";
  const isSessionStart = !isStop && Boolean(opts.source && FIRING_SOURCES.has(opts.source));

  if (!isStop && !isSessionStart) return NONE;

  const abs = absolutePath(opts.cwd ?? process.cwd());

  if (isStop) {
    const resolved = await resolveDocsRoot(abs).catch(() => null);
    if (!resolved) return NONE;
    return sessionReceiptNudge(resolved, opts.sessionId);
  }

  const codeRepo = await findCodeRepoRoot(abs).catch(() => null);
  if (codeRepo) {
    const external = await externalDocsRoot(codeRepo).catch(() => null);
    if (external?.kind === "hub-unreachable") {
      const target = external.expectedAddress ? redactUrl(external.expectedAddress) : external.expectedPath;
      const notice = target
        ? `mage · external hub is unreachable: ${target}`
        : "mage · external hub is unreachable";
      return {
        ran: true,
        drafted: 0,
        pending: 0,
        nudge: hubUnreachableMessage(external, { forAgent: true }),
        notice,
      };
    }
  }

  const resolved = await resolveDocsRoot(abs).catch(() => null);
  if (!resolved) return NONE;

  const grant = await grantNudge(abs).catch(() => null); // fail-open: a broken grant must never break a session

  try {
    const session = opts.sessionId && opts.sessionId.trim().length > 0 ? opts.sessionId.trim() : "unknown";
    const footprint = await measureFootprint(resolved.root);
    const row: FootprintTrendRow = {
      session,
      ts: new Date().toISOString(),
      bytes: footprint.budget.usedBytes,
      lines: footprint.budget.usedLines,
      ratio: footprint.budget.ratio,
      state: footprint.budget.state,
      notes: footprint.yield.notesTracked,
    };
    await appendTrendRow(resolved.root, row);
  } catch {
    // Fail open: sampler must not throw, must not block, must not change hook output.
  }

  const proposals = await readProposals(resolved.root).catch(() => []);
  const proposalNotice = proposalNoticeLine(proposals.length);

  const notice = joinNotice(grant?.notice, proposalNotice);
  const nudge = grant?.context ?? null;

  return { ran: true, drafted: 0, pending: 0, nudge, notice };
}

function proposalNoticeLine(count: number): string | null {
  if (count <= 0) return null;
  const word = count === 1 ? "proposal is" : "proposals are";
  return `mage · ${count} ${word} waiting`;
}

async function grantNudge(cwd: string): Promise<{ notice: string; context: string } | null> {
  const status = await reachGrantStatus(cwd);
  switch (status.kind) {
    case "not-applicable":
    case "absent":
    case "granted":
      return null;
    case "missing":
      if (status.mode === "hybrid") {
        return {
          notice: `mage · the harness has no access grant for the external hub at ${status.roots.join(", ")} — run \`mage connect\``,
          context: `This repo references an external hub at ${status.roots.join(", ")}, and Claude Code's permissions.additionalDirectories carries no grant for it in either settings scope. In-repo notes under mage/ are readable, and only the external hub is unreachable. Ask the user to run \`mage connect\` in this repo; that is the only fix. Do NOT run \`mage init\` here: it would mint a SECOND knowledge base.`,
        };
      }
      return {
        notice: `mage · the harness has no access grant for the knowledge base at ${status.roots.join(", ")} — run \`mage connect\``,
        context: `This repo's knowledge base lives outside the project root at ${status.roots.join(", ")}, and Claude Code's permissions.additionalDirectories carries no grant for it in either settings scope, so you cannot read a single note. Ask the user to run \`mage connect\` in this repo; that is the only fix. Do NOT run \`mage init\` here: it would mint a SECOND knowledge base.`,
      };
    case "mismatch":
      return {
        notice: `mage · hub mismatch — never reused, never clobbered: ${status.details.join("; ")}`,
        context: `The hub this repo points at resolves to a clone of a different remote (${status.details.join("; ")}). mage will not reuse or overwrite it. Ask the user to fix that clone's remote or re-run \`mage link <address>\` here. Do NOT run \`mage init\`.`,
      };
  }
}

function joinNotice(...parts: (string | null | undefined)[]): string | null {
  const present = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return present.length > 0 ? present.join("\n") : null;
}

// ─── stdout contract ─────────────────────────────────────────────────────────────

/**
 * Emit the boundary nudge to Claude Code on its two channels. `systemMessage` is USER-VISIBLE —
 * Claude Code renders it in the terminal.
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

// ─── hook stdin (mirrors observe.ts fail-open contract) ──────────────────────

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
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

// ─── CLI registration ────────────────────────────────────────────────────────────

/**
 * Build the `nudge` plumbing-tier command. Reads the hook JSON on stdin, extracts options,
 * and emits the user-visible `systemMessage` + optional model context.
 * Wrapped fail-open: any error → silent exit 0.
 */
export function buildNudgeCommand(): Command {
  return new Command("nudge")
    .description(
      "Hook-fired boundary nudge: on Stop, emit a one-line session receipt; on SessionStart (compact/startup/resume), alert if a proposal is waiting or a check failed (never blocks the host)",
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
          sessionId: str(payload?.session_id) ?? str(payload?.sessionId),
          hookEventName: str(payload?.hook_event_name),
        });
        emitNudge(result.notice, result.nudge);
      } catch {
        // Fail open: a boundary nudge never breaks the host session.
      }
    });
}
