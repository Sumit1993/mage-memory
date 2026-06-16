import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Read-modify-write engine for Claude Code's settings.json hook block.
 *
 * Claude Code's settings file maps a top-level `hooks` key to
 * Event -> array of GROUPS, where a group is `{matcher?, hooks:[{type,command}]}`.
 * Claude Code preserves unknown keys on a group, so mage tags every group it
 * owns with an `id` of the form `mage:...`. This lets us upsert/remove our own
 * hooks idempotently while leaving the host's groups and any other top-level
 * keys completely untouched.
 */

// ─── types ─────────────────────────────────────────────────────────────────
export interface HookCommand {
  type: "command";
  command: string;
}

export interface HookGroup {
  id?: string;
  matcher?: string;
  hooks: HookCommand[];
  [k: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
}

// ─── constants ─────────────────────────────────────────────────────────────
export const MAGE_ID_PREFIX = "mage:";

/**
 * The complete set of hooks mage wires into a host's settings. mage groups
 * carry NO matcher (they observe all tools) and are keyed by a stable `id`.
 */
export const MAGE_HOOKS: ReadonlyArray<{ event: string; id: string; command: string }> = [
  { event: "SessionStart", id: "mage:observe:SessionStart", command: "mage observe" },
  // The boundary nudge (0.0.12, ADR-0009 §24 step 2): on a post-compaction
  // SessionStart it distills the closed chapter and surfaces staged lessons. The
  // command gates on source==="compact" itself, so other SessionStart sources
  // (startup/resume/clear) are a fast no-op. SessionEnd is NOT used — a SessionEnd
  // hook's stdout cannot inject context (the session is already ending).
  { event: "SessionStart", id: "mage:nudge:SessionStart", command: "mage nudge" },
  { event: "UserPromptSubmit", id: "mage:observe:UserPromptSubmit", command: "mage observe" },
  { event: "PostToolUse", id: "mage:observe:PostToolUse", command: "mage observe" },
  { event: "PostToolUseFailure", id: "mage:observe:PostToolUseFailure", command: "mage observe" },
  { event: "PreCompact", id: "mage:observe:PreCompact", command: "mage observe" },
  { event: "SessionEnd", id: "mage:observe:SessionEnd", command: "mage observe" },
  { event: "Stop", id: "mage:metrics:Stop", command: "mage skills --metrics --quiet" },
  // Second Stop group: capture the agent's final reply (ADR-0019 amendment to
  // ADR-0015). Distinct id from mage:metrics:Stop, so both coexist on Stop.
  { event: "Stop", id: "mage:observe:Stop", command: "mage observe" },
  // Capture autonomous SUBagent work (0.0.11 Candidate 4): a Task subagent's tool
  // calls never reach the main-session PostToolUse hook, so its final reply — read
  // from the subagent transcript, exactly like Stop → assistant_msg — is the one
  // capture point as harnesses move toward autonomous multi-agent workflows.
  { event: "SubagentStop", id: "mage:observe:SubagentStop", command: "mage observe" },
];

// ─── drift diff (doctor) ─────────────────────────────────────────────────────
/**
 * Compare the mage groups installed in `settings` against {@link MAGE_HOOKS},
 * the source of truth for the current mage's expected hook block. Pure (reads
 * only). Drives `doctor`'s "connection health / hook drift" check — the
 * version-bump nudge from the setup-integrity gotcha.
 *
 *  - `connected`  — at least one installed group carries a `mage:*` id.
 *  - `missingIds` — every MAGE_HOOKS id with no installed group of that id.
 *  - `staleIds`   — an installed group of that id exists but its command differs
 *                   from the expected command (a drifted/old hook block).
 *  - `matches`    — connected, nothing missing or stale, AND no EXTRA `mage:*`
 *                   ids beyond MAGE_HOOKS (a leftover from a renamed hook).
 *
 * A group's command is read from its first `hooks[].command` (how mage writes
 * its single-command groups), so a hand-edited multi-command group is compared
 * on its first entry only.
 */
export function diffMageHooks(settings: ClaudeSettings | null): {
  connected: boolean;
  matches: boolean;
  missingIds: string[];
  staleIds: string[];
} {
  // Map every installed mage:* group by id → its first command (last wins on dupes).
  const installed = new Map<string, string | undefined>();
  const groups = settings?.hooks ? Object.values(settings.hooks).flat() : [];
  for (const g of groups) {
    // Skip non-object array entries (a hand-edited file can carry `null`/scalars in
    // a hooks-event array): `g.id` on a null would throw. diffMageHooks is on the
    // `mage doctor` hot path, which must be total over any parseable settings JSON.
    if (!g || typeof g !== "object") continue;
    if (typeof g.id === "string" && g.id.startsWith(MAGE_ID_PREFIX)) {
      installed.set(g.id, g.hooks?.[0]?.command);
    }
  }

  const connected = installed.size > 0;
  const missingIds: string[] = [];
  const staleIds: string[] = [];
  const expectedIds = new Set<string>();

  for (const entry of MAGE_HOOKS) {
    expectedIds.add(entry.id);
    if (!installed.has(entry.id)) {
      missingIds.push(entry.id);
    } else if (installed.get(entry.id) !== entry.command) {
      staleIds.push(entry.id);
    }
  }

  // An EXTRA mage:* id (installed but not in MAGE_HOOKS) is also drift — e.g. a
  // hook that was renamed across versions and left behind. It blocks `matches`.
  const hasExtra = [...installed.keys()].some((id) => !expectedIds.has(id));

  const matches =
    connected && missingIds.length === 0 && staleIds.length === 0 && !hasExtra;

  return { connected, matches, missingIds, staleIds };
}

// ─── target resolution ───────────────────────────────────────────────────────
/**
 * Resolve which settings file to operate on. `user` targets the personal
 * `~/.claude/settings.json`; the default `local` scope targets the repo's
 * gitignored `<cwd>/.claude/settings.local.json`.
 */
export function resolveSettingsTarget(opts: { user?: boolean; cwd?: string }): {
  path: string;
  scope: "local" | "user";
} {
  if (opts.user) {
    return { path: join(homedir(), ".claude", "settings.json"), scope: "user" };
  }
  return {
    path: join(opts.cwd ?? process.cwd(), ".claude", "settings.local.json"),
    scope: "local",
  };
}

// ─── read ────────────────────────────────────────────────────────────────────
/**
 * Read and parse a Claude settings file.
 *   - missing file (ENOENT) -> {settings:null, existed:false, malformed:false}
 *   - present but unparseable -> {settings:null, existed:true, malformed:true}
 *   - present and valid       -> {settings:parsed, existed:true, malformed:false}
 */
export async function readClaudeSettings(
  path: string,
): Promise<{ settings: ClaudeSettings | null; existed: boolean; malformed: boolean }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { settings: null, existed: false, malformed: false };
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw) as ClaudeSettings;
    return { settings: parsed, existed: true, malformed: false };
  } catch {
    return { settings: null, existed: true, malformed: true };
  }
}

