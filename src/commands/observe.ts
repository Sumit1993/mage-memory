// `mage observe` — the hook-fired capture seam (ADR-0015, CONVENTIONS §10,
// plumbing tier). Reads a Claude Code hook JSON on stdin, maps it to ONE
// ObserveEvent, scrubs the free-text fields (Gate-1), and appends it to
// `.learnings/`. NEVER throws to the host: every path resolves to exit 0
// (fail-open observe), and a redactor throw degrades a field to the sentinel
// (fail-closed redaction) without leaking the raw value.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
  buildAssistantMsg,
  buildCompact,
  buildSessionEnd,
  buildSessionStart,
  buildSkillLoad,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
  extractDetail,
  extractPaths,
} from "../observe/events.js";
import { scrubField } from "../observe/scrub.js";
import { isMageSkill, snapshotSkillMatch } from "../observe/skill-match.js";
import { appendEvent } from "../observe/store.js";
import {
  ARGS_MAX,
  ASSISTANT_MSG_MAX,
  DETAIL_MAX,
  ERROR_SUMMARY_MAX,
  isObserveEventType,
  type ObserveEvent,
  type ObserveEventType,
  USER_PROMPT_MAX,
} from "../observe/types.js";
import { LEARNINGS_DIR, resolveDocsRoot } from "../paths.js";
import { mageVersion } from "../version.js";

export interface ObserveOptions {
  /** --session <id>: overrides the session in the hook JSON. */
  session?: string;
  /** --event <type>: forces/overrides the inferred event type. */
  event?: ObserveEventType;
  /** Defaults to the hook JSON cwd, then process.cwd(). */
  cwd?: string;
}

/**
 * Read hook JSON from stdin, map → event, scrub, append. NEVER rejects: the whole
 * body is wrapped so a stdin error, malformed payload, missing KB, or any fs error
 * silently does nothing and resolves (the host hook is never broken).
 */
export async function observeCmd(opts: ObserveOptions): Promise<void> {
  try {
    const raw = await readStdinSafe();
    if (raw.trim().length === 0) return; // empty stdin → no-op (JSON.parse('') throws).

    const payload = parseHookPayload(raw);
    if (payload === null) return; // not a non-null plain object → fail open.

    const cwd = opts.cwd ?? str(payload.cwd) ?? process.cwd();
    const session = opts.session ?? str(payload.session_id) ?? "unknown";

    // Resolve the KB ONCE here (fast-fail gate) and thread the result through
    // mapEvent + appendEvent. resolveDocsRoot walks the tree upward per call, and
    // this is a hot path (every PostToolUse hook), so reusing this single resolve
    // avoids 2–3 redundant filesystem walks per event.
    const resolved = await resolveDocsRoot(cwd).catch(() => null);
    if (resolved === null) return; // no KB → write nothing.
    const learningsDir = join(resolved.root, LEARNINGS_DIR);
    const repoRoot = resolved.repo;

    const base: EventBase = { ts: new Date().toISOString(), session };
    const event = await mapEvent(payload, base, cwd, repoRoot, opts.event);
    // null = no type inferred; undefined = a bogus forced --event matched no switch
    // case. Both no-op so a corrupt `undefined\n` line is never appended (fail open).
    if (event === null || event === undefined) return;

    await appendEvent(cwd, session, event, learningsDir);
  } catch {
    // Fail open: any non-scrub error → silently exit 0.
  }
}

// ─── stdin (fail-open: an 'error' resolves to "", never rejects) ─────────────

/** Drain stdin to a UTF-8 string; resolves "" on empty/closed/errored streams. */
function readStdinSafe(): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", done);
    // Unlike redactCmd (which rejects), observe swallows stdin errors → "".
    process.stdin.on("error", () => resolve(""));
  });
}

// ─── payload parsing + narrowing (noUncheckedIndexedAccess-safe) ─────────────

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

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ─── hook payload → event (ADR-0015 §4 mapping table) ────────────────────────

/**
 * Infer the event type from `hook_event_name` (unless `--event` overrides it) and
 * build the event. `--event` only RELABELS — the same payload is read, so a forced
 * type whose fields are absent degrades to nulls/empties (never undefined cross
 * products). Returns null when no type can be determined.
 */
