// Gate-2 redaction pre-commit hook (ADR-0018 §7, realizing ADR-0014's amendment).
//
// distill mass-produces *tracked* notes from raw scratch, so the moment a secret
// leaks is at the tracked write. Gate 1 (inline `mage redact` per draft) is
// judgment-tier and skippable; Gate 2 is the deterministic, un-skippable net: a
// git `pre-commit` hook that runs `mage redact --check --staged` and BLOCKS the
// commit on a live secret (`git commit --no-verify` is the human escape hatch).
//
// The installer mirrors claude-settings.ts discipline: refuse-don't-clobber a
// foreign hook (we never overwrite a hook we didn't write), idempotent by marker,
// and a pure immutable construction (we read the existing file, never mutate it).
// Everything here is reachable from `mage connect`/`mage disconnect`; nothing a
// host invokes should ever throw, so resolveHooksDir fails-open to null.

import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "./shell.js";

// ─── constants ───────────────────────────────────────────────────────────────

/**
 * The marker comment that stamps a pre-commit hook as mage-owned. Installation,
 * the "already present" check, and removal all key on this string — so a hook we
 * wrote is recognizable on a later run and a foreign hook is never touched.
 */
export const REDACT_HOOK_MARKER = "mage:redact-precommit";

/**
 * The POSIX `/bin/sh` pre-commit script. Deterministic and un-skippable at the
 * tracked write: it runs `mage redact --check --staged`, and on a non-zero exit
 * (a live secret found) prints a clear message to stderr and blocks the commit.
 * The body carries REDACT_HOOK_MARKER on a comment line so it is self-identifying.
 *
 * FAIL-OPEN on infrastructure, not on a secret: mage ships as a Claude Code
 * *plugin*, so a user can have the hook (via `mage connect`) without `mage` on
 * the git hook's minimal PATH. Without the guard `mage` exits 127, `! 127` is
 * true, and EVERY commit would block with a false "live secret" message — failing
 * CLOSED on an infra error, contrary to the host-hook fail-open intent. The
 * `command -v mage` guard skips (exit 0) when mage is absent, so the gate only
 * ever blocks on a genuine live-secret verdict from `mage redact`.
 */
export const REDACT_HOOK_BODY = `#!/bin/sh
# ${REDACT_HOOK_MARKER} — installed by \`mage connect\`; remove with \`mage disconnect\`.
command -v mage >/dev/null 2>&1 || { echo "mage not found on PATH; skipping redaction gate" 1>&2; exit 0; }
if ! mage redact --check --staged; then
  echo "commit blocked — staged changes contain a live secret; remove it or commit with --no-verify" 1>&2
  exit 1
fi
`;

// ─── resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve the absolute hooks directory for the repo at `repoPath` via
 * `git rev-parse --git-path hooks`. git returns a path relative to the repo
 * (e.g. `.git/hooks`), so we `resolve` it against `repoPath` — `path.resolve`
 * passes an already-absolute git-path through unchanged (worktrees, custom
 * GIT_DIR), so both shapes land absolute. Returns null when `repoPath` is not a
 * git work tree (or git is missing) — the not-a-repo signal the installer uses
 * to no-op silently. Fail-open: never throws.
 */
export async function resolveHooksDir(repoPath: string): Promise<string | null> {
  const r = await run("git", ["-C", repoPath, "rev-parse", "--git-path", "hooks"]);
  if (r.code !== 0) return null;
  const rel = r.stdout.trim();
  if (!rel) return null;
  return resolve(repoPath, rel);
}

// ─── install ─────────────────────────────────────────────────────────────────

/** Outcome of {@link installRedactHook}. */
export interface InstallHookResult {
  installed: boolean;
  path: string;
  reason?: "not-a-repo" | "exists-foreign" | "already";
  backedUp: boolean;
}

/**
 * Install the redaction pre-commit hook into the repo at `repoPath`, refusing to
 * clobber a foreign hook. Resolution failures (not a repo) no-op. If a pre-commit
 * hook already exists we read it: ours (carries the marker) → "already"; anyone
 * else's → "exists-foreign" and we leave it completely untouched. Otherwise we
 * write the hook and chmod it executable. Never mutates an existing file.
 */
export async function installRedactHook(repoPath: string): Promise<InstallHookResult> {
  const hooksDir = await resolveHooksDir(repoPath);
  if (hooksDir === null) {
    return { installed: false, path: "", reason: "not-a-repo", backedUp: false };
  }

  const hookPath = resolve(hooksDir, "pre-commit");
  await mkdir(hooksDir, { recursive: true });

  // A symlink at pre-commit is foreign-by-definition: writeFile/chmod would FOLLOW
  // it and clobber/chmod the target (a TOCTOU if it was planted between checks). We
  // never wrote a symlink, so treat any symlink as a foreign hook — never touch it.
  if (await isSymlink(hookPath)) {
    return { installed: false, path: hookPath, reason: "exists-foreign", backedUp: false };
  }

  const existing = await readHookIfPresent(hookPath);
  if (existing !== null) {
    // A pre-commit hook is already there. Recognize our own by marker; never
    // overwrite a foreign one (the human's hook is theirs to keep).
    const reason = existing.includes(REDACT_HOOK_MARKER) ? "already" : "exists-foreign";
    return { installed: false, path: hookPath, reason, backedUp: false };
  }

  await writeFile(hookPath, REDACT_HOOK_BODY);
  await chmod(hookPath, 0o755);
  return { installed: true, path: hookPath, backedUp: false };
}

// ─── remove ──────────────────────────────────────────────────────────────────

/** Outcome of {@link removeRedactHook}. */
export interface RemoveHookResult {
  removed: boolean;
  path: string;
}

/**
 * Remove the redaction pre-commit hook from the repo at `repoPath` — but only if
 * it is ours (carries the marker). A missing hook, a foreign hook, or a
 * not-a-repo path all yield `{removed:false}`: we never delete a hook we didn't
 * write. Fail-open like install.
 */
export async function removeRedactHook(repoPath: string): Promise<RemoveHookResult> {
  const hooksDir = await resolveHooksDir(repoPath);
  if (hooksDir === null) return { removed: false, path: "" };

  const hookPath = resolve(hooksDir, "pre-commit");
  const existing = await readHookIfPresent(hookPath);
  if (existing === null || !existing.includes(REDACT_HOOK_MARKER)) {
    return { removed: false, path: hookPath };
  }

  await rm(hookPath, { force: true });
  return { removed: true, path: hookPath };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a hook file's contents, fail-open to null when it is absent. A missing
 * hook (ENOENT) is the normal "nothing installed" case, not an error; any other
 * read failure also returns null so a host-reachable path never throws.
 */
async function readHookIfPresent(hookPath: string): Promise<string | null> {
  try {
    return await readFile(hookPath, "utf8");
  } catch {
    return null;
  }
}

/** True iff `path` exists and is a symlink. Fail-open to false (absent / unreadable). */
async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}
