import {
  readClaudeSettings,
  removeMageHooks,
  resolveSettingsTarget,
  writeClaudeSettings,
} from "../claude-settings.js";
import { removeRedactHook } from "../git-hooks.js";
import { logger } from "../logger.js";

/** Options for {@link disconnect}. */
export interface DisconnectOptions {
  /** Target the personal `~/.claude/settings.json` instead of the repo-local file. */
  user?: boolean;
  /** Skip prompts (non-interactive). Accepted for symmetry with connect; no destructive prompt. */
  yes?: boolean;
  /** Working directory for resolving the local settings path (default: cwd). */
  cwd?: string;
  /**
   * Remove the Gate-2 redaction pre-commit hook installed by connect. Symmetric
   * with ConnectOptions.gitHook; pass `false` to leave it. Default true.
   */
  gitHook?: boolean;
}

/** Result of {@link disconnect}. */
export interface DisconnectResult {
  path: string;
  scope: "local" | "user";
  removed: number;
  backedUp: boolean;
  /** Outcome of the pre-commit redaction hook removal (omitted when not attempted). */
  hook?: { removed: boolean };
}

/**
 * Remove mage's capture hooks from a Claude Code settings file. A missing file
 * is a clean no-op; malformed JSON is refused (never clobbered). Only mage-owned
 * groups are dropped — host groups, other events, and unknown top-level keys are
 * left untouched. The file is rewritten only when something was actually removed.
 */
export async function disconnect(opts: DisconnectOptions): Promise<DisconnectResult> {
  const target = resolveSettingsTarget({ user: opts.user, cwd: opts.cwd });
  const r = await readClaudeSettings(target.path);

  if (!r.existed) {
    logger.info(`No settings at ${target.path} — nothing to disconnect.`);
    // The pre-commit hook lives independently of settings, so still attempt its
    // removal — a connect that only installed the hook is undone by disconnect.
    const hook = await removeHook(opts);
    return { path: target.path, scope: target.scope, removed: 0, backedUp: false, hook };
  }

  if (r.malformed) {
    throw new Error(
      `Refusing to modify malformed JSON at ${target.path} — fix or delete it, then re-run. No changes made.`,
    );
  }

  const { settings, removed } = removeMageHooks(r.settings);

  let backedUp = false;
  if (removed > 0) {
    ({ backedUp } = await writeClaudeSettings(target.path, settings));
    logger.success(`Removed ${removed} mage hook(s) from ${target.path}.`);
  } else {
    logger.info(`No mage hooks found in ${target.path} — nothing removed.`);
  }

  const hook = await removeHook(opts);

  return { path: target.path, scope: target.scope, removed, backedUp, hook };
}

/**
 * Remove the redaction pre-commit hook (only ours, by marker) and log when it
 * was actually removed. Symmetric with connect's install; `gitHook:false` skips
 * it entirely. A foreign/absent hook or non-repo cwd is a silent no-op.
 */
async function removeHook(opts: DisconnectOptions): Promise<{ removed: boolean } | undefined> {
  if (opts.gitHook === false) return undefined;
  const r = await removeRedactHook(opts.cwd ?? process.cwd());
  if (r.removed) logger.detail("Removed the redaction pre-commit hook.");
  return { removed: r.removed };
}
