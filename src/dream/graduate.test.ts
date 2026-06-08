import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Note } from "../note.js";
import { parseNote } from "../note.js";
import { GEN_MARKER, TARGET_AGENT_DIRS } from "../skills-shared.js";
import { planGraduate, renderProcedureSkill } from "./graduate.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmpRepo(): Promise<{ repo: string; docsRoot: string }> {
  const repo = await mkdtemp(join(tmpdir(), "mage-graduate-"));
  made.push(repo);
  return { repo, docsRoot: join(repo, "mage") };
}

function playbookNote(): Note {
  return parseNote(
    [
      "---",
      "type: playbook",
      "tags: [billing/payments]",
      "updated: 2026-01-01",
      "keywords: [stripe, webhook, retry]",
      "---",
      "# Stripe webhook retries",
      "",
      "1. Verify the signature.",
      "2. Make the handler idempotent.",
    ].join("\n"),
  );
}

describe("renderProcedureSkill", () => {
  it("renders a SKILL.md carrying GEN_MARKER, mage-skill-<slug> name, description, wing, and a backing-note pointer", () => {
    const note = playbookNote();
    const md = renderProcedureSkill("stripe-webhook-retries", note, "billing", "notes/stripe.md");

    expect(md).toContain(GEN_MARKER);
    expect(md).toContain("name: mage-skill-stripe-webhook-retries");
    expect(md).toMatch(/^description: .+Load when/m);
    expect(md).toContain("wing: billing");
    expect(md).toContain("# Stripe webhook retries");
    // The procedure body is carried verbatim.
    expect(md).toContain("Make the handler idempotent.");
    // The backing note stays the substrate (ADR-0013 §1).
    expect(md).toContain("notes/stripe.md");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("THROWS for a non-procedural note type (interface/principle/etc — ADR-0019 §5)", () => {
    const fact = parseNote("---\ntype: interface\ntags: [billing/x]\n---\n# A fact\n");
    expect(() => renderProcedureSkill("a-fact", fact, "billing", "notes/x.md")).toThrow(/playbook\/gotcha/);
  });

  it("THROWS for a typeless note", () => {
    const untyped = parseNote("# No type\n\nbody\n");
    expect(() => renderProcedureSkill("no-type", untyped, "billing", "notes/y.md")).toThrow();
  });

  it("accepts a gotcha note (the other graduatable type)", () => {
    const gotcha = parseNote("---\ntype: gotcha\ntags: [a/b]\n---\n# A trap\n\nWatch out.\n");
    expect(() => renderProcedureSkill("a-trap", gotcha, "a", "notes/t.md")).not.toThrow();
  });
});

describe("planGraduate", () => {
  it("plans writes into BOTH target dirs + the note re-written with a graduated_skill pointer", async () => {
    const { repo, docsRoot } = await tmpRepo();
    const note = playbookNote();
    const relPath = "notes/stripe.md";

    const plan = await planGraduate(repo, docsRoot, relPath, note, "billing");

    expect(plan.action).toBe("graduate");
    expect(plan.removes).toEqual([]);
    expect(plan.archives).toEqual([]);

    // skillTargets = the two SKILL.md abs paths, one per target agent dir.
    const expectedSkillPaths = TARGET_AGENT_DIRS.map((b) =>
      join(repo, b, "mage-skill-stripe-webhook-retries", "SKILL.md"),
    );
    expect(plan.skillTargets.sort()).toEqual([...expectedSkillPaths].sort());

    // writes = both SKILL.md files + the re-written note.
    const writePaths = plan.writes.map((w) => w.path).sort();
    const expectedWrites = [...expectedSkillPaths, join(docsRoot, relPath)].sort();
    expect(writePaths).toEqual(expectedWrites);

    // The two skill writes carry identical generated content (GEN_MARKER + wing).
    const skillWrites = plan.writes.filter((w) => w.path.endsWith("SKILL.md"));
    expect(skillWrites).toHaveLength(2);
    for (const w of skillWrites) {
      expect(w.content).toContain(GEN_MARKER);
      expect(w.content).toContain("wing: billing");
      expect(w.content).toContain("name: mage-skill-stripe-webhook-retries");
    }

    // The note write adds the graduated_skill pointer and bumps `updated`; the body persists.
    const noteWrite = plan.writes.find((w) => w.path === join(docsRoot, relPath));
    expect(noteWrite).toBeDefined();
    const reparsed = parseNote(noteWrite?.content ?? "");
    expect(reparsed.frontmatter.graduated_skill).toBe("mage-skill-stripe-webhook-retries");
    expect(reparsed.frontmatter.type).toBe("playbook");
    expect(String(reparsed.frontmatter.updated)).not.toBe("2026-01-01");
    expect(reparsed.body).toContain("Make the handler idempotent.");
  });

  it("derives the slug from the note title via procedureSkillSlug (safe segment)", async () => {
    const { repo, docsRoot } = await tmpRepo();
    const note = parseNote("---\ntype: gotcha\ntags: [a/b]\n---\n# Weird/Title: With Stuff!\n\nbody\n");
    const plan = await planGraduate(repo, docsRoot, "notes/w.md", note, "a");
    // Slug must be filesystem-safe — no "/" or ":" leaking into a dir name.
    for (const t of plan.skillTargets) {
      expect(t).toContain("mage-skill-weird-title-with-stuff");
    }
  });
});
