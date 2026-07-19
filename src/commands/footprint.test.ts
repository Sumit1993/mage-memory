import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import { init } from "./init.js";
import { footprint } from "./footprint.js";
import { AUTO_MEMORY_MAX_BYTES } from "../adapters/claude-code/constants.js";

afterEach(() => {
  vi.restoreAllMocks();
});

async function vault(): Promise<string> {
  const dir = await tmpDir("mage-footprint-");
  await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "t" });
  return dir;
}

async function createSurfaceDocs(dir: string, rel: string, bytes: number) {
  const p = join(dir, "mage", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, Buffer.alloc(bytes, "x"));
}

async function createSurfaceRepo(dir: string, rel: string, bytes: number) {
  const p = join(dir, rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, Buffer.alloc(bytes, "x"));
}

describe("mage footprint", () => {
  it("no KB found -> graceful result, footprint: null, no throw", async () => {
    const dir = await tmpDir("mage-footprint-nokb-");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    const r = await footprint({ cwd: dir });
    
    expect(r.footprint).toBeNull();
    expect(lines.join("\n")).toContain("No knowledge base found.");
  });

  it("--json emits parseable JSON and does NOT print the table", async () => {
    const dir = await vault();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    const r = await footprint({ cwd: dir, json: true });
    
    expect(r.footprint).toBeDefined();
    const out = lines.join("\n");
    expect(() => JSON.parse(out)).not.toThrow();
    const parsed = JSON.parse(out);
    expect(parsed.budget).toBeDefined();
    expect(out).not.toContain("Context footprint");
  });

  it("--quiet renders nothing but still returns the result", async () => {
    const dir = await vault();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    const r = await footprint({ cwd: dir, quiet: true });
    
    expect(spy).not.toHaveBeenCalled();
    expect(r.footprint).not.toBeNull();
  });

  it("the capped surface is the only row showing % of cap", async () => {
    const dir = await vault();
    await createSurfaceDocs(dir, "MEMORY.md", 1000);
    await createSurfaceRepo(dir, "AGENTS.md", 2000);
    
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    await footprint({ cwd: dir });
    
    const out = lines.join("\n");
    expect(out).toMatch(/MEMORY\.md.*% of cap\s+<-\scapped/);
    expect(out).not.toMatch(/AGENTS\.md.*% of cap/);
  });

  it("a large AGENTS.md does NOT change the budget percentage", async () => {
    const dir = await vault();
    await createSurfaceDocs(dir, "MEMORY.md", 1000);
    const r1 = await footprint({ cwd: dir, quiet: true });
    const ratio1 = r1.footprint?.budget.ratio;

    await createSurfaceRepo(dir, "AGENTS.md", 10000);
    const r2 = await footprint({ cwd: dir, quiet: true });
    const ratio2 = r2.footprint?.budget.ratio;

    expect(ratio1).toBe(ratio2);
    expect(ratio1).toBeGreaterThan(0);
  });

  it("warn state renders the state word and a remedy line", async () => {
    const dir = await vault();
    await createSurfaceDocs(dir, "MEMORY.md", Math.floor(AUTO_MEMORY_MAX_BYTES * 0.75));
    
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    await footprint({ cwd: dir });
    const out = lines.join("\n");
    expect(out).toContain("warn");
    expect(out).toContain("run `mage index` to regenerate, or `mage doctor`");
  });

  it("breach state renders the state word and a remedy line", async () => {
    const dir = await vault();
    await createSurfaceDocs(dir, "MEMORY.md", Math.floor(AUTO_MEMORY_MAX_BYTES * 0.95));
    
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    await footprint({ cwd: dir });
    const out = lines.join("\n");
    expect(out).toContain("breach");
    expect(out).toContain("run `mage index` to regenerate, or `mage doctor`");
  });

  it("sufficientData: false renders 'insufficient data' and no zero counts", async () => {
    const dir = await vault();
    
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    await footprint({ cwd: dir });
    const out = lines.join("\n");
    
    expect(out).toContain("insufficient data");
    expect(out).toMatch(/insufficient data - 0 sessions recorded/);
    expect(out).not.toContain("0 notes read");
  });

  it("pointer section renders the word CEILING, the unmeasurable share, and the dead count", async () => {
    const dir = await vault();
    const p = join(dir, "mage", "notes", "test.md");
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, "---\nsources:\n  - http://example.com\n  - doesntexist.md\n---\n# Test\n");
    
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    await footprint({ cwd: dir });
    const out = lines.join("\n");
    
    expect(out).toContain("CEILING");
    expect(out).toMatch(/are URLs or opaque refs/);
    expect(out).toMatch(/dead pointers/);
  });

  it("an on-follow surface IS rendered, below the total, and is NOT counted in it (ADR-0039 §4)", async () => {
    const dir = await vault();
    // The wing index is the largest file mage generates; §4 says measured and SHOWN,
    // but excluded from the launch total. Omitting the row entirely hid it.
    await createSurfaceDocs(dir, "_index.foo.md", 13_157);

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });

    await footprint({ cwd: dir });
    const out = lines.join("\n");

    expect(out).toContain("_index.foo.md");
    expect(out).toContain("on-follow");
    expect(out).toContain("13,157 B");

    // It must appear AFTER the total line, and the total must not include its bytes.
    const totalIdx = out.indexOf("total");
    const wingIdx = out.indexOf("_index.foo.md");
    expect(totalIdx).toBeGreaterThan(-1);
    expect(wingIdx).toBeGreaterThan(totalIdx);

    const totalLine = out.split("\n").find((l) => l.includes("total"));
    const totalBytes = Number(totalLine?.match(/([\d,]+) B/)?.[1]?.replace(/,/g, ""));
    expect(Number.isFinite(totalBytes)).toBe(true);
    expect(totalBytes).toBeLessThan(13_157);
  });

  it("the string 'saved' appears nowhere in rendered output", async () => {
    const dir = await vault();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    
    await footprint({ cwd: dir });
    const out = lines.join("\n");
    
    expect(out.toLowerCase()).not.toContain("saved");
  });
});
