import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HubProject } from "../paths.js";
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

// The on-disk metadata.json may carry the legacy v1 `storage: "in-repo"` alias,
// which readHubMetadata normalizes to "repo-owned" on read. Model that raw shape
// so a fixture can exercise the normalization path (the `schema: "mage.v1"` file
// written below is exactly where the legacy value is valid).
type RawHubProject = Omit<HubProject, "storage"> & { storage: HubProject["storage"] | "in-repo" };

/** A hub root (kind=hub): projects/ dir + a top-level metadata.json registry. */
async function hub(projects: RawHubProject[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-hub-"));
  made.push(dir);
  await mkdir(join(dir, "projects"), { recursive: true });
  const meta = { schema: "mage.v1", name: "myhub", created_at: "2026-06-03", projects };
  await writeFile(join(dir, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return dir;
}

/** Write a note at an arbitrary path under a docs root (hub-relative). */
async function put(root: string, relUnderRoot: string, content: string): Promise<void> {
  const p = join(root, relUnderRoot);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
const readIndex = (root: string) => readFile(join(root, "INDEX.md"), "utf8");

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

  it("cross-lists a multi-homed note under every tagged wing (per-wing room)", async () => {
    const dir = await vault();
    await note(dir, "rel.md", "---\ntype: relationship\ntags: [a/x, b/y]\n---\n# My Rel\n");
    const r = await index({ dir });
    expect(r.wings).toEqual(["a", "b"]);
    expect(r.noteCount).toBe(1); // counted once, listed twice
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("## a");
    expect(idx).toContain("## b");
    expect(idx).toContain("### x"); // room under primary wing a
    expect(idx).toContain("### y"); // room under secondary wing b
    expect((idx.match(/My Rel/g) ?? []).length).toBe(2); // appears in both wings
    expect(idx).not.toContain("## Cross-cutting"); // multi-homed ≠ cross-cutting
  });
});

describe("mage index — hub projects + registry (ADR-0011/0012)", () => {
  it("indexes hub-owned project notes and excludes their archive/", async () => {
    const root = await hub([
      { name: "engine", storage: "hub-owned", code_repo_path: "/code/engine", code_repo_url: "git@github.com:me/engine.git" },
    ]);
    await put(root, "projects/engine/notes/api.md", "---\ntags: [engine/api]\n---\n# Engine API\n");
    await put(root, "projects/engine/archive/old.md", "---\ntags: [engine/api]\n---\n# Old\n");
    const r = await index({ dir: root });
    expect(r.wings).toContain("engine");
    expect(r.noteCount).toBe(1); // archived note excluded
    const idx = await readIndex(root);
    expect(idx).toContain("Engine API");
    expect(idx).not.toContain("# Old");
  });

  it("decorates a wing that matches a registered project with its code-repo pointer", async () => {
    const root = await hub([
      { name: "engine", storage: "hub-owned", code_repo_path: "/code/engine", code_repo_url: "git@github.com:me/engine.git" },
    ]);
    await put(root, "projects/engine/notes/api.md", "---\ntags: [engine/api]\n---\n# Engine API\n");
    const idx = await (async () => {
      await index({ dir: root });
      return readIndex(root);
    })();
    expect(idx).toContain("git@github.com:me/engine.git"); // code-repo decoration
  });

  it("does not decorate when there is no registry (registry-enriched, never -dependent)", async () => {
    const dir = await vault(); // in-repo: no hub metadata
    await note(dir, "api.md", "---\ntags: [engine/api]\n---\n# Engine API\n");
    const r = await index({ dir });
    expect(r.wings).toEqual(["engine"]);
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).not.toContain("code repo:");
  });

  it("renders an in-repo member as a visible pointer, even with zero hub-owned notes", async () => {
    const root = await hub([
      { name: "web", storage: "in-repo", code_repo_path: "/code/web", code_repo_url: "git@github.com:me/web.git" },
    ]);
    const r = await index({ dir: root });
    expect(r.noteCount).toBe(0);
    const idx = await readIndex(root);
    expect(idx).toContain("Linked repositories");
    expect(idx).toContain("/code/web"); // pointer to where its notes live
    expect(idx).toContain("INDEX"); // → open its INDEX
  });

  it("is idempotent on a hub (re-run byte-identical; no self-ingestion)", async () => {
    const root = await hub([]);
    for (const w of ["a", "b", "c", "d", "e"]) {
      await put(root, `projects/p/notes/${w}.md`, `---\ntags: [${w}/r]\n---\n# ${w}\n`);
    }
    await index({ dir: root });
    const first = await readIndex(root);
    const r = await index({ dir: root });
    const second = await readIndex(root);
    expect(second).toBe(first);
    expect(r.hierarchical).toBe(true); // 5 wings
  });

  it("flips hierarchical when one note carries >4 distinct tag-wings", async () => {
    const dir = await vault();
    await note(dir, "wide.md", "---\ntags: [a/1, b/2, c/3, d/4, e/5]\n---\n# Wide\n");
    const r = await index({ dir });
    expect(r.wings.length).toBe(5);
    expect(r.hierarchical).toBe(true);
  });
});
