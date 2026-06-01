import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureGitignored } from "./gitignore.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("ensureGitignored", () => {
  it("adds each pattern exactly once (idempotent)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mage-gi-"));
    made.push(dir);
    expect(await ensureGitignored(dir, ["a/", "b/"])).toEqual(["a/", "b/"]);
    expect(await ensureGitignored(dir, ["a/", "b/"])).toEqual([]);
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi.match(/^a\/$/gm)?.length).toBe(1);
  });
});
