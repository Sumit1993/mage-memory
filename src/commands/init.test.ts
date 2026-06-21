import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import { gitInit } from "../git.js";
import { METADATA_SCHEMA, exists, readHubMetadata } from "../paths.js";
import { init } from "./init.js";

async function fresh(): Promise<string> {
  return tmpDir("mage-init-");
}

describe("mage init --in-repo", () => {
  it("scaffolds the vault, metadata, obsidian config, AGENTS.md, gitignore", async () => {
    const dir = await fresh();
    const r = await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" });
    expect(r.mode).toBe("in-repo");

    for (const d of ["notes", "work", "decisions", "archive"]) {
      expect((await stat(join(dir, "mage", d))).isDirectory()).toBe(true);
    }

    const meta = JSON.parse(await readFile(join(dir, "mage", "metadata.json"), "utf8"));
    expect(meta.schema).toBe(METADATA_SCHEMA);
    expect(meta.mode).toBe("in-repo");
    expect(meta.project).toBe("demo");

    for (const f of ["app.json", "graph.json", "appearance.json"]) {
      expect((await stat(join(dir, "mage", ".obsidian", f))).isFile()).toBe(true);
    }
    const app = JSON.parse(await readFile(join(dir, "mage", ".obsidian", "app.json"), "utf8"));
    expect(app.useMarkdownLinks).toBe(true);

    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toContain("<!-- BEGIN mage -->");
    expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");

    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain("mage/**/artifacts/");
    expect(gi).toContain("mage/.mage/");
    // Safe-by-default: the cockpit is gitignored at init, not only on first --html.
    expect(gi).toContain("mage/dashboard.html");
  });

  it("refuses to re-init an already-initialized repo", async () => {
    const dir = await fresh();
    await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" });
    await expect(
      init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" }),
    ).rejects.toThrow(/already/);
  });
});

describe("mage init — detection-first + standalone hub (ADR-0012 §3)", () => {
  it("no-name -y inside a git repo → in-repo (detection)", async () => {
    const dir = await fresh();
    await gitInit(dir);
    const r = await init({ codeRepo: dir, yes: true });
    expect(r.mode).toBe("in-repo");
    expect(await exists(join(dir, "mage", "metadata.json"))).toBe(true);
  });

  it("no-name -y in a non-git dir → standalone hub in place (projects: [])", async () => {
    const dir = await fresh();
    const r = await init({ codeRepo: dir, yes: true });
    expect(r.mode).toBe("hub");
    expect(r.hubDir).toBe(dir);
    const meta = await readHubMetadata(dir);
    expect(meta?.projects).toEqual([]); // standalone: no first project
    expect(await exists(join(dir, "projects"))).toBe(true);
    expect(await exists(join(dir, "AGENTS.md"))).toBe(true);
    expect(await exists(join(dir, "mage", "metadata.json"))).toBe(false); // no code-repo metadata
  });

  it("a name/path → a hub at that location (like git init <path>)", async () => {
    const parent = await fresh();
    const hubPath = join(parent, "myhub");
    const r = await init({ codeRepo: parent, name: hubPath, yes: true });
    expect(r.mode).toBe("hub");
    expect(r.hubDir).toBe(hubPath);
    const meta = await readHubMetadata(hubPath);
    expect(meta?.name).toBe("myhub");
    expect(meta?.projects).toEqual([]);
  });

  it("--hub inside a git repo proceeds (nesting warns, never blocks)", async () => {
    const dir = await fresh();
    await gitInit(dir);
    const r = await init({ codeRepo: dir, mode: "hub", yes: true });
    expect(r.mode).toBe("hub");
    expect((await readHubMetadata(dir))?.projects).toEqual([]);
  });

  it("refuses to re-init an existing hub", async () => {
    const dir = await fresh();
    await init({ codeRepo: dir, yes: true }); // standalone hub
    await expect(init({ codeRepo: dir, yes: true })).rejects.toThrow(/already a mage hub/);
  });
});

describe("mage init — auto-connect (Decision 5)", () => {
  it("in-repo init auto-connects by default; --no-connect skips", async () => {
    const dir = await fresh();
    const r = await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" });
    expect(r.connectResult).toBeDefined();
    expect(await exists(join(dir, ".claude", "settings.local.json"))).toBe(true);

    const dir2 = await fresh();
    const skipped = await init({
      mode: "in-repo",
      yes: true,
      codeRepo: dir2,
      project: "demo",
      connect: false,
    });
    expect(skipped.connectResult).toBeUndefined();
    expect(await exists(join(dir2, ".claude", "settings.local.json"))).toBe(false);
  });

  it("hub init does NOT auto-connect (the hub is not a code repo)", async () => {
    const dir = await fresh();
    const r = await init({ codeRepo: dir, yes: true }); // standalone hub
    expect(r.mode).toBe("hub");
    expect(r.connectResult).toBeUndefined();
    expect(await exists(join(dir, ".claude", "settings.local.json"))).toBe(false);
  });

  it("auto-connect is best-effort: a malformed settings file does not fail init", async () => {
    const dir = await fresh();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.local.json"), "{ not valid json");
    // Must NOT throw — the KB is written, connect is skipped with a warning.
    const r = await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" });
    expect(r.connectResult).toBeUndefined();
    expect(await exists(join(dir, "mage", "metadata.json"))).toBe(true);
  });
});