async function mapEvent(
  payload: Record<string, unknown>,
  base: EventBase,
  cwd: string,
  repoRoot: string,
  forced: ObserveEventType | undefined,
): Promise<ObserveEvent | null> {
  // A forced --event is only a type-level assertion from Commander; validate it
  // at runtime so a bogus value (e.g. `--event bogus`) becomes a clean null
  // rather than falling through the exhaustive switch to undefined.
  const forcedType = forced !== undefined && isObserveEventType(forced) ? forced : null;
  const type = (forced !== undefined ? forcedType : inferType(payload));
  if (type === null) return null;

  switch (type) {
    case "session_start":
      // repoRoot is the KB-resolving repo root the caller already resolved from
      // the effective cwd — reuse it instead of a second resolveDocsRoot walk.
      return buildSessionStart(base, {
        harness: process.env.CLAUDE_CODE_ENTRYPOINT || "claude-code",
        cwd: str(payload.cwd) ?? cwd,
        repo_root: repoRoot,
        mage_version: mageVersion(),
        source: str(payload.source) ?? "unknown",
      });

    case "user_prompt":
      return buildUserPromptEvent(payload, base);

    case "assistant_msg":
      return buildAssistantMsgEvent(payload, base);

    case "skill_load":
      return mapSkillLoad(payload, base, repoRoot);

    case "tool_use":
      return mapToolUse(payload, base);

    case "compact":
      return buildCompact(base, payload.trigger === "manual" ? "manual" : "auto");

    case "session_end": {
      const reason = str(payload.reason);
      return reason === undefined ? buildSessionEnd(base) : buildSessionEnd(base, reason);
    }
  }
}

/**
 * Map `hook_event_name` → event type. Skill tool → skill_load (ADR-0015 §3).
 * BOTH `PostToolUse` (success) and `PostToolUseFailure` (Claude Code's dedicated
 * tool-failure hook, carrying a top-level `error` string) map to a tool event —
 * dropping the failure hook would discard the highest-value gotcha signal.
 */
function inferType(payload: Record<string, unknown>): ObserveEventType | null {
  const hook = str(payload.hook_event_name);
  switch (hook) {
    case "SessionStart":
      return "session_start";
    case "UserPromptSubmit":
      return "user_prompt";
    case "Stop":
      return "assistant_msg";
    case "PreCompact":
      return "compact";
    case "SessionEnd":
      return "session_end";
    case "PostToolUse":
    case "PostToolUseFailure":
      return str(payload.tool_name) === "Skill" ? "skill_load" : "tool_use";
    default:
      return null;
  }
}

function buildUserPromptEvent(payload: Record<string, unknown>, base: EventBase): ObserveEvent {
  const text = scrubField(str(payload.prompt) ?? "", USER_PROMPT_MAX) ?? "";
  return buildUserPrompt(base, text);
}

/**
 * Stop → assistant_msg (ADR-0019 amendment). The Stop hook payload carries no
 * reply text inline, only a `transcript_path`; read the LAST assistant message
 * from that `.jsonl`. Fail-open at every gap: a missing/garbage `transcript_path`
 * or a transcript with no assistant text → null (nothing written), so a bare Stop
 * never parks an empty line. Scrub BEFORE truncate (the scrub-then-cap invariant).
 */
async function buildAssistantMsgEvent(
  payload: Record<string, unknown>,
  base: EventBase,
): Promise<ObserveEvent | null> {
  const transcriptPath = str(payload.transcript_path);
  if (transcriptPath === undefined) return null; // no transcript → fail open.
  const raw = await readLastAssistantText(transcriptPath);
  if (raw === null) return null; // unreadable/garbage/no assistant text → fail open.
  const text = scrubField(raw, ASSISTANT_MSG_MAX) ?? "";
  return buildAssistantMsg(base, text);
}

/**
 * Read a Claude Code transcript `.jsonl` and return the LAST assistant message's
 * concatenated text, or null. Swallows ALL fs/parse errors (fail-open): a missing
 * file, an unreadable path, or torn JSON yields null, never a throw. Tolerates
 * shape variance — a line is an assistant message when its `type`/`role` is
 * "assistant" (top-level or under `message`), and its text is the join of every
 * `content[].text` string part. The last such non-empty text wins.
 */
async function readLastAssistantText(path: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null; // unreadable transcript → fail open.
  }

  let last: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // skip a torn line, never throw.
    }
    const text = assistantTextOf(parsed);
    if (text !== null) last = text;
  }
  return last;
}

/**
 * Extract concatenated assistant text from one parsed transcript line, or null
 * when the line is not an assistant message with text. Tolerates the documented
 * shape `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"…"}]}}`
 * plus variants where role/type live at the top level. Returns null (not "") for
 * an empty join so a contentless assistant turn does not overwrite a real one.
 */
function assistantTextOf(line: unknown): string | null {
  if (line === null || typeof line !== "object" || Array.isArray(line)) return null;
  const rec = line as Record<string, unknown>;
  const msg = obj(rec.message);
  const role = str(rec.role) ?? str(rec.type) ?? str(msg.role) ?? str(msg.type);
  if (role !== "assistant") return null;

  // content may live on the line or under `message`.
  const content = Array.isArray(rec.content)
    ? rec.content
    : Array.isArray(msg.content)
      ? msg.content
      : null;
  const text = textFromContent(content);
  return text.length > 0 ? text : null;
}

/** Join every string `text` part of a content array; "" when none or non-array. */
function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
    const t = (part as Record<string, unknown>).text;
    if (typeof t === "string" && t.length > 0) parts.push(t);
  }
  return parts.join("");
}

