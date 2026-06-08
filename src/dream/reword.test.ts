import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseNote } from "../note.js";
import { GEN_MARKER, TARGET_AGENT_DIRS } from "../skills-shared.js";
import { planReword } from "./reword.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmpRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "mage-reword-"));
  made.push(repo);
  return repo;
}

function skillMd(name: string, description: string, wing = "billing"): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `wing: ${wing}`,
    "---",
    "",
    GEN_MARKER,
    "",
    `# ${name}`,
    "",
    "The procedure body must stay byte-identical across a reword.",
    "",
  ].join("\n");
}

/** Plant a SKILL.md under one or more of the target agent dirs. */
async function putSkill(
  repo: string,
  name: string,
  content: string,
  dirs: readonly string[] = TARGET_AGENT_DIRS,
): Promise<string[]> {
  const paths: string[] = [];
  for (const base of dirs) {
    const dir = join(repo, base, name);
    await mkdir(dir, { recursive: true });
    const p = join(dir, "SKILL.md");
    await writeFile(p, content);
    paths.push(p);
  }
  return paths;
}

describe("planReword", () => {
  it("rewrites ONLY the description line, keeping name/wing/GEN_MARKER/body intact, in every dir it exists", async () => {
    const repo = await tmpRepo();
    await putSkill(repo, "mage-skill-foo", skillMd("mage-skill-foo", "OLD trigger. Load when old."));

    const plan = await planReword(repo, {
      skill: "mage-skill-foo",
      description: "NEW trigger. Load when new situation arises.",
    });

    expect(plan.action).toBe("reword");
    expect(plan.removes).toEqual([]);
    expect(plan.archives).toEqual([]);
    expect(plan.writes).toHaveLength(TARGET_AGENT_DIRS.length);
    expect(plan.skillTargets).toEqual(plan.writes.map((w) => w.path));

    for (const w of plan.writes) {
      expect(w.content).toContain("description: NEW trigger. Load when new situation arises.");
      expect(w.content).not.toContain("OLD trigger");
      // Everything else is preserved.
      expect(w.content).toContain("name: mage-skill-foo");
      expect(w.content).toContain("wing: billing");
      expect(w.content).toContain(GEN_MARKER);
      expect(w.content).toContain("The procedure body must stay byte-identical across a reword.");
    }
  });

  it("plans writes only for the dirs the skill actually exists in", async () => {
    const repo = await tmpRepo();
    // Only the first target dir has the skill.
    await putSkill(repo, "mage-skill-solo", skillMd("mage-skill-solo", "old"), [TARGET_AGENT_DIRS[0]]);

    const plan = await planReword(repo, { skill: "mage-skill-solo", description: "fresh" });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.path).toContain(TARGET_AGENT_DIRS[0]);
  });

  it("THROWS when the skill is found in no target dir", async () => {
    const repo = await tmpRepo();
    await expect(planReword(repo, { skill: "mage-skill-ghost", description: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("THROWS when the SKILL.md has no description key (nothing to reword)", async () => {
    const repo = await tmpRepo();
    const noDesc = ["---", "name: mage-skill-nd", "wing: a", "---", "", GEN_MARKER, "", "# x", ""].join("\n");
    await putSkill(repo, "mage-skill-nd", noDesc, [TARGET_AGENT_DIRS[0]]);
    await expect(planReword(repo, { skill: "mage-skill-nd", description: "y" })).rejects.toThrow(
      /description/,
    );
  });

  it("a YAML-injection payload in description cannot inject extra frontmatter keys", async () => {
    const repo = await tmpRepo();
    await putSkill(
      repo,
      "mage-skill-foo",
      skillMd("mage-skill-foo", "OLD trigger. Load when old."),
      [TARGET_AGENT_DIRS[0]],
    );

    // A crafted description with newlines + a colon trying to inject name/wing/malicious.
    const payload = "Load when X\nname: mage-wing-HIJACK\nwing: x\nmalicious: true";
    const plan = await planReword(repo, { skill: "mage-skill-foo", description: payload });

    const { frontmatter } = parseNote(plan.writes[0]!.content);
    // Exactly ONE name — the original mage-skill-*, NOT the injected mage-wing-HIJACK.
    expect(frontmatter.name).toBe("mage-skill-foo");
    // The original single wing survives; the injected `wing: x` did not take.
    expect(frontmatter.wing).toBe("billing");
    // No injected key leaked into frontmatter.
    expect("malicious" in frontmatter).toBe(false);
    // description parses back as the ONE literal multi-line string.
    expect(frontmatter.description).toBe(payload);
  });

  it("collapses a folded multi-line description into a single line", async () => {
    const repo = await tmpRepo();
    const folded = [
      "---",
      "name: mage-skill-fold",
      "description: >-",
      "  a long folded",
      "  trigger across lines",
      "wing: a",
      "---",
      "",
      GEN_MARKER,
      "",
      "# x",
      "",
      "body",
      "",
    ].join("\n");
    await putSkill(repo, "mage-skill-fold", folded, [TARGET_AGENT_DIRS[0]]);

    const plan = await planReword(repo, { skill: "mage-skill-fold", description: "one liner now" });
    const content = plan.writes[0]?.content ?? "";
    expect(content).toContain("description: one liner now");
    expect(content).not.toContain("a long folded");
    expect(content).not.toContain("trigger across lines");
    // The non-description frontmatter keys survive.
    expect(content).toContain("wing: a");
    expect(content).toContain("name: mage-skill-fold");
    expect(content).toContain("body");
  });
});
