import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { logger } from "../logger.js";
import { exists, readHubMetadata, readMetadata } from "../paths.js";
import { init } from "./init.js";
import { link } from "./link.js";

async function makeHub(): Promise<string> {
  return (await withKb({ kind: "hub" })).dir;
}
async function emptyRepo(): Promise<string> {
  return tmpDir("mage-code-");
}

describe("mage link", () => {
  it("hub-owned link: flat stub + external AGENTS.md pointing at <hub>/_index.<project>.md", async () => {
    const hub = await makeHub();
    const code = await emptyRepo();
    const r = await link(hub, { codeRepo: code, project: "engine", yes: true });

    expect(r.storage).toBe("hub-owned");
    // FLAT stub, no nested mage/
    expect(await exists(join(hub, "projects", "engine"))).toBe(true);
    expect(await exists(join(hub, "projects", "engine", "mage"))).toBe(false);
    // External awareness written into the CODE repo, pointing at the per-project entry
    const agents = await readFile(join(code, "AGENTS.md"), "utf8");
    expect(agents).toContain(`${hub}/_index.engine.md`);
    expect(agents).not.toContain("projects/engine/mage/INDEX.md");
    expect(await readFile(join(code, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    // Registry records storage
    const meta = await readHubMetadata(hub);
    expect(meta?.projects.find((p) => p.name === "engine")?.storage).toBe("hub-owned");
    // mage never runs git
    expect(await exists(join(code, ".git"))).toBe(false);
  });

  it("repo-owned (hybrid) link: AGENTS.md refreshed to the hybrid block, no projects/<name>/ dir", async () => {
    const hub = await makeHub();
    const code = await emptyRepo();
    await init({ mode: "in-repo", yes: true, codeRepo: code, project: "web" });
    const r = await link(hub, { codeRepo: code, project: "web", yes: true });

    expect(r.storage).toBe("repo-owned");
    expect(await exists(join(hub, "projects", "web"))).toBe(false);
    const agents = await readFile(join(code, "AGENTS.md"), "utf8");
    expect(agents).toContain("knowledge base at `mage/`"); // local KB retained
    expect(agents).toContain("also registered with one or more external hubs"); // hybrid wording (Dec 11A)
    expect(agents).not.toContain("_index.web.md"); // not the external block
    const meta = await readHubMetadata(hub);
    expect(meta?.projects.find((p) => p.name === "web")?.storage).toBe("repo-owned");
    // Linking a local KB to a hub makes its mode explicitly hybrid (v2).
    const codeMeta = await readMetadata(code);
    expect(codeMeta?.mode).toBe("hybrid");
  });

  it("error for a non-hub path suggests `mage init --hub`, not the retired --external", async () => {
    const notHub = await emptyRepo();
    const code = await emptyRepo();
    await expect(link(notHub, { codeRepo: code, project: "x", yes: true })).rejects.toThrow(
      /mage init --hub/,
    );
  });

  it("11E: warns when an auto-derived project name is not registered in the hub", async () => {
    const hub = await makeHub();
    const repoA = await emptyRepo();
    await link(hub, { codeRepo: repoA, project: "engine", yes: true, connect: false });
    const repoB = await emptyRepo(); // random `mage-code-*` basename — not "engine"
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await link(hub, { codeRepo: repoB, yes: true, connect: false });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("engine");
    warn.mockRestore();
  });

  it("11E: no warning when the auto-derived basename matches a registered project", async () => {
    const hub = await makeHub();
    const parent = await emptyRepo();
    const repoEngine = join(parent, "engine");
    await mkdir(repoEngine, { recursive: true });
    await link(hub, { codeRepo: repoEngine, project: "engine", yes: true, connect: false });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // re-link with no --project: basename "engine" matches the registry → silent.
    await link(hub, { codeRepo: repoEngine, yes: true, connect: false });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("Decision 5: link auto-connects by default; --no-connect skips", async () => {
    const hub = await makeHub();
    const code = await emptyRepo();
    const wired = await link(hub, { codeRepo: code, project: "x", yes: true });
    expect(wired.connectResult).toBeDefined();
    expect(await exists(join(code, ".claude", "settings.local.json"))).toBe(true);

    const code2 = await emptyRepo();
    const skipped = await link(hub, { codeRepo: code2, project: "y", yes: true, connect: false });
    expect(skipped.connectResult).toBeUndefined();
    expect(await exists(join(code2, ".claude", "settings.local.json"))).toBe(false);
  });
});
