import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proposal } from "../grooming/types.js";
import { GEN_MARKER, SKILL_PREFIX, TARGET_AGENT_DIRS } from "../skills-shared.js";
import { applyProposal } from "./applier.js";

// ─── tmp fixture plumbing (house pattern) ────────────────────────────────────────

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

interface Fixture {
  repo: string;
  docsRoot: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "mage-applier-"));
  made.push(root);
  const repo = join(root, "repo");
  const docsRoot = join(repo, "mage");
  await mkdir(join(docsRoot, "notes"), { recursive: true });
  return { repo, docsRoot };
}

/** Plant a note at <docsRoot>/<relPath>. */
async function plantNote(docsRoot: string, relPath: string, content: string): Promise<string> {
  const abs = join(docsRoot, relPath);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf8");
  return abs;
}

/** Plant a SKILL.md for `name` into one or both target dirs, marker on by default. */
async function plantSkill(
  repo: string,
  name: string,
  opts: { dirs?: string[]; marker?: boolean; description?: string } = {},
): Promise<string[]> {
  const dirs = opts.dirs ?? TARGET_AGENT_DIRS;
  const marker = opts.marker ?? true;
  const desc = opts.description ?? "x";
  const written: string[] = [];
  for (const base of dirs) {
    await mkdir(join(repo, base, name), { recursive: true });
    const file = join(repo, base, name, "SKILL.md");
    const body = `---\nname: ${name}\ndescription: ${desc}\nwing: pay\n---\n\n${marker ? GEN_MARKER : ""}\n\n# ${name}\n\nbody\n`;
    await writeFile(file, body, "utf8");
    written.push(file);
  }
  return written;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const PLAYBOOK = [
  "---",
  "type: playbook",
  "tags: [pay/webhooks]",
  "updated: 2026-01-01",
  "keywords: [stripe, webhook]",
  "---",
  "# Stripe webhook retries",
  "",
  "1. Verify the signature.",
  "2. Make the handler idempotent.",
  "",
].join("\n");

// ─── THE CEILINGS (table) ─────────────────────────────────────────────────────────

describe("applyProposal — THE CEILINGS (refuse before any write)", () => {
  it("refuses a `note` action (note creation is the learn pipeline)", async () => {
    const { repo, docsRoot } = await fixture();
    const proposal: Proposal = { action: "note", target: "sig::key", payload: {}, evidence: "x" };
    const result = await applyProposal(docsRoot, repo, proposal);

    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/learn pipeline/);
    expect(result.written).toEqual([]);
    expect(result.archived).toEqual([]);
  });

  it("refuses a merge whose write carries a LIVE SECRET (Gate-2) — nothing written", async () => {
    const { repo, docsRoot } = await fixture();
    const noteAbs = await plantNote(
      docsRoot,
      "notes/topic.md",
      "---\ntype: insight\ntags: [pay/x]\nupdated: 2026-01-01\n---\n# Topic\n\nbody\n",
    );
    const before = await readFile(noteAbs, "utf8");

    const proposal: Proposal = {
      action: "merge",
      target: "notes/topic.md",
      payload: {
        note: "notes/topic.md",
        // A real-shaped AWS access key id — hasLiveSecret() must fire on this.
        addition: "Found a creds leak: AKIAIOSFODNN7EXAMPLE in the config.",
      },
      evidence: "x",
    };
    const result = await applyProposal(docsRoot, repo, proposal);

    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/Gate-2|secret/i);
    expect(result.written).toEqual([]);
    // The note on disk is byte-identical — nothing was written past the block.
    expect(await readFile(noteAbs, "utf8")).toBe(before);
  });

  it("refuses graduate when a skillTarget EXISTS WITHOUT GEN_MARKER (bespoke guard)", async () => {
    const { repo, docsRoot } = await fixture();
    await plantNote(docsRoot, "notes/stripe.md", PLAYBOOK);
    // A hand-authored (no-marker) skill already sits at the graduate target path.
    const name = `${SKILL_PREFIX}stripe-webhook-retries`;
    const bespoke = await plantSkill(repo, name, { dirs: [TARGET_AGENT_DIRS[0]!], marker: false });
    const before = await readFile(bespoke[0]!, "utf8");

    const proposal: Proposal = {
      action: "graduate",
      target: "notes/stripe.md",
      payload: {},
      evidence: "x",
    };
    const result = await applyProposal(docsRoot, repo, proposal);

    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/bespoke|GEN_MARKER/i);
    expect(result.written).toEqual([]);
    // The bespoke skill is untouched.
    expect(await readFile(bespoke[0]!, "utf8")).toBe(before);
  });

  it("refuses reword when the target skill is bespoke (no GEN_MARKER)", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}foo`;
    const planted = await plantSkill(repo, name, { marker: false });
    const before = await readFile(planted[0]!, "utf8");

    const proposal: Proposal = {
      action: "reword",
      target: name,
      payload: { skill: name, description: "Load when X happens." },
      evidence: "x",
    };
    const result = await applyProposal(docsRoot, repo, proposal);

    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/bespoke|GEN_MARKER/i);
    expect(await readFile(planted[0]!, "utf8")).toBe(before);
  });

  it("refuses demote when the SKILL.md is bespoke (no GEN_MARKER) — dirs NOT removed", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}bar`;
    const planted = await plantSkill(repo, name, { marker: false });

    const proposal: Proposal = { action: "demote", target: name, payload: {}, evidence: "x" };
    const result = await applyProposal(docsRoot, repo, proposal);

    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/bespoke|GEN_MARKER/i);
    // The skill dirs still exist — nothing was removed or archived.
    expect(await exists(planted[0]!)).toBe(true);
    expect(await exists(join(docsRoot, "archive", "skills", name, "SKILL.md"))).toBe(false);
  });

  it("removes-safety: refuses demote when a removes dir has NO SKILL.md but holds a hand-authored file (never hard-delete unverified content)", async () => {
    const { repo, docsRoot } = await fixture();
    const name = `${SKILL_PREFIX}foo`;
    // A genuine mage skill in .claude/skills…
    await plantSkill(repo, name, { dirs: [TARGET_AGENT_DIRS[0]!], marker: true });
    // …but .agents/skills/<name> holds a hand-authored file and NO SKILL.md.
    const preciousDir = join(repo, TARGET_AGENT_DIRS[1]!, name);
    await mkdir(preciousDir, { recursive: true });
    const precious = join(preciousDir, "PRECIOUS_USER_FILE.md");
    await writeFile(precious, "hand-authored — must never be hard-deleted\n", "utf8");

    const result = await applyProposal(docsRoot, repo, {
      action: "demote",
      target: name,
      payload: {},
      evidence: "x",
    });

    // The dir can't be proven mage-owned (no GEN_MARKER SKILL.md) → refuse outright.
    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/removes-safety/i);
    // Nothing was deleted or archived — the precious file and both dirs survive.
    expect(await exists(precious)).toBe(true);
    expect(await exists(join(repo, TARGET_AGENT_DIRS[0]!, name, "SKILL.md"))).toBe(true);
    expect(await exists(join(docsRoot, "archive", "skills", name, "SKILL.md"))).toBe(false);
  });

  it("removes-safety: a real demote only ever rm's dirs UNDER the skills trees", async () => {
    const { repo, docsRoot } = await fixture();
    // A note adjacent to the skill — it must NEVER be reachable by a removes path.
    const noteAbs = await plantNote(docsRoot, "notes/keep.md", PLAYBOOK);
    const name = `${SKILL_PREFIX}stripe-webhook-retries`;
    await plantSkill(repo, name);

    const result = await applyProposal(docsRoot, repo, {
      action: "demote",
      target: name,
      payload: {},
      evidence: "x",
    });
    expect(result.ok).toBe(true);
    // Only the two skill dirs were removed; the note survives (never in removes).
    for (const b of TARGET_AGENT_DIRS) expect(await exists(join(repo, b, name))).toBe(false);
    expect(await exists(noteAbs)).toBe(true);
  });
});

