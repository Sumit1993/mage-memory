import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exists, readHubMetadata, readMetadata } from "../paths.js";
import { init } from "./init.js";
import { link } from "./link.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeHub(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-hub-"));
  made.push(dir);
  await mkdir(join(dir, "projects"), { recursive: true });
  await writeFile(
    join(dir, "metadata.json"),
    `${JSON.stringify({ schema: "mage.v1", name: "h", created_at: "2026-06-03", projects: [] }, null, 2)}\n`,
  );
  return dir;
}
async function emptyRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-code-"));
  made.push(dir);
  return dir;
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

  it("in-repo (hybrid) link: no external block, no projects/<name>/ dir", async () => {
    const hub = await makeHub();
    const code = await emptyRepo();
    await init({ mode: "in-repo", yes: true, codeRepo: code, project: "web" });
    const r = await link(hub, { codeRepo: code, project: "web", yes: true });

    expect(r.storage).toBe("repo-owned");
    expect(await exists(join(hub, "projects", "web"))).toBe(false);
    const agents = await readFile(join(code, "AGENTS.md"), "utf8");
    expect(agents).toContain("knowledge base at `mage/`"); // in-repo block kept
    expect(agents).not.toContain("_index.web.md"); // not overwritten with external block
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
});