/** PostToolUse(Failure) (non-Skill) → tool_use: structured paths + salient detail + ok. */
function mapToolUse(payload: Record<string, unknown>, base: EventBase): ObserveEvent {
  const tool = str(payload.tool_name) ?? "unknown";
  const input = obj(payload.tool_input);
  const paths = extractPaths(tool, input);
  const detail = scrubField(extractDetail(tool, input, paths), DETAIL_MAX);
  const { ok, errorSignal } = deriveOk(payload);
  return buildToolUse(base, {
    tool,
    paths,
    detail,
    ok,
    error_summary: ok ? null : scrubField(errorSignal, ERROR_SUMMARY_MAX),
  });
}

/** PostToolUse + tool_name === "Skill" → skill_load (ADR-0015 §3). */
async function mapSkillLoad(
  payload: Record<string, unknown>,
  base: EventBase,
  repoRoot: string,
): Promise<ObserveEvent> {
  const input = obj(payload.tool_input);
  const skill = str(input.skill) ?? "unknown";
  const args = scrubField(argsOf(input), ARGS_MAX);

  if (isMageSkill(skill)) {
    // repoRoot was already resolved by observeCmd — pass it straight through.
    const snap = await snapshotSkillMatch(repoRoot, skill);
    if (snap !== null) {
      return buildSkillLoad(base, { skill, args, match: snap.match, trigger_hash: snap.trigger_hash });
    }
  }
  // Foreign skill, or a mage skill with no recoverable match → skill-only.
  return buildSkillLoad(base, { skill, args, match: null, trigger_hash: null });
}

/** The `tool_input` minus `skill`, stringified, or null when empty. */
function argsOf(input: Record<string, unknown>): string | null {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k !== "skill") rest[k] = v;
  }
  return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
}

/**
 * Derive `ok` + an error signal (§4 hand-wave made concrete) from the WHOLE payload,
 * honoring two failure channels:
 *   1. `PostToolUseFailure` — Claude Code's dedicated tool-failure hook. Authoritative:
 *      ok=false, signal from the top-level `error` string (then the tool_response).
 *   2. `PostToolUse` whose `tool_response` carries an inline error marker
 *      (`is_error===true` | a string `error` | `status==="error"`).
 * Otherwise ok=true (the common success case). Error strings are passed FULL to
 * scrubField (the caller scrubs then truncates — pre-slicing would chop a straddling
 * secret mid-token, defeating the detector; the scrub-before-truncate invariant).
 */
function deriveOk(payload: Record<string, unknown>): { ok: boolean; errorSignal: string | null } {
  if (str(payload.hook_event_name) === "PostToolUseFailure") {
    const signal =
      str(payload.error) ?? errorFromResponse(payload.tool_response) ?? "tool failed";
    return { ok: false, errorSignal: signal };
  }
  const inline = errorFromResponse(payload.tool_response);
  return inline === null ? { ok: true, errorSignal: null } : { ok: false, errorSignal: inline };
}

/** An inline error signal in a tool_response object, or null when none is present. */
function errorFromResponse(response: unknown): string | null {
  if (response === null || typeof response !== "object" || Array.isArray(response)) return null;
  const r = response as Record<string, unknown>;
  if (r.is_error === true || typeof r.error === "string" || r.status === "error") {
    return str(r.error) ?? str(r.content) ?? str(r.message) ?? JSON.stringify(r);
  }
  return null;
}

// ─── CLI registration (kept next to the handler so the flag list and the option
//     contract can't drift — the missing `--cwd` regression that unit tests on
//     observeCmd() alone could not catch) ──────────────────────────────────────

/**
 * Build the `observe` plumbing-tier command (ADR-0015, CONVENTIONS §10). Returns a
 * standalone Command so `cli.ts` can `addCommand()` it and tests can introspect/drive
 * the real option wiring without importing the whole CLI (which parses argv on load).
 */
export function buildObserveCommand(): Command {
  return new Command("observe")
    .description(
      "Hook-fired capture seam: read a Claude Code hook JSON on stdin and append one event to .learnings/ (ADR-0015; never blocks the host)",
    )
    .option("--session <id>", "session id (overrides the session field in the hook JSON)")
    .option(
      "--event <type>",
      "force the event type (session_start|user_prompt|assistant_msg|skill_load|tool_use|compact|session_end); default: inferred from the hook payload",
    )
    .option(
      "--cwd <dir>",
      "working directory used to locate the knowledge base (overrides the hook JSON cwd; defaults to it, then process.cwd())",
    )
    .action(async (opts: { session?: string; event?: ObserveEventType; cwd?: string }) => {
      // observeCmd never rejects; plumbing always exits 0 — no exit-code handling here.
      await observeCmd({ session: opts.session, event: opts.event, cwd: opts.cwd });
    });
}

