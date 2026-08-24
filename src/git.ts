import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
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
 * The top-level root directory of the git repo containing `dir`, or null if not a repo.
 */
export async function getRepoRoot(dir: string): Promise<string | null> {
  const r = await run("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  return r.code === 0 ? r.stdout.trim() || null : null;
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

/**
 * Determine the default branch name of `repoPath`, defaulting to "main".
 */
export async function getDefaultBranch(repoPath: string): Promise<string> {
  const originHead = await run("git", [
    "-C",
    repoPath,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (originHead.code === 0 && originHead.stdout.trim()) {
    return originHead.stdout.trim().replace(/^origin\//, "");
  }
  const initDefault = await run("git", ["-C", repoPath, "config", "init.defaultBranch"]);
  if (initDefault.code === 0 && initDefault.stdout.trim()) {
    return initDefault.stdout.trim();
  }
  const hasMain = await run("git", ["-C", repoPath, "rev-parse", "--verify", "refs/heads/main"]);
  if (hasMain.code === 0) return "main";
  const hasMaster = await run("git", ["-C", repoPath, "rev-parse", "--verify", "refs/heads/master"]);
  if (hasMaster.code === 0) return "master";
  return "main";
}

/**
 * Get repo-relative dirty (modified, added, deleted, untracked) paths.
 */
export async function getDirtyPaths(repoPath: string): Promise<string[]> {
  const r = await run("git", ["-C", repoPath, "status", "--porcelain", "-z"]);
  if (r.code !== 0) return [];
  const entries = r.stdout.split("\0").filter((s) => s.length > 0);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) paths.push(path);
    if (status.includes("R") || status.includes("C")) {
      // porcelain -z emits `XY <new>\0<orig>\0`. A RENAME's source is a real change
      // outside the KB and must be seen; a COPY leaves its source untouched.
      const origPath = entries[i + 1];
      if (status.includes("R") && origPath) paths.push(origPath);
      i++;
    }
  }
  return paths;
}

/**
 * Filter dirty paths to only those sitting outside the knowledge base root.
 */
export function filterDirtyPathsOutsideKb(
  repo: string,
  docsRoot: string,
  dirtyPaths: readonly string[],
): string[] {
  const prefix = relative(repo, docsRoot).split(sep).join("/");
  const isInside = (file: string) => {
    if (prefix === "" || prefix === ".") return true;
    return file === prefix || file.startsWith(`${prefix}/`);
  };
  return dirtyPaths.filter((p) => !isInside(p));
}

/**
 * Create and check out a new branch in `repoPath`.
 */
export async function gitCheckoutNewBranch(
  repoPath: string,
  branchName: string,
  startPoint?: string,
): Promise<void> {
  // Without a start point this cuts from HEAD, so a feature branch's unrelated commits
  // ride into a proposal PR opened against the default branch (ADR-0046 §1).
  const args = ["-C", repoPath, "checkout", "-b", branchName];
  if (startPoint) args.push(startPoint);
  await run("git", args, { throwOnError: true });
}

/** Check out an existing branch. Returns false instead of throwing. */
export async function gitCheckoutBranch(repoPath: string, branchName: string): Promise<boolean> {
  const r = await run("git", ["-C", repoPath, "checkout", branchName]);
  return r.code === 0;
}

/** Force-delete a local branch. Returns false instead of throwing. */
export async function gitDeleteBranch(repoPath: string, branchName: string): Promise<boolean> {
  const r = await run("git", ["-C", repoPath, "branch", "-D", branchName]);
  return r.code === 0;
}

/** The branch currently checked out, or null when detached / not a repo. */
export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  const r = await run("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (r.code !== 0) return null;
  const name = r.stdout.trim();
  return name && name !== "HEAD" ? name : null;
}

/**
 * Stage paths in `repoPath`.
 */
export async function gitAdd(repoPath: string, paths: string[]): Promise<void> {
  await run("git", ["-C", repoPath, "add", "--", ...paths], { throwOnError: true });
}

/**
 * Create a commit with message in `repoPath`.
 */
export async function gitCommit(repoPath: string, message: string): Promise<void> {
  await run("git", ["-C", repoPath, "commit", "-m", message], { throwOnError: true });
}

/**
 * Push branch to origin in `repoPath`.
 */
export async function gitPush(repoPath: string, branchName: string): Promise<void> {
  await run("git", ["-C", repoPath, "push", "-u", "origin", branchName], { throwOnError: true });
}

/**
 * Open a pull request using `gh pr create` (ADR-0046). Returns the PR URL.
 */
export async function createPullRequest(
  repoPath: string,
  opts: { branch: string; base: string; title: string; body: string },
): Promise<string> {
  const r = await run(
    "gh",
    [
      "pr",
      "create",
      "--head",
      opts.branch,
      "--base",
      opts.base,
      "--title",
      opts.title,
      "--body",
      opts.body,
    ],
    { cwd: repoPath, throwOnError: true },
  );
  return r.stdout.trim();
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

