import { run, which } from "./shell.js";

/**
 * Get the `origin` remote URL for a git repo. Returns null if not a repo or
 * no origin remote configured.
 */
export async function getRemoteOriginUrl(repoPath: string): Promise<string | null> {
  const result = await run("git", ["-C", repoPath, "remote", "get-url", "origin"]);
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

/**
 * Initialize a new git repo in `path`. No-op if already a repo.
 */
export async function gitInit(path: string): Promise<void> {
  await run("git", ["-C", path, "init", "--quiet"], { throwOnError: true });
}

/**
 * True iff `dir` is inside a git work tree. Read-only (never mutates); returns
 * false gracefully when git is missing or `dir` is not a repo. Used by
 * `mage init` to detect in-repo vs standalone-hub (ADR-0012 §3).
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await run("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

/**
 * Check whether `gh` CLI is installed.
 */
export async function hasGh(): Promise<boolean> {
  return which("gh");
}

/**
 * Check whether `git` is installed.
 */
export async function hasGit(): Promise<boolean> {
  return which("git");
}

