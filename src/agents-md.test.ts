import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import {
  KEPT_HAND_EDITS_MARKER,
  KEPT_UNSTAMPED_MARKER,
  blockHash,
  keptHandEditsWarning,
  keptUnstampedWarning,
  keptWarning,
  writeAgentsMd,
} from "./agents-md.js";

const BEGIN = "<!-- BEGIN mage -->";
const END = "<!-- END mage -->";

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

  it("keeps a hand-edited block and reports kept-hand-edits", async () => {
    const repo = await tmpDir();
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    await writeAgentsMd(repo, opts);
    const original = await readAgents(repo);
    const edited = original.replace(/^2\. Skim.*$/m, "## Cross-link, don't just file\n\nhand-written");
    expect(edited).not.toBe(original);
    await writeFile(join(repo, "AGENTS.md"), edited);
    const r = await writeAgentsMd(repo, opts);
    expect(r.agents).toBe("kept-hand-edits");
    const current = await readAgents(repo);
    expect(current).toBe(edited);
  });

  it("force regenerates a hand-edited block", async () => {
    const repo = await tmpDir();
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    await writeAgentsMd(repo, opts);
    const original = await readAgents(repo);
    const edited = original.replace(/^2\. Skim.*$/m, "## Cross-link, don't just file\n\nhand-written");
    await writeFile(join(repo, "AGENTS.md"), edited);
    const r = await writeAgentsMd(repo, opts, { force: true });
    expect(r.agents).toBe("written");
    const current = await readAgents(repo);
    expect(current).not.toContain("hand-written");
    expect(current).toContain("<!-- mage-block-hash: ");
  });

  it("a second identical write is unchanged", async () => {
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
    const r = await writeAgentsMd(repo, opts);
    expect(r.agents).toBe("unchanged");
    const second = await readAgents(repo);
    expect(second).toBe(first);
  });

  it("a block mage wrote under an older template regenerates silently", async () => {
    const repo = await tmpDir();
    const oldBody = "## mage knowledge base\n\nold template text";
    const oldBlock = `${BEGIN}\n<!-- mage-block-hash: ${blockHash(oldBody)} -->\n${oldBody}\n${END}`;
    await writeFile(join(repo, "AGENTS.md"), `# AGENTS.md\n\n${oldBlock}\n`);
    const r = await writeAgentsMd(repo, {
      kind: "repo",
      mode: "external",
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    });
    expect(r.agents).toBe("written");
    const current = await readAgents(repo);
    expect(current).not.toContain("old template text");
    expect(current).toContain("/abs/hub/INDEX.md");
  });

  it("a legacy unstamped block whose body matches gets the stamp added", async () => {
    const repo = await tmpDir();
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    await writeAgentsMd(repo, opts);
    const withStamp = await readAgents(repo);
    const stripped = withStamp.replace(/^<!-- mage-block-hash: [0-9a-f]{12} -->\n/m, "");
    await writeFile(join(repo, "AGENTS.md"), stripped);
    const r1 = await writeAgentsMd(repo, opts);
    expect(r1.agents).toBe("written");
    const afterReAdd = await readAgents(repo);
    expect(afterReAdd).toContain("<!-- mage-block-hash: ");
    const r2 = await writeAgentsMd(repo, opts);
    expect(r2.agents).toBe("unchanged");
  });

  it("a legacy unstamped block whose body differs is kept and reports kept-unstamped", async () => {
    const repo = await tmpDir();
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    await writeAgentsMd(repo, opts);
    const withStamp = await readAgents(repo);
    const stripped = withStamp.replace(/^<!-- mage-block-hash: [0-9a-f]{12} -->\n/m, "");
    const legacy = stripped.replace("mage:groom", "/mage-groom");
    expect(legacy).not.toBe(withStamp);
    await writeFile(join(repo, "AGENTS.md"), legacy);
    const r = await writeAgentsMd(repo, opts);
    expect(r.agents).toBe("kept-unstamped");
    const current = await readAgents(repo);
    expect(current).toBe(legacy);
  });

  it("force regenerates a legacy unstamped block and stamps it", async () => {
    const repo = await tmpDir();
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    await writeAgentsMd(repo, opts);
    const withStamp = await readAgents(repo);
    const stripped = withStamp.replace(/^<!-- mage-block-hash: [0-9a-f]{12} -->\n/m, "");
    const legacy = stripped.replace("mage:groom", "/mage-groom");
    expect(legacy).not.toBe(withStamp);
    await writeFile(join(repo, "AGENTS.md"), legacy);
    const r1 = await writeAgentsMd(repo, opts, { force: true });
    expect(r1.agents).toBe("written");
    const afterForce = await readAgents(repo);
    expect(afterForce).toContain("<!-- mage-block-hash: ");
    expect(afterForce).not.toContain("/mage-groom");
    const r2 = await writeAgentsMd(repo, opts);
    expect(r2.agents).toBe("unchanged");
  });

  it("an orphaned BEGIN with text after it is kept unless forced", async () => {
    const repo = await tmpDir();
    const content = `# AGENTS.md\n\n<!-- BEGIN mage -->\nhand text\n`;
    await writeFile(join(repo, "AGENTS.md"), content);
    const opts = {
      kind: "repo" as const,
      mode: "external" as const,
      docsRel: "mage",
      hubPath: "/abs/hub",
      project: "engine",
    };
    const r1 = await writeAgentsMd(repo, opts);
    expect(r1.agents).toBe("kept-hand-edits");
    const after1 = await readAgents(repo);
    expect(after1).toBe(content);

    const r2 = await writeAgentsMd(repo, opts, { force: true });
    expect(r2.agents).toBe("written");
    const after2 = await readAgents(repo);
    expect(after2).toContain("/abs/hub/INDEX.md");
    expect(after2).not.toContain("hand text");
  });

  it("warning carries the stable marker string that migrate and doctor can match on", () => {
    expect(KEPT_HAND_EDITS_MARKER).toBe("has hand edits and was left as is");
    const msg = keptHandEditsWarning("/some/path/AGENTS.md");
    expect(msg).toContain(KEPT_HAND_EDITS_MARKER);
    expect(msg).toBe(
      "/some/path/AGENTS.md: the mage block between <!-- BEGIN mage --> and <!-- END mage --> has hand edits and was left as is. Re-run with --force-agents-md to regenerate it (your edits in the block will be lost).",
    );
    expect(KEPT_UNSTAMPED_MARKER).toBe("predates hash stamps and was left as is");
    expect(keptUnstampedWarning("/some/path/AGENTS.md")).toBe(
      "/some/path/AGENTS.md: the mage block between <!-- BEGIN mage --> and <!-- END mage --> predates hash stamps and was left as is. mage cannot tell whether you edited it. Re-run with --force-agents-md once to regenerate it (any edits inside the block are lost); the regenerated block is stamped and refreshes on its own from then on.",
    );
    expect(keptWarning({ agents: "unchanged", path: "/p" })).toBeNull();
    expect(keptWarning({ agents: "kept-unstamped", path: "/p" })).toBe(
      keptUnstampedWarning("/p"),
    );
  });
});
