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
import { ensureGitignored } from "../gitignore.js";
import { logger } from "../logger.js";
import { resolveDocsRoot } from "../paths.js";

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
  // settings.local.json is itself personal + gitignored by Claude Code; the capture
  // SINKS those hooks feed (.learnings/, .metrics/) are gitignored separately below.
  logger.success(`Wired ${wired} events into ${target.path} (personal settings file).`);
  logger.detail("Run `mage disconnect` to remove.");

  // Self-heal the capture-sink ignores so the dirs these hooks write can never be
  // committed (ADR-0021). Resolve the LOCAL KB explicitly off opts.cwd — never a
  // bare process.cwd() that tests can't override (the --user/cwd leak gotcha). The
  // invariant is about the cwd, not the --user flag: when no KB is found walking up
  // from cwd we skip (nothing to ignore here); when run from INSIDE a KB the sink
  // ignores ARE written regardless of --user (correct — that KB's sinks must never
  // be committable). We never create a KB here.
  await ensureSinkIgnores(opts.cwd ?? process.cwd());

  // Gate 2 (ADR-0018 §7): the blocking, un-skippable redaction net at the tracked
  // write. Independently toggleable; the installer refuses to clobber a foreign
  // hook, so this is safe to attempt unconditionally. A non-repo cwd no-ops.
  const hook = opts.gitHook === false ? undefined : await installHook(opts.cwd ?? process.cwd());

  return { path: target.path, scope: target.scope, wired, backedUp, hook };
}

/**
 * Gitignore the capture sinks (.learnings/, .metrics/) at the right root so they
 * can never be committed — even on a public KB with an empty .gitignore. Mirrors
 * the capture-sink patterns `mage init` writes (init.ts):
 *   - in-repo: code-repo root, mage/-prefixed patterns.
 *   - hub:     hub root, bare + glob-recursive patterns.
 * Resolves the KB from `startDir` only. A null result means no KB was found walking
 * up from cwd (a fresh non-KB dir, OR connect run from outside any KB) — we skip the
 * write but emit a hint pointing at the in-KB self-heal, since that is the leak
 * window. Running from inside a KB writes the ignores regardless of --user.
 */
async function ensureSinkIgnores(startDir: string): Promise<void> {
  const kb = await resolveDocsRoot(startDir);
  if (!kb) {
    // Hooks were wired but no KB was found walking up from cwd — the real
    // leak-window (e.g. `mage connect --user` from outside any KB). Point the
    // user at the in-KB self-heal so their capture sinks still get gitignored.
    logger.info(
      "No mage KB found here — run `mage doctor --fix` from inside your KB so capture sinks are gitignored.",
    );
    return;
  }

  // in-repo: ignore at the CODE-REPO root (kb.repo, the dir containing mage/),
  // mirroring init's `mage/`-prefixed sink patterns. hub: ignore at the hub root.
  const { root, patterns } =
    kb.kind === "in-repo"
      ? { root: kb.repo, patterns: ["mage/.learnings/", "mage/.metrics/"] }
      : {
          root: kb.root,
          patterns: [".learnings/", "**/.learnings/", ".metrics/", "**/.metrics/"],
        };

  const added = await ensureGitignored(root, patterns);
  if (added.length > 0) {
    logger.success(`Gitignored ${added.length} capture sink(s): ${added.join(", ")}`);
  }
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
