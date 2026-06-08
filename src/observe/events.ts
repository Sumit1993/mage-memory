// Event construction + deterministic per-tool extraction (ADR-0015 §4/§5) +
// trigger_hash. Pure functions over already-parsed hook payloads. NO model, NO
// network, NO fs. The builders stamp `v` to OBSERVE_SCHEMA_VERSION; the caller
// supplies already-scrubbed primitives (scrubbing is the scrub.ts boundary).

import { createHash } from "node:crypto";
import {
  type AssistantMsgEvent,
  type CompactEvent,
  OBSERVE_SCHEMA_VERSION,
  PATH_MAX,
  type SessionEndEvent,
  type SessionStartEvent,
  type SkillLoadEvent,
  type SkillMatch,
  type ToolUseEvent,
  type UserPromptEvent,
} from "./types.js";

/** The per-line envelope primitives every builder shares. `v` is stamped inside. */
export interface EventBase {
  ts: string;
  session: string;
}

// ─── builders ────────────────────────────────────────────────────────────────

export function buildSessionStart(
  base: EventBase,
  p: { harness: string; cwd: string; repo_root: string | null; mage_version: string; source: string },
): SessionStartEvent {
  return { v: OBSERVE_SCHEMA_VERSION, ts: base.ts, session: base.session, type: "session_start", ...p };
}

export function buildUserPrompt(base: EventBase, scrubbedText: string): UserPromptEvent {
  return {
    v: OBSERVE_SCHEMA_VERSION,
    ts: base.ts,
    session: base.session,
    type: "user_prompt",
    text: scrubbedText,
  };
}

export function buildAssistantMsg(base: EventBase, scrubbedText: string): AssistantMsgEvent {
  return {
    v: OBSERVE_SCHEMA_VERSION,
    ts: base.ts,
    session: base.session,
    type: "assistant_msg",
    text: scrubbedText,
  };
}

export function buildSkillLoad(
  base: EventBase,
  p: { skill: string; args: string | null; match: SkillMatch | null; trigger_hash: string | null },
): SkillLoadEvent {
  return { v: OBSERVE_SCHEMA_VERSION, ts: base.ts, session: base.session, type: "skill_load", ...p };
}

export function buildToolUse(
  base: EventBase,
  p: { tool: string; paths: string[]; detail: string | null; ok: boolean; error_summary: string | null },
): ToolUseEvent {
  return { v: OBSERVE_SCHEMA_VERSION, ts: base.ts, session: base.session, type: "tool_use", ...p };
}

export function buildCompact(base: EventBase, trigger: "manual" | "auto"): CompactEvent {
  return { v: OBSERVE_SCHEMA_VERSION, ts: base.ts, session: base.session, type: "compact", trigger };
}

export function buildSessionEnd(base: EventBase, reason?: string): SessionEndEvent {
  const e: SessionEndEvent = { v: OBSERVE_SCHEMA_VERSION, ts: base.ts, session: base.session, type: "session_end" };
  // Omit `reason` entirely when absent (consumers tolerate absence, §2).
  return reason === undefined ? e : { ...e, reason };
}

// ─── deterministic per-tool path extraction (§5) ─────────────────────────────

/** Tools whose `file_path` is the salient path. */
const FILE_PATH_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);
/** Tools whose `path` (search root) is the salient path. */
const SEARCH_ROOT_TOOLS = new Set(["Glob", "Grep"]);

/**
 * Extract `paths[]` from STRUCTURED inputs only (§5). Bash is never parsed for
 * paths (unreliable). Each value must be a string; non-strings are ignored
 * (noUncheckedIndexedAccess safety). Entries are bounded to PATH_MAX.
 */
export function extractPaths(toolName: string, input: Record<string, unknown>): string[] {
  if (FILE_PATH_TOOLS.has(toolName)) return boundedPath(input.file_path);
  if (SEARCH_ROOT_TOOLS.has(toolName)) return boundedPath(input.path);
  return []; // Bash + all other tools.
}

function boundedPath(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return [value.slice(0, PATH_MAX)];
}

// ─── deterministic per-tool detail (§5) ──────────────────────────────────────

/**
 * The per-tool salient string (§5), RAW and UNTRUNCATED — bounding happens at
 * the scrub boundary (scrub-then-truncate), so a secret straddling the cap can't
 * leak a tail. `null` when `paths[]` already carries the salient datum, or the
 * field is absent / non-string. `paths` is accepted so the contract is explicit
 * (Read/Write/Edit always return null because their path carries it).
 */
export function extractDetail(
  toolName: string,
  input: Record<string, unknown>,
  paths: string[],
): string | null {
  void paths; // path-carrying tools return null below regardless of `paths` length.
  if (FILE_PATH_TOOLS.has(toolName)) return null; // the file_path in paths[] is the datum.
  if (toolName === "Bash") return strOrNull(input.command);
  if (toolName === "Grep" || toolName === "Glob") return strOrNull(input.pattern);
  if (toolName === "WebFetch") return strOrNull(input.url);
  return null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ─── trigger_hash (§3) ───────────────────────────────────────────────────────

/** Deterministic sha256 hex of the trimmed description/trigger string as loaded. */
export function triggerHash(description: string): string {
  return createHash("sha256").update(description.trim(), "utf8").digest("hex");
}
