import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNote, writeNote } from "../note.js";
import { tmpDir } from "../../test/fixtures/kb.js";
import { type SplitNewNote, planSplit } from "./split.js";

// ─── tmp fixture plumbing (house pattern; the executor is a read-only planner) ──

async function docsRoot(): Promise<string> {
  const root = await tmpDir("mage-split-");
  await mkdir(join(root, "notes"), { recursive: true });
  return root;
}

const TODAY = new Date().toISOString().slice(0, 10);

const child = (over: Partial<SplitNewNote> = {}): SplitNewNote => ({
  relPath: "notes/child-a.md",
  type: "gotcha",
  tags: ["pay/webhooks"],
  title: "Child A",
  body: "Carved-out content.",
  ...over,
});

// ─── planSplit ─────────────────────────────────────────────────────────────────

describe("planSplit — original persists trimmed + new notes carved out", () => {
  it("writes [original, ...new], links original to each new note's relPath", async () => {
    const root = await docsRoot();
    const rel = "notes/big.md";
    await writeNote(
      join(root, rel),
      { type: "playbook", tags: ["pay/webhooks"], created: "2026-05-01", updated: "2026-05-01" },
      "# Big\n\nOriginal kept material.\n\nLots more removed.\n",
    );

    const a = child({ relPath: "notes/child-a.md", title: "Child A" });
    const b = child({ relPath: "notes/child-b.md", title: "Child B", body: "# Child B\n\nPre-titled body." });

    const plan = await planSplit(root, {
      note: rel,
      keepBody: "# Big\n\nOriginal kept material.",
      into: [a, b],
    });

    expect(plan.action).toBe("split");
    expect(plan.archives).toEqual([]);
    expect(plan.removes).toEqual([]);
    expect(plan.skillTargets).toEqual([]);
    // writes = [child-a, child-b, original] — children FIRST, shrunk original LAST
    // so a mid-plan child-write failure leaves the full original intact.
    expect(plan.writes.map((w) => w.path)).toEqual([
      join(root, "notes/child-a.md"),
      join(root, "notes/child-b.md"),
      join(root, rel),
    ]);

    // Trimmed original keeps frontmatter (created preserved), bumps updated.
    const orig = parseNote(plan.writes[2]!.content);
    expect(orig.frontmatter.created).toBe("2026-05-01");
    expect(orig.frontmatter.updated).toBe(TODAY);
    expect(orig.frontmatter.last_reviewed).toBe(TODAY);
    expect(orig.body).toContain("Original kept material.");
    // Relation-bullet links to each new note's relPath (locked format).
    expect(orig.body).toContain("- relates_to [Child A](notes/child-a.md)");
    expect(orig.body).toContain("- relates_to [Child B](notes/child-b.md)");
    // The removed material is gone from the trimmed original.
    expect(orig.body).not.toContain("Lots more removed.");

    // New note A: fresh frontmatter, H1 prepended from title.
    const na = parseNote(plan.writes[0]!.content);
    expect(na.frontmatter.type).toBe("gotcha");
    expect(na.frontmatter.tags).toEqual(["pay/webhooks"]);
    expect(na.frontmatter.created).toBe(TODAY);
    expect(na.body).toContain("# Child A");
    expect(na.body).toContain("Carved-out content.");

    // New note B: already had its H1, not double-prefixed.
    const nb = parseNote(plan.writes[1]!.content);
    expect(nb.body.match(/# Child B/g)).toHaveLength(1);
  });

  it("THROWS when `into` is empty", async () => {
    const root = await docsRoot();
    const rel = "notes/x.md";
    await writeNote(join(root, rel), { type: "note" }, "# X\n\nBody.\n");
    await expect(planSplit(root, { note: rel, keepBody: "# X", into: [] })).rejects.toThrow(/zero notes/);
  });

  it("THROWS when the original note is missing", async () => {
    const root = await docsRoot();
    await expect(
      planSplit(root, { note: "notes/ghost.md", keepBody: "# G", into: [child()] }),
    ).rejects.toThrow(/not found/);
  });

  it("the original is in writes (persisted, trimmed) — never in removes/archives", async () => {
    const root = await docsRoot();
    const rel = "notes/keep.md";
    await writeNote(join(root, rel), { type: "note" }, "# Keep\n\nBody.\n");
    const plan = await planSplit(root, { note: rel, keepBody: "# Keep", into: [child()] });
    expect(plan.writes.some((w) => w.path === join(root, rel))).toBe(true);
    expect(plan.removes).toEqual([]);
    expect(plan.archives).toEqual([]);
  });
});