// ─── graduate → demote round-trip ─────────────────────────────────────────────────

describe("applyProposal — graduate → demote round-trip", () => {
  it("graduates a playbook note (both dirs, GEN_MARKER, wing:) then demotes it (archived, dirs removed, note intact)", async () => {
    const { repo, docsRoot } = await fixture();
    const noteAbs = await plantNote(docsRoot, "notes/stripe.md", PLAYBOOK);

    // ── graduate ──
    const grad = await applyProposal(docsRoot, repo, {
      action: "graduate",
      target: "notes/stripe.md",
      payload: {},
      evidence: "x",
    });
    expect(grad.ok).toBe(true);
    expect(grad.refused).toBeNull();

    const name = `${SKILL_PREFIX}stripe-webhook-retries`;
    const skillPaths = TARGET_AGENT_DIRS.map((b) => join(repo, b, name, "SKILL.md"));
    for (const p of skillPaths) {
      expect(await exists(p)).toBe(true);
      const md = await readFile(p, "utf8");
      expect(md).toContain(GEN_MARKER);
      expect(md).toContain("wing: pay");
      expect(md).toContain(`name: ${name}`);
    }
    // The note got the graduated_skill pointer and survives.
    const noteAfter = await readFile(noteAbs, "utf8");
    expect(noteAfter).toContain(`graduated_skill: ${name}`);
    expect(noteAfter).toContain("Make the handler idempotent.");

    // ── demote ──
    const dem = await applyProposal(docsRoot, repo, {
      action: "demote",
      target: name,
      payload: {},
      evidence: "x",
    });
    expect(dem.ok).toBe(true);
    expect(dem.refused).toBeNull();

    // Both skill dirs are gone.
    for (const b of TARGET_AGENT_DIRS) {
      expect(await exists(join(repo, b, name))).toBe(false);
    }
    // Exactly one archived copy lives under <docsRoot>/archive/skills/<name>/.
    expect(await exists(join(docsRoot, "archive", "skills", name, "SKILL.md"))).toBe(true);
    // The backing NOTE is NEVER deleted (knowledge persists — ADR-0013 §1).
    expect(await exists(noteAbs)).toBe(true);
    expect(await readFile(noteAbs, "utf8")).toContain("Make the handler idempotent.");
  });

  it("NO note file is ever rm'd across the round-trip (the note path is never in removes)", async () => {
    const { repo, docsRoot } = await fixture();
    const noteAbs = await plantNote(docsRoot, "notes/stripe.md", PLAYBOOK);
    await applyProposal(docsRoot, repo, {
      action: "graduate",
      target: "notes/stripe.md",
      payload: {},
      evidence: "x",
    });
    const name = `${SKILL_PREFIX}stripe-webhook-retries`;
    await applyProposal(docsRoot, repo, { action: "demote", target: name, payload: {}, evidence: "x" });
    // The note is still on disk after a full graduate→demote cycle.
    expect(await exists(noteAbs)).toBe(true);
  });
});

// ─── planner-throw refusals (missing note / not-a-skill) ─────────────────────────

describe("applyProposal — fail-closed on a planner throw", () => {
  it("refuses graduate when the target note is missing", async () => {
    const { repo, docsRoot } = await fixture();
    const result = await applyProposal(docsRoot, repo, {
      action: "graduate",
      target: "notes/ghost.md",
      payload: {},
      evidence: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.refused).not.toBeNull();
    expect(result.written).toEqual([]);
  });

  it("refuses demote of a non-mage-skill name", async () => {
    const { repo, docsRoot } = await fixture();
    const result = await applyProposal(docsRoot, repo, {
      action: "demote",
      target: "mage-wing-pay",
      payload: {},
      evidence: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.refused).not.toBeNull();
  });

  it("refuses reword when the skill is not found in any dir", async () => {
    const { repo, docsRoot } = await fixture();
    const result = await applyProposal(docsRoot, repo, {
      action: "reword",
      target: `${SKILL_PREFIX}nope`,
      payload: { skill: `${SKILL_PREFIX}nope`, description: "Load when…" },
      evidence: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.refused).not.toBeNull();
  });
});
