import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proposal } from "../grooming/types.js";
import { readNote } from "../note.js";
import { GEN_MARKER, SKILL_PREFIX, TARGET_AGENT_DIRS } from "../skills-shared.js";
import { applyProposal } from "./applier.js";
import { planDemote } from "./demote.js";

// ─── tmp fixture plumbing (house pattern; the executor is a read-only planner) ──

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

interface Fixture {
  repo: string;
  docsRoot: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "mage-demote-"));
  made.push(root);
  const repo = join(root, "repo");
  const docsRoot = join(repo, "mage");
  await mkdir(docsRoot, { recursive: true });
  return { repo, docsRoot };
}

/** Write a generated SKILL.md for `name` into one or both target dirs. */
async function plantSkill(
  repo: string,
  name: string,
  opts: { dirs?: string[]; marker?: boolean } = {},
): Promise<string[]> {
  const dirs = opts.dirs ?? TARGET_AGENT_DIRS;
  const marker = opts.marker ?? true;
  const written: string[] = [];
  for (const base of dirs) {
    const file = join(repo, base, name, "SKILL.md");
    await mkdir(join(repo, base, name), { recursive: true });
    const body = `---\nname: ${name}\ndescription: x\nwing: pay\n---\n\n${marker ? GEN_MARKER : ""}\n\n# ${name}\n`;
    await writeFile(file, body);
    written.push(file);
  }
  return written;
}

// ─── planDemote ────────────────────────────────────────────────────────────────

