import { confirm } from "@inquirer/prompts";
import {
  readClaudeSettings,
  resolveSettingsTarget,
  upsertMageHooks,
  writeClaudeSettings,
  MAGE_HOOKS,
} from "../claude-settings.js";
import { resolveDecision } from "../interactive.js";
import { installRedactHook } from "../git-hooks.js";
import { logger } from "../logger.js";

/** Options for {@link connect}. */
export interface ConnectOptions {
  /** Target the personal `~/.claude/settings.json` instead of the repo-local file. */
  user?: boolean;
  /** Skip the confirmation prompt (non-interactive). */
  yes?: boolean;
  /** Working directory for resolving the local settings path (default: cwd). */
  cwd?: string;
  /**
   * Install the Gate-2 redaction pre-commit hook (ADR-0018 §7). Independently
   * toggleable — pass `false` to wire capture without the safety net. Default true.
   */
  gitHook?: boolean;
}

/** Result of {@link connect}. */
export interface ConnectResult {
  path: string;
  scope: "local" | "user";
  wired: number;
  backedUp: boolean;
  /** Outcome of the pre-commit redaction hook install (omitted when not attempted). */
  hook?: { installed: boolean; reason?: string };
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

  // Gate 2 (ADR-0018 §7): the blocking, un-skippable redaction net at the tracked
  // write. Independently toggleable; the installer refuses to clobber a foreign
  // hook, so this is safe to attempt unconditionally. A non-repo cwd no-ops.
  const hook = opts.gitHook === false ? undefined : await installHook(opts.cwd ?? process.cwd());

  return { path: target.path, scope: target.scope, wired, backedUp, hook };
}

/**
 * Install the redaction pre-commit hook and log per outcome. installed → success;
 * "exists-foreign" → warn the human to add the check to their own hook (we won't
 * overwrite it); "already" → quiet detail; "not-a-repo" → silent (connect is
 * routinely run outside a repo). Returns the additive `hook` field for the result.
 */
async function installHook(repo: string): Promise<{ installed: boolean; reason?: string }> {
  const r = await installRedactHook(repo);
  if (r.installed) {
    logger.success("Installed the redaction pre-commit hook (mage redact --check --staged)");
  } else if (r.reason === "exists-foreign") {
    logger.warn(
      "A pre-commit hook already exists — add `mage redact --check --staged` to it for staged-secret blocking.",
    );
  } else if (r.reason === "already") {
    logger.detail("Redaction pre-commit hook already present.");
  }
  // "not-a-repo": stay silent — connect is routinely run outside a git repo.
  return { installed: r.installed, reason: r.reason };
}
