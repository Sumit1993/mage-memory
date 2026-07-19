import { access } from "node:fs/promises";
import { join } from "node:path";
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
 * The short HEAD commit hash for `repoPath` (e.g. "aad31f0"), or null when git is
 * missing, `repoPath` is not a repo, or it has no commits yet. Read-only; never
 * throws. The provenance `commit` staleness anchor mage stamps at note creation
 * (ADR-0031).
 */
export async function getHeadCommit(repoPath: string): Promise<string | null> {
  const r = await run("git", ["-C", repoPath, "rev-parse", "--short", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

/** The git state of ONE note file, from the reject-ledger reconciler's view (ADR-0031 P2). */
export type NoteGitState = "untracked" | "modified" | "clean" | "deleted" | "not-a-repo";

/**
 * Classify a single note's git state relative to HEAD + the working tree (ADR-0031 P2) —
 * generalizing the `git diff`/`ls-files` plumbing in the CC flatten sweep, but for ONE
 * repo-relative path. Read-only; never throws (fail-open ⇒ "not-a-repo"). States:
 *   - "not-a-repo" — `repo` is not inside a git work tree.
 *   - "deleted"    — the file is absent from the working tree (a discard/reject candidate;
 *                    the caller disambiguates via {@link noteExistsInHead}).
 *   - "untracked"  — on disk, not yet tracked (a brand-new capture).
 *   - "modified"   — tracked/staged but differing from HEAD (uncommitted edits or a staged add).
 *   - "clean"      — tracked and identical to HEAD (committed — the terminal keep/edited case).
 * `relPath` is interpreted relative to the git repo root (`repo` is expected to be the top level).
 */
export async function noteGitState(repo: string, relPath: string): Promise<NoteGitState> {
  const inWorkTree = await run("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"]);
  if (inWorkTree.code !== 0 || inWorkTree.stdout.trim() !== "true") return "not-a-repo";

  const others = await run("git", ["-C", repo, "ls-files", "--others", "--exclude-standard", "-z", "--", relPath]);
  if (others.code === 0 && others.stdout.split("\0").some((l) => l.length > 0)) return "untracked";

  // Not untracked: either tracked, staged, or absent. `git diff --quiet HEAD` folds staged +
  // unstaged: exit 0 ⇒ identical to HEAD, non-zero ⇒ differs (an edit, a staged add, or a deletion).
  const diff = await run("git", ["-C", repo, "diff", "--quiet", "HEAD", "--", relPath]);
  if (diff.code === 0) return "clean";
  // Differs from HEAD: a working-tree file is a modification; an absent one is a deletion.
  return (await fileExists(repo, relPath)) ? "modified" : "deleted";
}

/** True iff `relPath` (repo-root-relative) exists in the committed HEAD tree. Fail-open: false. */
export async function noteExistsInHead(repo: string, relPath: string): Promise<boolean> {
  const r = await run("git", ["-C", repo, "cat-file", "-e", `HEAD:${relPath}`]);
  return r.code === 0;
}

/** True iff the working-tree file at `relPath` (repo-root-relative under `repo`) exists on disk. */
async function fileExists(repo: string, relPath: string): Promise<boolean> {
  try {
    await access(join(repo, relPath));
    return true;
  } catch {
    return false;
  }
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

