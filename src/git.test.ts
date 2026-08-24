import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import {
  filterDirtyPathsOutsideKb,
  getDefaultBranch,
  getDirtyPaths,
  getRepoRoot,
  gitAdd,
  getCurrentBranch,
  gitCheckoutNewBranch,
  gitCommit,
  gitInit,
  isGitRepo,
  noteExistsInHead,
  noteGitState,
} from "./git.js";
import { run } from "./shell.js";

const tmp = (): Promise<string> => tmpDir("mage-git-");

describe("isGitRepo", () => {
  it("is true inside a freshly git-init'd dir", async () => {
    const d = await tmp();
    await gitInit(d);
    expect(await isGitRepo(d)).toBe(true);
  });

  it("is false for a plain (non-git) dir", async () => {
    const d = await tmp();
    expect(await isGitRepo(d)).toBe(false);
  });
});

describe("noteGitState", () => {
  async function gitCommit(repo: string, msg: string): Promise<void> {
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-q", "-m", msg]);
  }

  it("is not-a-repo for a plain dir", async () => {
    const d = await tmp();
    expect(await noteGitState(d, "notes/x.md")).toBe("not-a-repo");
  });

  it("is untracked for a brand-new file", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "x.md"), "hi\n");
    expect(await noteGitState(repo, "x.md")).toBe("untracked");
  });

  it("is modified for a staged-but-uncommitted add and for an edited tracked file", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "x.md"), "one\n");
    await run("git", ["-C", repo, "add", "--", "x.md"]);
    expect(await noteGitState(repo, "x.md")).toBe("modified"); // staged add, not in HEAD yet

    await gitCommit(repo, "add x");
    await writeFile(join(repo, "x.md"), "two\n");
    expect(await noteGitState(repo, "x.md")).toBe("modified"); // tracked, differs from HEAD
  });

  it("is clean for a committed, unchanged file", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "x.md"), "one\n");
    await run("git", ["-C", repo, "add", "--", "x.md"]);
    await gitCommit(repo, "add x");
    expect(await noteGitState(repo, "x.md")).toBe("clean");
  });

  it("is deleted for a committed file removed from the working tree", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "x.md"), "one\n");
    await run("git", ["-C", repo, "add", "--", "x.md"]);
    await gitCommit(repo, "add x");
    await rm(join(repo, "x.md"));
    expect(await noteGitState(repo, "x.md")).toBe("deleted");
    expect(await noteExistsInHead(repo, "x.md")).toBe(true); // still in HEAD (working-tree deletion)
  });

  it("noteExistsInHead is false for an untracked path and true for a committed one", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "x.md"), "one\n");
    expect(await noteExistsInHead(repo, "x.md")).toBe(false);
    await run("git", ["-C", repo, "add", "--", "x.md"]);
    await gitCommit(repo, "add x");
    expect(await noteExistsInHead(repo, "x.md")).toBe(true);
  });
});

describe("proposal git helpers", () => {
  it("getRepoRoot returns repo root when inside repo, null otherwise", async () => {
    const repo = await tmp();
    expect(await getRepoRoot(repo)).toBeNull();
    await gitInit(repo);
    const resolved = await getRepoRoot(repo);
    expect(resolved).toBeTruthy();
  });

  it("getDefaultBranch detects main or branch configured", async () => {
    const repo = await tmp();
    await gitInit(repo);
    const def = await getDefaultBranch(repo);
    expect(def).toBeDefined();
    expect(typeof def).toBe("string");
  });

  it("getDirtyPaths lists untracked and modified files", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "file1.txt"), "hello\n");
    await writeFile(join(repo, "file2.txt"), "world\n");
    const dirty = await getDirtyPaths(repo);
    expect(dirty).toContain("file1.txt");
    expect(dirty).toContain("file2.txt");
  });

  it("filterDirtyPathsOutsideKb filters paths properly", () => {
    const repo = "/repos/project";
    const docsRoot = "/repos/project/mage";
    const dirty = ["src/index.ts", "mage/notes/a.md", "package.json", "mage/INDEX.md"];
    const outside = filterDirtyPathsOutsideKb(repo, docsRoot, dirty);
    expect(outside).toEqual(["src/index.ts", "package.json"]);
  });

  it("filterDirtyPathsOutsideKb handles hub where docsRoot is repo", () => {
    const repo = "/hubs/my-hub";
    const docsRoot = "/hubs/my-hub";
    const dirty = ["notes/a.md", "projects/p/notes/b.md"];
    const outside = filterDirtyPathsOutsideKb(repo, docsRoot, dirty);
    expect(outside).toEqual([]);
  });

  it("gitCheckoutNewBranch, gitAdd, gitCommit work in repo", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await writeFile(join(repo, "init.txt"), "init\n");
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "add", "init.txt"]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "initial"]);

    await gitCheckoutNewBranch(repo, "mage/proposal/test-branch");
    await writeFile(join(repo, "note.md"), "test\n");
    await gitAdd(repo, ["note.md"]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "add note"]);

    const head = await run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"]);
    expect(head.stdout.trim()).toBe("mage/proposal/test-branch");
  });
});

describe("getDirtyPaths — rename sources (ADR-0046 §7 gate)", () => {
  async function repoWithCommit(): Promise<string> {
    const repo = await tmp();
    await gitInit(repo);
    await run("git", ["-C", repo, "config", "user.email", "t@e.com"]);
    await run("git", ["-C", repo, "config", "user.name", "t"]);
    return repo;
  }

  it("reports a rename's SOURCE, so an outside→inside-KB move cannot slip the gate", async () => {
    const repo = await repoWithCommit();
    await run("mkdir", ["-p", join(repo, "src"), join(repo, "mage", "notes")]);
    await writeFile(join(repo, "src", "foo.ts"), "hi\n");
    await gitAdd(repo, [repo]);
    await gitCommit(repo, "init");
    await run("git", ["-C", repo, "mv", "src/foo.ts", "mage/notes/foo.md"]);

    const dirty = await getDirtyPaths(repo);
    expect(dirty).toContain("mage/notes/foo.md");
    expect(dirty).toContain("src/foo.ts");
    // and therefore the gate sees a path outside the KB
    expect(filterDirtyPathsOutsideKb(repo, join(repo, "mage"), dirty)).toEqual(["src/foo.ts"]);
  });
});

describe("gitCheckoutNewBranch start point", () => {
  it("cuts from the given branch, not from HEAD", async () => {
    const repo = await tmp();
    await gitInit(repo);
    await run("git", ["-C", repo, "config", "user.email", "t@e.com"]);
    await run("git", ["-C", repo, "config", "user.name", "t"]);
    await writeFile(join(repo, "a.txt"), "a\n");
    await gitAdd(repo, [repo]);
    await gitCommit(repo, "base");
    const base = await getCurrentBranch(repo);

    await gitCheckoutNewBranch(repo, "feature");
    await writeFile(join(repo, "b.txt"), "b\n");
    await gitAdd(repo, [repo]);
    await gitCommit(repo, "unrelated feature work");

    // from the feature branch, cut a proposal branch off the base branch
    await gitCheckoutNewBranch(repo, "mage/proposal/x", base ?? "main");
    const log = await run("git", ["-C", repo, "log", "--oneline"]);
    expect(log.stdout).not.toContain("unrelated feature work");
    expect(log.stdout).toContain("base");
  });
});
