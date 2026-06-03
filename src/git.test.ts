import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitInit, isGitRepo } from "./git.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mage-git-"));
  made.push(d);
  return d;
}

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
