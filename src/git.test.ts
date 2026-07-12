import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import { gitInit, isGitRepo, noteExistsInHead, noteGitState } from "./git.js";
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
