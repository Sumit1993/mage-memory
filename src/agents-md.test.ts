import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import { writeAgentsMd } from "./agents-md.js";

const readAgents = (d: string) => readFile(join(d, "AGENTS.md"), "utf8");

describe("writeAgentsMd — KB shape blocks (kind repo/hub · mode in-repo/hybrid/external) (ADR-0011/0012)", () => {
  it("routes an external code repo to the hub index + names its wing (flat-safe)", async () => {
    const repo = await tmpDir();
    await writeAgentsMd(repo, { kind: "repo", mode: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" });
    const agents = await readAgents(repo);
    expect(agents).toContain("/abs/hub/INDEX.md"); // always-present entry (flat or hierarchical)
    expect(agents).toContain("/abs/hub/_index.engine.md"); // the hierarchical-mode sub-index
    expect(agents).toContain("engine"); // names the wing
  });

  it("does NOT reference the retired per-project entry path", async () => {
    const repo = await tmpDir();
    await writeAgentsMd(repo, { kind: "repo", mode: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" });
    const agents = await readAgents(repo);
    expect(agents).not.toContain("projects/engine/mage/INDEX.md");
    expect(agents).not.toContain("/projects/");
  });

  it("is idempotent (a second write replaces, not appends, the block)", async () => {
    const repo = await tmpDir();
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    await writeAgentsMd(repo, opts);
    const first = await readAgents(repo);
    await writeAgentsMd(repo, opts);
    const second = await readAgents(repo);
    expect(second).toBe(first);
    expect((second.match(/<!-- BEGIN mage -->/g) ?? []).length).toBe(1);
  });

  it("adds the @AGENTS.md import to CLAUDE.md", async () => {
    const repo = await tmpDir();
    await writeAgentsMd(repo, { kind: "repo", mode: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" });
    expect(await readFile(join(repo, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
  });

  it("rejects an unsafe project name and writes nothing", async () => {
    const repo = await tmpDir();
    await expect(
      writeAgentsMd(repo, { kind: "repo", mode: "external", docsRel: "mage", hubPath: "/abs/hub", project: "../evil" }),
    ).rejects.toThrow();
  });

  it("leaves the in-repo mode unchanged", async () => {
    const repo = await tmpDir();
    await writeAgentsMd(repo, { kind: "repo", mode: "in-repo", docsRel: "mage" });
    const agents = await readAgents(repo);
    expect(agents).toContain("knowledge base at `mage/`");
    expect(agents).not.toContain("_index.");
  });

  it("names the capture skill `mage:learn`, not the retired `/mage-learn`", async () => {
    for (const opts of [
      { kind: "repo", mode: "in-repo", docsRel: "mage" },
      { kind: "repo", mode: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" },
    ] as const) {
      const repo = await tmpDir();
      await writeAgentsMd(repo, opts);
      const agents = await readAgents(repo);
      expect(agents).toContain("mage:learn");
      expect(agents).not.toContain("/mage-learn");
    }
  });

  it("carries the always-on inline-capture instruction in every shape (0.0.12)", async () => {
    for (const opts of [
      { kind: "repo", mode: "in-repo", docsRel: "mage" },
      { kind: "repo", mode: "hybrid", docsRel: "mage" },
      { kind: "hub", mode: "in-repo", docsRel: "." },
      { kind: "repo", mode: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" },
    ] as const) {
      const repo = await tmpDir();
      await writeAgentsMd(repo, opts);
      const agents = await readAgents(repo);
      // The inline-primary path: capture at first sight via `mage stage` → `.staging/`.
      expect(agents).toContain("Capture lessons inline");
      expect(agents).toContain("mage stage");
      expect(agents).toContain(".staging");
      expect(agents).toContain("mage:groom");
    }
  });
});