describe("planDemote — unwind a graduated skill; note persists", () => {
  it("archives ONE copy, removes BOTH dirs, lists both SKILL.md as skillTargets", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}foo`;
    await plantSkill(repo, name);

    const plan = await planDemote(repo, docsRoot, name);

    expect(plan.action).toBe("demote");
    // No writes — knowledge (the backing note) is never rewritten/deleted here.
    expect(plan.writes).toEqual([]);

    // ONE archive (rename-move) into <docsRoot>/archive/skills/<name>/SKILL.md.
    expect(plan.archives).toHaveLength(1);
    expect(plan.archives[0]?.to).toBe(join(docsRoot, "archive", "skills", name, "SKILL.md"));
    expect(plan.archives[0]?.from).toBe(join(repo, TARGET_AGENT_DIRS[0]!, name, "SKILL.md"));

    // BOTH skill dirs in removes (under .claude/skills + .agents/skills only).
    expect(plan.removes).toEqual(TARGET_AGENT_DIRS.map((b) => join(repo, b, name)));
    // Every removes path is a skill dir under one of the two trees.
    for (const r of plan.removes) {
      expect(r.includes(join(repo, ".claude", "skills")) || r.includes(join(repo, ".agents", "skills"))).toBe(true);
    }

    // skillTargets = both SKILL.md paths (the applier GEN_MARKER-guards each).
    expect(plan.skillTargets).toEqual(
      TARGET_AGENT_DIRS.map((b) => join(repo, b, name, "SKILL.md")),
    );
  });

  it("archives the first existing copy when the skill lives in only one dir", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}solo`;
    // Plant ONLY in .agents/skills (the second target dir).
    await plantSkill(repo, name, { dirs: [TARGET_AGENT_DIRS[1]!] });

    const plan = await planDemote(repo, docsRoot, name);
    expect(plan.archives).toHaveLength(1);
    expect(plan.archives[0]?.from).toBe(join(repo, TARGET_AGENT_DIRS[1]!, name, "SKILL.md"));
    // removes still lists BOTH dirs (the applier rm -rf force-tolerates the absent one).
    expect(plan.removes).toEqual(TARGET_AGENT_DIRS.map((b) => join(repo, b, name)));
  });

  it("THROWS when the skill name is not mage-skill-*", async () => {
    const { repo, docsRoot } = await fixture();
    await expect(planDemote(repo, docsRoot, "mage-wing-pay")).rejects.toThrow(/not a graduated/);
    await expect(planDemote(repo, docsRoot, "bespoke-thing")).rejects.toThrow(/not a graduated/);
  });

  it("THROWS on a traversal-shaped skill name", async () => {
    const { repo, docsRoot } = await fixture();
    await expect(planDemote(repo, docsRoot, `${SKILL_PREFIX}../escape`)).rejects.toThrow();
  });

  it("THROWS when no SKILL.md exists on disk", async () => {
    const { repo, docsRoot } = await fixture();
    await expect(planDemote(repo, docsRoot, `${SKILL_PREFIX}ghost`)).rejects.toThrow(/no SKILL\.md/);
  });

  it("never lists a note path in removes (only skill dirs)", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}note-safe`;
    await plantSkill(repo, name);
    const plan = await planDemote(repo, docsRoot, name);
    for (const r of plan.removes) {
      expect(r).not.toContain(`${join(repo, "mage", "notes")}`);
    }
  });
});

// ─── graduate → demote round-trip (the dangling-pointer fix) ─────────────────────

describe("planDemote — un-points the backing note (no dangling graduated_skill)", () => {
  const PLAYBOOK = [
    "---",
    "type: playbook",
    "tags: [pay/webhooks]",
    "updated: 2026-01-01",
    "keywords: [stripe, webhook, retry]",
    "---",
    "# Stripe webhook retries",
    "",
    "1. Verify the signature.",
    "2. Make the handler idempotent.",
  ].join("\n");

  it("a graduate→demote round-trip leaves the backing note present with NO graduated_skill", async () => {
    const { repo, docsRoot } = await fixture();
    const relPath = "notes/stripe.md";
    await mkdir(join(docsRoot, "notes"), { recursive: true });
    await writeFile(join(docsRoot, relPath), PLAYBOOK, "utf8");

    // Graduate: writes the SKILL.md (both dirs) + the note with a graduated_skill pointer.
    const graduate: Proposal = { action: "graduate", target: relPath, payload: {}, evidence: "" };
    const gradResult = await applyProposal(docsRoot, repo, graduate);
    expect(gradResult.ok).toBe(true);

    const graduated = await readNote(join(docsRoot, relPath));
    expect(graduated.frontmatter.graduated_skill).toBe(`${SKILL_PREFIX}stripe-webhook-retries`);

    // Demote: archives the skill, removes the dirs, AND un-points the backing note.
    const demote: Proposal = {
      action: "demote",
      target: `${SKILL_PREFIX}stripe-webhook-retries`,
      payload: {},
      evidence: "",
    };
    const demoteResult = await applyProposal(docsRoot, repo, demote);
    expect(demoteResult.ok).toBe(true);

    // The backing note still exists (knowledge is never deleted) and is un-pointed.
    const unpointed = await readNote(join(docsRoot, relPath));
    expect("graduated_skill" in unpointed.frontmatter).toBe(false);
    // The procedure body persists untouched.
    expect(unpointed.body).toContain("Make the handler idempotent.");
  });

  it("plans a note un-point write when the SKILL.md carries a backing-note pointer", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}pointed`;
    const relPath = "notes/pointed.md";
    await mkdir(join(docsRoot, "notes"), { recursive: true });
    await writeFile(
      join(docsRoot, relPath),
      `---\ntype: playbook\ntags: [pay/x]\ngraduated_skill: ${name}\n---\n# Pointed\n\nbody\n`,
      "utf8",
    );
    // Plant a SKILL.md whose body carries the exact graduate.ts pointer line.
    const dir = join(repo, TARGET_AGENT_DIRS[0]!, name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: x\nwing: pay\n---\n\n${GEN_MARKER}\n\n# Pointed\n\nbody\n\n## Backing note\n\nThis skill graduated from \`${relPath}\` — the note stays the substrate (ADR-0013 §1).\n`,
      "utf8",
    );

    const plan = await planDemote(repo, docsRoot, name);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.path).toBe(join(docsRoot, relPath));
    expect(plan.writes[0]?.content).not.toContain("graduated_skill");
  });
});
