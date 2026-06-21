import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDream } from "./dream.js";
import type { HubMetadata, HubProject } from "./paths.js";
import { withKb } from "../test/fixtures/kb.js";

/** A built, resolved in-repo KB; returns its docs root (the `mage/` dir). */
async function vault(): Promise<string> {
  const kb = await withKb({ kind: "repo" });
  return kb.root;
}
async function note(root: string, rel: string, content: string): Promise<void> {
  const p = join(root, "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
/** Write a note at an arbitrary path under the docs root (e.g. projects/...). */
async function putRaw(root: string, relUnderRoot: string, content: string): Promise<void> {
  const p = join(root, relUnderRoot);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
const FRESH = "2026-06-01";
const NOW = new Date("2026-06-10");

describe("mage dream (read-only health report)", () => {
  it("reports a clean KB when notes are linked, fresh, and consistent", async () => {
    const dir = await vault();
    await note(dir, "a.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# A\n\n## Relations\n- see_also [B](b.md)\n`);
    await note(dir, "b.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# B\n\n## Relations\n- see_also [A](a.md)\n`);
    const r = await analyzeDream(dir, { now: NOW, staleDays: 180 });
    expect(r.clean).toBe(true);
    expect(r.noteCount).toBe(2);
  });

  it("flags a note superseded by another but still status: active", async () => {
    const dir = await vault();
    await note(dir, "old.md", `---\ntags: [w/r]\nstatus: active\nlast_reviewed: "${FRESH}"\n---\n# Old\n\n## Relations\n- see_also [New](new.md)\n`);
    await note(dir, "new.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# New\n\n## Relations\n- supersedes [Old](old.md)\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.supersededButActive.map((f) => f.note)).toContain("notes/old.md");
  });

  it("flags superseded_by declared on the note itself", async () => {
    const dir = await vault();
    await note(dir, "old.md", `---\ntags: [w/r]\nstatus: active\nlast_reviewed: "${FRESH}"\n---\n# Old\n\n## Relations\n- superseded_by [New](new.md)\n`);
    await note(dir, "new.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# New\n\n## Relations\n- see_also [Old](old.md)\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.supersededButActive.map((f) => f.note)).toContain("notes/old.md");
  });

  it("does NOT flag partial supersession (revises / revised_by stay active by design)", async () => {
    const dir = await vault();
    await note(dir, "locks.md", `---\ntags: [w/r]\nstatus: active\nlast_reviewed: "${FRESH}"\n---\n# Locks\n\n## Relations\n- revised_by [ADR](adr.md)\n`);
    await note(dir, "adr.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# ADR\n\n## Relations\n- revises [Locks](locks.md)\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.supersededButActive).toEqual([]);
  });

  it("flags a dangling relative link and ignores code-span example links", async () => {
    const dir = await vault();
    await note(dir, "a.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# A\nSee [gone](missing.md). Example: \`[x](x.md)\` is not a real link.\n\n## Relations\n- see_also [B](b.md)\n`);
    await note(dir, "b.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# B\n\n## Relations\n- see_also [A](a.md)\n`);
    const r = await analyzeDream(dir, { now: NOW });
    const dangling = r.danglingLinks.filter((f) => f.note === "notes/a.md");
    expect(dangling.length).toBe(1);
    expect(dangling[0]?.detail).toContain("missing.md");
    expect(r.danglingLinks.some((f) => f.detail.includes("x.md"))).toBe(false);
  });

  it("flags an orphan note (no links in or out)", async () => {
    const dir = await vault();
    await note(dir, "a.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# A\n\n## Relations\n- see_also [B](b.md)\n`);
    await note(dir, "b.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# B\n\n## Relations\n- see_also [A](a.md)\n`);
    await note(dir, "lonely.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# Lonely\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.orphans.map((f) => f.note)).toContain("notes/lonely.md");
    expect(r.orphans.map((f) => f.note)).not.toContain("notes/a.md");
  });

  it("flags stale (old last_reviewed) and notes missing last_reviewed", async () => {
    const dir = await vault();
    await note(dir, "old.md", `---\ntags: [w/r]\nlast_reviewed: "2020-01-01"\n---\n# Old\n\n## Relations\n- see_also [Fresh](fresh.md)\n`);
    await note(dir, "fresh.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# Fresh\n\n## Relations\n- see_also [Old](old.md)\n`);
    await note(dir, "noreview.md", `---\ntags: [w/r]\n---\n# NoReview\n\n## Relations\n- see_also [Fresh](fresh.md)\n`);
    const r = await analyzeDream(dir, { now: NOW, staleDays: 180 });
    const staleNotes = r.stale.map((f) => f.note);
    expect(staleNotes).toContain("notes/old.md");
    expect(staleNotes).toContain("notes/noreview.md");
    expect(staleNotes).not.toContain("notes/fresh.md");
  });

  it("is deterministic — findings sorted by note path", async () => {
    const dir = await vault();
    await note(dir, "z.md", `---\ntags: [w/r]\n---\n# Z\n`);
    await note(dir, "a.md", `---\ntags: [w/r]\n---\n# A\n`);
    const r = await analyzeDream(dir, { now: NOW });
    const orphans = r.orphans.map((f) => f.note);
    expect(orphans).toEqual([...orphans].sort());
  });

  // ADR-0011 §2 propagated the recursive scan here; ADR-0012 §5 multi-home must
  // never make dream double-count a note (it works by relPath, not by wing).
  it("counts a projects/ note exactly once (recursion, no duplication)", async () => {
    const dir = await vault();
    await putRaw(dir, "projects/p/notes/n.md", `---\ntags: [eng/api]\nlast_reviewed: "${FRESH}"\n---\n# N\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.noteCount).toBe(1);
  });

  it("counts a multi-homed note once and yields at most one orphan finding", async () => {
    const dir = await vault();
    await note(dir, "multi.md", `---\ntags: [a/x, b/y]\nlast_reviewed: "${FRESH}"\n---\n# Multi\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.noteCount).toBe(1);
    expect(r.orphans.filter((f) => f.note === "notes/multi.md")).toHaveLength(1);
  });
});

describe("mage dream — info-tier drift signals (never failures)", () => {
  async function hubFixture(): Promise<string> {
    const kb = await withKb({ kind: "hub" });
    return kb.root;
  }
  async function writeAt(rootDir: string, rel: string, content: string): Promise<void> {
    const p = join(rootDir, rel);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, content);
  }
  const project = (name: string, storage: HubProject["storage"]): HubProject => ({
    name,
    storage,
    code_repo_path: "/code",
    code_repo_url: "/code",
  });
  const hubMeta = (projects: HubProject[]): HubMetadata => ({
    schema: "mage.v1",
    name: "h",
    created_at: "2026-06-03",
    projects,
  });

  it("flags a registered hub-owned project with 0 indexed notes (info)", async () => {
    const dir = await hubFixture();
    await mkdir(join(dir, "projects", "p1"), { recursive: true }); // empty
    const r = await analyzeDream(dir, { now: NOW, hubMeta: hubMeta([project("p1", "hub-owned")]) });
    expect(r.emptyProjects).toContain("p1");
  });

  it("does not flag a hub-owned project that has notes", async () => {
    const dir = await hubFixture();
    await writeAt(dir, "projects/p1/notes/n.md", `---\ntags: [p1/x]\nlast_reviewed: "${FRESH}"\n---\n# N\n`);
    const r = await analyzeDream(dir, { now: NOW, hubMeta: hubMeta([project("p1", "hub-owned")]) });
    expect(r.emptyProjects).not.toContain("p1");
  });

  it("flags a projects/ dir not in the registry (info)", async () => {
    const dir = await hubFixture();
    await mkdir(join(dir, "projects", "ghost"), { recursive: true });
    const r = await analyzeDream(dir, { now: NOW, hubMeta: hubMeta([]) });
    expect(r.unregisteredProjectDirs).toContain("ghost");
  });

  it("info drift never flips clean", async () => {
    const dir = await hubFixture();
    await mkdir(join(dir, "projects", "p1"), { recursive: true });
    const r = await analyzeDream(dir, { now: NOW, hubMeta: hubMeta([project("p1", "hub-owned")]) });
    expect(r.clean).toBe(true); // 0 notes, no rot
    expect(r.emptyProjects).toContain("p1"); // …yet the info signal still fires
  });

  it("an in-repo base (no registry) reports no project drift", async () => {
    const dir = await vault();
    await note(dir, "a.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# A\n`);
    const r = await analyzeDream(dir, { now: NOW });
    expect(r.emptyProjects).toEqual([]);
    expect(r.unregisteredProjectDirs).toEqual([]);
  });

  it("nudges when a base is mostly untagged, and stays quiet when tagged (ADR-0012 §7)", async () => {
    const untaggedHub = await hubFixture();
    for (let i = 0; i < 6; i++) {
      await writeAt(untaggedHub, `notes/u${i}.md`, `---\nlast_reviewed: "${FRESH}"\n---\n# U${i}\n`);
    }
    const r1 = await analyzeDream(untaggedHub, { now: NOW });
    expect(r1.untaggedNudge.length).toBeGreaterThan(0);
    expect(r1.untaggedNudge[0]).toMatch(/consider/i);

    const taggedHub = await hubFixture();
    for (let i = 0; i < 6; i++) {
      await writeAt(taggedHub, `notes/t${i}.md`, `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# T${i}\n`);
    }
    const r2 = await analyzeDream(taggedHub, { now: NOW });
    expect(r2.untaggedNudge).toEqual([]);
  });
});
