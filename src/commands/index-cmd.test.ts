import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { index } from "./index-cmd.js";
import { init } from "./init.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function vault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-idx-"));
  made.push(dir);
  await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "t" });
  return dir;
}

async function note(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, "mage", "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}

describe("mage index", () => {
  it("produces a flat index grouped by wing, with a cross-cutting section", async () => {
    const dir = await vault();
    await note(dir, "billing/pay.md", "---\ntype: interface\ntags: [billing/payments]\n---\n# Pay\n");
    await note(dir, "overview.md", "---\ntype: topology\n---\n# Overview\n");
    const r = await index({ dir });
    expect(r.hierarchical).toBe(false);
    expect(r.wings).toEqual(["billing"]);
    expect(r.noteCount).toBe(2);
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("## billing");
    expect(idx).toContain("## Cross-cutting");
    expect(idx).toContain("[Pay](notes/billing/pay.md)");
  });

  it("is idempotent (re-run = byte-identical)", async () => {
    const dir = await vault();
    await note(dir, "a.md", "---\ntags: [x/y]\n---\n# A\n");
    await index({ dir });
    const first = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    await index({ dir });
    const second = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(second).toBe(first);
  });

  it("goes hierarchical past the wing threshold and writes per-wing files", async () => {
    const dir = await vault();
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(dir, `${w}.md`, `---\ntags: [${w}/r]\n---\n# ${w}\n`);
    }
    const r = await index({ dir });
    expect(r.hierarchical).toBe(true);
    expect(r.wings.length).toBe(5);
    const root = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(root).toContain("## Wings");
    expect(root).toContain("[_index.a.md](_index.a.md)");
    expect(await readFile(join(dir, "mage", "_index.a.md"), "utf8")).toContain("# a");
  });

  it("cleans up stale per-wing index files when dropping back to flat", async () => {
    const dir = await vault();
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(dir, `${w}.md`, `---\ntags: [${w}/r]\n---\n# ${w}\n`);
    }
    await index({ dir });
    for (const w of ["b", "c", "d", "e"]) await rm(join(dir, "mage", "notes", `${w}.md`));
    const r = await index({ dir });
    expect(r.hierarchical).toBe(false);
    await expect(readFile(join(dir, "mage", "_index.b.md"), "utf8")).rejects.toThrow();
  });

  it("throws when there is no knowledge base", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mage-none-"));
    made.push(dir);
    await expect(index({ dir })).rejects.toThrow(/No mage knowledge base/);
  });

  it("stays flat at exactly the thresholds and flips just past them", async () => {
    const wingVault = async (wings: string[]) => {
      const d = await vault();
      for (const w of wings) await note(d, `${w}.md`, `---\ntags: [${w}/r]\n---\n# ${w}\n`);
      return (await index({ dir: d })).hierarchical;
    };
    const noteVault = async (n: number) => {
      const d = await vault();
      for (let i = 0; i < n; i++) await note(d, `n${i}.md`, `---\ntags: [one/r]\n---\n# n${i}\n`);
      return (await index({ dir: d })).hierarchical;
    };
    expect(await wingVault(["a", "b", "c", "d"])).toBe(false); // exactly 4 wings → flat
    expect(await wingVault(["a", "b", "c", "d", "e"])).toBe(true); // 5 wings → hierarchical
    expect(await noteVault(20)).toBe(false); // exactly 20 notes → flat
    expect(await noteVault(21)).toBe(true); // 21 notes → hierarchical
  });

  it("percent-encodes special characters in note link destinations", async () => {
    const dir = await vault();
    await note(dir, "weird (v2) #1.md", "---\ntags: [x/y]\n---\n# Weird\n");
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("(notes/weird%20%28v2%29%20%231.md)");
    expect(idx).not.toContain("(notes/weird (v2) #1.md)");
  });

  it("treats _index.*.md as a reserved generated name (excluded everywhere)", async () => {
    // ADR-0011 §2: the recursive walk now visits the docs root, where generated
    // `_index.<wing>.md` live — so the `_index.*.md` namespace is reserved for
    // mage's own output and never indexed as a user note.
    const dir = await vault();
    await note(dir, "_index.architecture.md", "---\ntags: [sys/arch]\n---\n# Architecture\n");
    await note(dir, "real.md", "---\ntags: [sys/arch]\n---\n# Real\n");
    const r = await index({ dir });
    expect(r.noteCount).toBe(1); // only real.md; the _index.* file is reserved
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).not.toContain("Architecture");
    expect(idx).toContain("Real");
  });

  it("reclassifies an unsafe wing tag to cross-cutting (no traversal filename)", async () => {
    const dir = await vault();
    await note(dir, "evil.md", "---\ntags: [../escape/x]\n---\n# Evil\n");
    const r = await index({ dir });
    expect(r.wings).toEqual([]); // ".." wing rejected
    expect(r.noteCount).toBe(1); // still indexed, as cross-cutting
  });
});
