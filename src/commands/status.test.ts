import { describe, expect, it } from "vitest";
import { withKb } from "../../test/fixtures/kb.js";
import { status } from "./status.js";

describe("status — hub expansion (Decision 11B)", () => {
  it("a hub argument throws and names the code repo path requirement", async () => {
    const hub = await withKb({
      kind: "hub",
      projects: [{ name: "alpha", storage: "repo-owned", code_repo_url: "" }],
    });

    await expect(status({ codeRepos: [hub.dir] })).rejects.toThrow(/is a mage hub/);
  });

  it("a non-hub code repo passes through unchanged", async () => {
    const a = await withKb({ kind: "repo" });
    const r = await status({ codeRepos: [a.dir] });
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]?.codeRepo).toBe(a.dir);
  });
});
