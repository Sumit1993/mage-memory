import {
  readClaudeSettings,
  removeMageHooks,
  resolveSettingsTarget,
  writeClaudeSettings,
} from "../claude-settings.js";
import { logger } from "../logger.js";

/** Options for {@link disconnect}. */
export interface DisconnectOptions {
  /** Target the personal `~/.claude/settings.json` instead of the repo-local file. */
  user?: boolean;
  /** Skip prompts (non-interactive). Accepted for symmetry with connect; no destructive prompt. */
  yes?: boolean;
  /** Working directory for resolving the local settings path (default: cwd). */
  cwd?: string;
}

/** Result of {@link disconnect}. */
export interface DisconnectResult {
  path: string;
  scope: "local" | "user";
  removed: number;
  backedUp: boolean;
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
    return { path: target.path, scope: target.scope, removed: 0, backedUp: false };
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

  return { path: target.path, scope: target.scope, removed, backedUp };
}
