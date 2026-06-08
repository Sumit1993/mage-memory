import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseNote, writeNote } from "../note.js";
import { planMerge } from "./merge.js";

// ─── tmp fixture plumbing (house pattern; the executor is a read-only planner) ──

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A docs root with notes/ under it. Returns the docs-root abs path. */
async function docsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mage-merge-"));
  made.push(root);
  await mkdir(join(root, "notes"), { recursive: true });
  return root;
}

const TODAY = new Date().toISOString().slice(0, 10);

// ─── planMerge ─────────────────────────────────────────────────────────────────

describe("planMerge — fold a lesson into an existing note (prefer-update)", () => {
  it("appends a dated Update section, unions keywords, bumps stamps, ONE write", async () => {
    const root = await docsRoot();
    const rel = "notes/topic.md";
    await writeNote(
      join(root, rel),
      {
        type: "playbook",
        tags: ["pay/webhooks"],
        updated: "2026-06-01",
        last_reviewed: "2026-06-01",
        keywords: ["webhook", "retry"],
      },
      "# Topic\n\nOriginal body.\n",
    );

    const plan = await planMerge(root, {
      note: rel,
      addition: "Also handle idempotency keys.",
      keywords: ["retry", "idempotency"],
    });

    expect(plan.action).toBe("merge");
    expect(plan.writes).toHaveLength(1);
    expect(plan.archives).toEqual([]);
    expect(plan.removes).toEqual([]);
    expect(plan.skillTargets).toEqual([]);
    expect(plan.writes[0]?.path).toBe(join(root, rel));

    const parsed = parseNote(plan.writes[0]!.content);
    // Update section dated by the note's PRIOR `updated`; addition under it.
    expect(parsed.body).toContain("## Update (2026-06-01)");
    expect(parsed.body).toContain("Also handle idempotency keys.");
    expect(parsed.body).toContain("Original body.");
    // Keywords unioned, order-preserving, deduped.
    expect(parsed.frontmatter.keywords).toEqual(["webhook", "retry", "idempotency"]);
    // Stamps bumped to today.
    expect(parsed.frontmatter.updated).toBe(TODAY);
    expect(parsed.frontmatter.last_reviewed).toBe(TODAY);
    // Untouched frontmatter preserved.
    expect(parsed.frontmatter.type).toBe("playbook");
  });

  it("preserves existing keywords when payload has none", async () => {
    const root = await docsRoot();
    const rel = "notes/k.md";
    await writeNote(join(root, rel), { keywords: ["a", "b"], updated: "2026-06-02" }, "# K\n\nBody.\n");
    const plan = await planMerge(root, { note: rel, addition: "more" });
    const parsed = parseNote(plan.writes[0]!.content);
    expect(parsed.frontmatter.keywords).toEqual(["a", "b"]);
  });

  it("dates the section by today when the note has no prior `updated`", async () => {
    const root = await docsRoot();
    const rel = "notes/fresh.md";
    await writeNote(join(root, rel), { type: "note" }, "# Fresh\n\nBody.\n");
    const plan = await planMerge(root, { note: rel, addition: "lesson" });
    const parsed = parseNote(plan.writes[0]!.content);
    expect(parsed.body).toContain(`## Update (${TODAY})`);
  });

  it("THROWS when the note is missing", async () => {
    const root = await docsRoot();
    await expect(planMerge(root, { note: "notes/nope.md", addition: "x" })).rejects.toThrow(/not found/);
  });
});
