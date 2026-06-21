import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureGitignored } from "./gitignore.js";
import { tmpDir } from "../test/fixtures/kb.js";

describe("ensureGitignored", () => {
  it("adds each pattern exactly once (idempotent)", async () => {
    const dir = await tmpDir("mage-gi-");
    expect(await ensureGitignored(dir, ["a/", "b/"])).toEqual(["a/", "b/"]);
    expect(await ensureGitignored(dir, ["a/", "b/"])).toEqual([]);
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi.match(/^a\/$/gm)?.length).toBe(1);
  });
});