// ─── upsert ──────────────────────────────────────────────────────────────────
/**
 * Return a NEW settings object with every mage hook wired in. Pure: the input
 * is never mutated (we deep-clone first). For each MAGE_HOOKS entry we ensure
 * the event array exists, drop any prior group with the same id, then append a
 * fresh mage group. Non-mage groups, other events, and other top-level keys are
 * preserved. Idempotent and self-healing (replace-by-id updates drifted commands).
 */
export function upsertMageHooks(settings: ClaudeSettings | null): ClaudeSettings {
  const base = structuredClone(settings ?? {}) as ClaudeSettings;
  // Detach the hooks map from `base` before mutating it, so this stays a clean
  // immutable construction (we never write through an alias of the clone).
  const hooks: Record<string, HookGroup[]> = base.hooks ? { ...base.hooks } : {};

  for (const entry of MAGE_HOOKS) {
    const current = hooks[entry.event];
    const existing = Array.isArray(current) ? current : [];
    const withoutMine = existing.filter((g) => g.id !== entry.id);
    const group: HookGroup = {
      id: entry.id,
      hooks: [{ type: "command", command: entry.command }],
    };
    hooks[entry.event] = [...withoutMine, group];
  }

  return { ...base, hooks };
}

// ─── remove ──────────────────────────────────────────────────────────────────
/**
 * Return a NEW settings object with every mage-owned group removed. Pure. A
 * group is mage-owned iff its `id` is a string starting with MAGE_ID_PREFIX.
 * Emptied event arrays are pruned, and a hooks{} that becomes empty is dropped
 * entirely so a round-trip upsert -> remove restores the original (minus mage).
 */
export function removeMageHooks(settings: ClaudeSettings | null): {
  settings: ClaudeSettings;
  removed: number;
} {
  const base = structuredClone(settings ?? {}) as ClaudeSettings;
  if (!base.hooks) return { settings: base, removed: 0 };

  let removed = 0;
  const nextHooks: Record<string, HookGroup[]> = {};

  for (const [event, groups] of Object.entries(base.hooks)) {
    const kept = groups.filter((g) => {
      const isMage = typeof g.id === "string" && g.id.startsWith(MAGE_ID_PREFIX);
      if (isMage) removed += 1;
      return !isMage;
    });
    if (kept.length > 0) nextHooks[event] = kept;
  }

  if (Object.keys(nextHooks).length === 0) {
    const { hooks: _omitted, ...rest } = base;
    return { settings: rest, removed };
  }
  return { settings: { ...base, hooks: nextHooks }, removed };
}

// ─── write ───────────────────────────────────────────────────────────────────
/**
 * Persist a settings object. If the file already exists we copy it to
 * `<path>.bak` BEFORE overwriting (advisory backup; a later write clobbers it).
 * The parent directory is created if absent. Output is pretty-printed JSON with
 * a trailing newline to match the host's formatting.
 */
export async function writeClaudeSettings(
  path: string,
  settings: ClaudeSettings,
): Promise<{ backedUp: boolean }> {
  let backedUp = false;
  try {
    await copyFile(path, `${path}.bak`);
    backedUp = true;
  } catch (err: unknown) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  return { backedUp };
}
