import { confirm } from "@inquirer/prompts";
import {
  readClaudeSettings,
  resolveSettingsTarget,
  upsertMageHooks,
  writeClaudeSettings,
  MAGE_HOOKS,
} from "../claude-settings.js";
import { resolveDecision } from "../interactive.js";
import { logger } from "../logger.js";

/** Options for {@link connect}. */
export interface ConnectOptions {
  /** Target the personal `~/.claude/settings.json` instead of the repo-local file. */
  user?: boolean;
  /** Skip the confirmation prompt (non-interactive). */
  yes?: boolean;
  /** Working directory for resolving the local settings path (default: cwd). */
  cwd?: string;
}

/** Result of {@link connect}. */
export interface ConnectResult {
  path: string;
  scope: "local" | "user";
  wired: number;
  backedUp: boolean;
}

/**
 * Wire mage's capture hooks into a Claude Code settings file. Reads the target
 * (refusing outright on malformed JSON so we never clobber a file a human is
 * mid-edit on), confirms the change in interactive mode, then upserts the mage
 * groups idempotently. settings.local.json is personal + gitignored, so no git
 * suggestions are emitted.
 */
export async function connect(opts: ConnectOptions): Promise<ConnectResult> {
  const target = resolveSettingsTarget({ user: opts.user, cwd: opts.cwd });
  const r = await readClaudeSettings(target.path);

  if (r.malformed) {
    throw new Error(
      `Refusing to modify malformed JSON at ${target.path} — fix or delete it, then re-run. No changes made.`,
    );
  }

  const proceed = await resolveDecision<boolean>({
    flagValue: opts.yes ? true : undefined,
    yes: opts.yes,
    interactive: () => confirm({ message: `Wire mage capture into ${target.path}?`, default: true }),
    fallback: { value: true },
    flagName: "yes",
  });

  if (!proceed) {
    logger.info("Aborted — no changes made.");
    return { path: target.path, scope: target.scope, wired: 0, backedUp: false };
  }

  const merged = upsertMageHooks(r.settings);
  const { backedUp } = await writeClaudeSettings(target.path, merged);

  const wired = MAGE_HOOKS.length;
  logger.success(`Wired ${wired} events into ${target.path} (personal + gitignored).`);
  logger.detail("Run `mage disconnect` to remove.");

  return { path: target.path, scope: target.scope, wired, backedUp };
}
