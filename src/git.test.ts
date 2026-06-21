import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import { gitInit, isGitRepo } from "./git.js";

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
