// The `.learnings/*.jsonl` capture schema (ADR-0015 §1–§4). Pure types + bound
// constants — NO runtime logic. The envelope is versioned and additive-only:
// adding an optional field or a new `type` is non-breaking (consumers ignore
// unknown types/fields); renaming/removing/re-meaning a field bumps `v`.

/** Schema version stamped on every line. `as const` pins the literal `1`. */
export const OBSERVE_SCHEMA_VERSION = 1 as const;

/** Event type discriminator (ADR-0015 §2). */
export type ObserveEventType =
  | "session_start"
  | "user_prompt"
  | "skill_load"
  | "tool_use"
  | "compact"
  | "session_end";

/** The six event-type literals as a runtime set, for boundary validation. */
const OBSERVE_EVENT_TYPES: ReadonlySet<string> = new Set<ObserveEventType>([
  "session_start",
  "user_prompt",
  "skill_load",
  "tool_use",
  "compact",
  "session_end",
]);

/**
 * Runtime guard narrowing an arbitrary value to {@link ObserveEventType}. The
 * `--event` string from Commander is only a type-level assertion, so validate it
 * here before it reaches the exhaustive `mapEvent` switch (a bogus value would
 * otherwise fall through the switch and yield `undefined`).
 */
export function isObserveEventType(v: unknown): v is ObserveEventType {
  return typeof v === "string" && OBSERVE_EVENT_TYPES.has(v);
}

/** Shared envelope on every line (ADR-0015 §1): `v` + `ts` + `session` + `type`. */
export interface ObserveEnvelope {
  v: typeof OBSERVE_SCHEMA_VERSION;
  /** ISO-8601 UTC, e.g. `new Date().toISOString()`. */
  ts: string;
  /** Session id. */
  session: string;
  type: ObserveEventType;
}

/** session_start — session-constant fields ride here, not every line (§1, §2). */
export interface SessionStartEvent extends ObserveEnvelope {
  type: "session_start";
  harness: string;
  cwd: string;
  /** Resolved repo root; null if unresolved. */
  repo_root: string | null;
  mage_version: string;
  /** Hook source label, e.g. "startup"/"resume". */
  source: string;
}

/** user_prompt — the keyword/intent signal (§2). `text` is scrubbed + truncated. */
export interface UserPromptEvent extends ObserveEnvelope {
  type: "user_prompt";
  /** Scrubbed, ≤ USER_PROMPT_MAX. */
  text: string;
}

/** The match snapshot context-match (0.0.6) reads (ADR-0015 §3, ADR-0016 §1). */
export interface SkillMatch {
  wing: string;
  keywords: string[];
  paths: string[];
}

/** skill_load — a tool_use specialization (§3). Foreign skills record `skill` only. */
export interface SkillLoadEvent extends ObserveEnvelope {
  type: "skill_load";
  skill: string;
  /** Scrubbed + truncated if present, else null. */
  args: string | null;
  /** null for foreign (non-mage) skills. */
  match: SkillMatch | null;
  /** Hash of the trigger/description as loaded; null for foreign skills. */
  trigger_hash: string | null;
}

/** tool_use — a salient extract, not a transcript copy (§4). */
export interface ToolUseEvent extends ObserveEnvelope {
  type: "tool_use";
  /** tool_name verbatim (e.g. "Bash", "Read"). */
  tool: string;
  /** Structured-input path extraction only (§5); [] for Bash. */
  paths: string[];
  /** Per-tool salient field, scrubbed, ≤ DETAIL_MAX; null when paths carry it. */
  detail: string | null;
  /** false === error. */
  ok: boolean;
  /** Scrubbed + truncated; null when ok. */
  error_summary: string | null;
}

/** compact — the high-value distill marker (§2). */
export interface CompactEvent extends ObserveEnvelope {
  type: "compact";
  trigger: "manual" | "auto";
}

/** session_end — `reason` may be absent on crash; consumers tolerate (§2). */
export interface SessionEndEvent extends ObserveEnvelope {
  type: "session_end";
  reason?: string;
}

export type ObserveEvent =
  | SessionStartEvent
  | UserPromptEvent
  | SkillLoadEvent
  | ToolUseEvent
  | CompactEvent
  | SessionEndEvent;

// ─── bounds (named, exported) ────────────────────────────────────────────────

/** user_prompt.text cap (§2 "~2000"). */
export const USER_PROMPT_MAX = 2000;
/** tool_use.detail cap (§4 "≤200"). */
export const DETAIL_MAX = 200;
/** tool_use.error_summary cap. */
export const ERROR_SUMMARY_MAX = 200;
/** skill_load.args cap. */
export const ARGS_MAX = 200;
/** Per-entry cap for a structured path (caps line size; paths are not scrubbed). */
export const PATH_MAX = 400;
