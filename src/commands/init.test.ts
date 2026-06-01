import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METADATA_SCHEMA } from "../paths.js";
import { init } from "./init.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function fresh(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mage-init-"));
  made.push(d);
  return d;
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
    expect(gi).toContain("mage/.learnings/");
  });

  it("refuses to re-init an already-initialized repo", async () => {
    const dir = await fresh();
    await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" });
    await expect(
      init({ mode: "in-repo", yes: true, codeRepo: dir, project: "demo" }),
    ).rejects.toThrow(/already/);
  });
});
