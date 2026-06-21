// The fixture dogfoods itself: every kind/schema produces a KB that resolves the way real
// commands resolve it. A break here would otherwise surface as a confusing failure across the
// ~50 specs that depend on the fixture, so it earns its own spec next to it.

import { describe, expect, it } from "vitest";
import { readHubMetadata, readMetadata } from "../../src/paths.js";
import { tmpDir, withKb } from "./kb.js";

describe("tmpDir", () => {
  it("returns a fresh dir each call", async () => {
    expect(await tmpDir()).not.toBe(await tmpDir());
  });
});

describe("withKb — each shape builds a resolvable KB", () => {
  it('repo (default): in-repo, dir == repo, root is the docs root', async () => {
    const { dir, root, repo, resolved } = await withKb();
    expect(resolved.kind).toBe("repo");
    expect(resolved.repo).toBe(dir);
    expect(repo).toBe(dir);
    expect(root).toBe(resolved.root);
    expect((await readMetadata(repo))?.mode).toBe("in-repo");
  });

  it("repo: writes the grooming block through", async () => {
    const { repo } = await withKb({ grooming: { autonomy: "approver", sensitivity: "high" } });
    expect((await readMetadata(repo))?.grooming).toEqual({ autonomy: "approver", sensitivity: "high" });
  });

  it("repo: schema 1 writes a v1 metadata file (the normalize/migrate path)", async () => {
    const { repo } = await withKb({ schema: 1 });
    // readMetadata returns the ON-DISK schema value, so a v1 file reads back as v1.
    const meta = await readMetadata(repo);
    expect(meta).not.toBeNull();
    expect(meta?.schema).toBe("mage.v1");
  });

  it("hub: resolves to a hub root (dir == root == repo)", async () => {
    const { dir, root, repo, resolved } = await withKb({ kind: "hub" });
    expect(resolved.kind).toBe("hub");
    expect(dir).toBe(root);
    expect(root).toBe(repo);
    expect((await readHubMetadata(repo))?.name).toBe("hub");
  });

  it("hub: registers projects", async () => {
    const { repo } = await withKb({
      kind: "hub",
      projects: [{ name: "x", storage: "hub-owned", code_repo_path: "/tmp/x", code_repo_url: "" }],
    });
    expect((await readHubMetadata(repo))?.projects?.[0]?.name).toBe("x");
  });

  it("project: a hub-owned project resolves with root != repo (the ADR-0030 case)", async () => {
    const { dir, root, repo, resolved } = await withKb({ kind: "project", grooming: { autonomy: "overseer" } });
    expect(resolved.kind).toBe("hub");
    expect(resolved.repo).toBe(repo); // the hub owns the metadata
    expect(resolved.root).toBe(root); // the project dir is the docs root
    expect(root).not.toBe(repo); // the precondition the seam must hold
    expect(dir).toBe(root);
    expect((await readHubMetadata(repo))?.grooming?.autonomy).toBe("overseer");
  });
});
