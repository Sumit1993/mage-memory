import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { triggerHash } from "./events.js";
import {
  isMageSkill,
  normalizeSkillName,
  snapshotSkillMatch,
} from "./skill-match.js";

async function mkTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mage-observe-skill-"));
}

/** Write a generated wing SKILL.md (name + description only — no tags/keywords). */
async function putWingSkill(repo: string, name: string, description: string): Promise<void> {
  const dir = join(repo, ".claude", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

/** Seed a real wing note so keyword derivation has a non-boilerplate source. */
async function putWingNote(repo: string, wing: string): Promise<void> {
  const dir = join(repo, "mage", "notes");
  await mkdir(dir, { recursive: true });
  await writeFile(join(repo, "mage", "metadata.json"), JSON.stringify({ schema: "mage.v1", mode: "in-repo" }));
  await writeFile(
    join(dir, "webhooks.md"),
    `---\ntype: gotcha\ntags: [${wing}/payments]\nkeywords: [webhook, idempotency, retry, stripe]\n---\n# Stripe webhooks\n`,
  );
}

describe("isMageSkill / normalizeSkillName (recognition incl. mage: namespace)", () => {
  it("recognizes generated wing + graduated skill prefixes", () => {
    expect(isMageSkill("mage-wing-mage")).toBe(true);
    expect(isMageSkill("mage-skill-x")).toBe(true);
  });

  it("recognizes mage's own plugin skills under the mage: namespace", () => {
    expect(isMageSkill("mage:learn")).toBe(true);
    expect(isMageSkill("mage:guide")).toBe(true);
  });

  it("classifies a foreign skill as not mage", () => {
    expect(isMageSkill("continuous-learning-v2")).toBe(false);
    expect(isMageSkill("some-other-skill")).toBe(false);
  });

  it("strips the mage: namespace prefix when normalizing the skill id", () => {
    expect(normalizeSkillName("mage:learn")).toBe("learn");
    expect(normalizeSkillName("mage-wing-mage")).toBe("mage-wing-mage");
  });
});

describe("snapshotSkillMatch — wing/keywords sourced correctly (ADR-0016 §1)", () => {
  it("derives wing from the skill NAME (not frontmatter) and keywords from the wing's NOTES", async () => {
    const repo = await mkTmp();
    await putWingNote(repo, "mage");
    await putWingSkill(repo, "mage-wing-mage", "Knowledge for the mage wing. Load when working on mage.");

    const snap = await snapshotSkillMatch(repo, "mage-wing-mage");
    expect(snap).not.toBeNull();
    // wing comes from the skill name, never the (empty) tags frontmatter.
    expect(snap?.match.wing).toBe("mage");
    // keywords come from the real wing notes — NOT boilerplate scaffold words.
    expect(snap?.match.keywords).toContain("webhook");
    expect(snap?.match.keywords).not.toContain("playbooks");
    // paths reserved empty in 0.0.5.
    expect(snap?.match.paths).toEqual([]);
    // trigger_hash is a stable hash of the description.
    expect(snap?.trigger_hash).toBe(
      triggerHash("Knowledge for the mage wing. Load when working on mage."),
    );
  });

  it("returns null when the SKILL.md is missing (caller records skill-only)", async () => {
    const repo = await mkTmp();
    expect(await snapshotSkillMatch(repo, "mage-wing-ghost")).toBeNull();
  });

  it("sanitizes a malicious skill name so it cannot escape the skills dir", async () => {
    const repo = await mkTmp();
    // A traversal in the name must not resolve to a file outside skills/.
    expect(await snapshotSkillMatch(repo, "mage-wing-../../../etc")).toBeNull();
  });

  it("still derives a wing for a wing skill even when the wing has no notes (empty keywords, non-empty wing)", async () => {
    const repo = await mkTmp();
    await writeFile(
      join(await ensureMage(repo), "metadata.json"),
      JSON.stringify({ schema: "mage.v1", mode: "in-repo" }),
    );
    await putWingSkill(repo, "mage-wing-lonely", "A wing with no notes yet.");
    const snap = await snapshotSkillMatch(repo, "mage-wing-lonely");
    expect(snap?.match.wing).toBe("lonely");
    expect(snap?.match.keywords).toEqual([]);
  });
});

async function ensureMage(repo: string): Promise<string> {
  const dir = join(repo, "mage");
  await mkdir(dir, { recursive: true });
  return dir;
}
