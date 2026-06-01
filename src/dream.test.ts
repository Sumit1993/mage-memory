import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { init } from "./commands/init.js";
import { analyzeDream } from "./dream.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function vault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-dream-"));
  made.push(dir);
  await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "t" });
  return dir;
}
async function note(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, "mage", "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
const root = (dir: string) => join(dir, "mage");
const FRESH = "2026-06-01";
const NOW = new Date("2026-06-10");

describe("mage dream (read-only health report)", () => {
  it("reports a clean KB when notes are linked, fresh, and consistent", async () => {
    const dir = await vault();
    await note(dir, "a.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# A\n\n## Relations\n- see_also [B](b.md)\n`);
    await note(dir, "b.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# B\n\n## Relations\n- see_also [A](a.md)\n`);
    const r = await analyzeDream(root(dir), { now: NOW, staleDays: 180 });
    expect(r.clean).toBe(true);
    expect(r.noteCount).toBe(2);
  });

  it("flags a note superseded by another but still status: active", async () => {
    const dir = await vault();
    await note(dir, "old.md", `---\ntags: [w/r]\nstatus: active\nlast_reviewed: "${FRESH}"\n---\n# Old\n\n## Relations\n- see_also [New](new.md)\n`);
    await note(dir, "new.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# New\n\n## Relations\n- supersedes [Old](old.md)\n`);
    const r = await analyzeDream(root(dir), { now: NOW });
    expect(r.supersededButActive.map((f) => f.note)).toContain("notes/old.md");
  });

  it("flags superseded_by declared on the note itself", async () => {
    const dir = await vault();
    await note(dir, "old.md", `---\ntags: [w/r]\nstatus: active\nlast_reviewed: "${FRESH}"\n---\n# Old\n\n## Relations\n- superseded_by [New](new.md)\n`);
    await note(dir, "new.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# New\n\n## Relations\n- see_also [Old](old.md)\n`);
    const r = await analyzeDream(root(dir), { now: NOW });
    expect(r.supersededButActive.map((f) => f.note)).toContain("notes/old.md");
  });

  it("does NOT flag partial supersession (revises / revised_by stay active by design)", async () => {
    const dir = await vault();
    await note(dir, "locks.md", `---\ntags: [w/r]\nstatus: active\nlast_reviewed: "${FRESH}"\n---\n# Locks\n\n## Relations\n- revised_by [ADR](adr.md)\n`);
    await note(dir, "adr.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# ADR\n\n## Relations\n- revises [Locks](locks.md)\n`);
    const r = await analyzeDream(root(dir), { now: NOW });
    expect(r.supersededButActive).toEqual([]);
  });

  it("flags a dangling relative link and ignores code-span example links", async () => {
    const dir = await vault();
    await note(dir, "a.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# A\nSee [gone](missing.md). Example: \`[x](x.md)\` is not a real link.\n\n## Relations\n- see_also [B](b.md)\n`);
    await note(dir, "b.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# B\n\n## Relations\n- see_also [A](a.md)\n`);
    const r = await analyzeDream(root(dir), { now: NOW });
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
    const r = await analyzeDream(root(dir), { now: NOW });
    expect(r.orphans.map((f) => f.note)).toContain("notes/lonely.md");
    expect(r.orphans.map((f) => f.note)).not.toContain("notes/a.md");
  });

  it("flags stale (old last_reviewed) and notes missing last_reviewed", async () => {
    const dir = await vault();
    await note(dir, "old.md", `---\ntags: [w/r]\nlast_reviewed: "2020-01-01"\n---\n# Old\n\n## Relations\n- see_also [Fresh](fresh.md)\n`);
    await note(dir, "fresh.md", `---\ntags: [w/r]\nlast_reviewed: "${FRESH}"\n---\n# Fresh\n\n## Relations\n- see_also [Old](old.md)\n`);
    await note(dir, "noreview.md", `---\ntags: [w/r]\n---\n# NoReview\n\n## Relations\n- see_also [Fresh](fresh.md)\n`);
    const r = await analyzeDream(root(dir), { now: NOW, staleDays: 180 });
    const staleNotes = r.stale.map((f) => f.note);
    expect(staleNotes).toContain("notes/old.md");
    expect(staleNotes).toContain("notes/noreview.md");
    expect(staleNotes).not.toContain("notes/fresh.md");
  });

  it("is deterministic — findings sorted by note path", async () => {
    const dir = await vault();
    await note(dir, "z.md", `---\ntags: [w/r]\n---\n# Z\n`);
    await note(dir, "a.md", `---\ntags: [w/r]\n---\n# A\n`);
    const r = await analyzeDream(root(dir), { now: NOW });
    const orphans = r.orphans.map((f) => f.note);
    expect(orphans).toEqual([...orphans].sort());
  });
});
