import { describe, expect, it } from "vitest";
import { withKb } from "../../test/fixtures/kb.js";
import { status } from "./status.js";

describe("status — hub expansion (Decision 11B)", () => {
  it("a hub argument expands to its registered project code repos", async () => {
    const a = await withKb({ kind: "repo" });
    const hub = await withKb({
      kind: "hub",
      projects: [{ name: "alpha", storage: "repo-owned", code_repo_path: a.dir, code_repo_url: "" }],
    });

    const r = await status({ codeRepos: [hub.dir] });
    // The hub root itself is NOT treated as a code repo — it expands to project a.
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]?.codeRepo).toBe(a.dir);
    expect(r.repos[0]?.metadata.ok).toBe(true);
  });

  it("a non-hub code repo passes through unchanged", async () => {
    const a = await withKb({ kind: "repo" });
    const r = await status({ codeRepos: [a.dir] });
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]?.codeRepo).toBe(a.dir);
  });
});
