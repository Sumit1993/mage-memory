import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { init } from "./init.js";
import { skills } from "./skills-cmd.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function vault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-skills-"));
  made.push(dir);
  await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "t" });
  return dir;
}
async function note(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, "mage", "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
const skillFile = (dir: string, wing: string) =>
  join(dir, ".claude/skills", `mage-wing-${wing}`, "SKILL.md");

describe("mage skills", () => {
  it("generates one wing skill per wing", async () => {
    const dir = await vault();
    await note(dir, "a.md", "---\ntags: [alpha/x]\n---\n# A\n");
    const r = await skills({ dir });
    expect(r.wings).toEqual(["alpha"]);
    expect(await readFile(skillFile(dir, "alpha"), "utf8")).toContain("# alpha");
  });

  it("cross-lists a multi-homed note into every tagged wing's skill (ADR-0012 §5)", async () => {
    const dir = await vault();
    await note(dir, "rel.md", "---\ntype: relationship\ntags: [a/x, b/y]\n---\n# My Rel\n");
    const r = await skills({ dir });
    expect(r.wings).toEqual(["a", "b"]);
    expect(await readFile(skillFile(dir, "a"), "utf8")).toContain("My Rel");
    expect(await readFile(skillFile(dir, "b"), "utf8")).toContain("My Rel");
  });

  it("ignores untagged (cross-cutting) notes — no wing skill", async () => {
    const dir = await vault();
    await note(dir, "loose.md", "---\n---\n# Loose\n");
    const r = await skills({ dir });
    expect(r.wings).toEqual([]);
  });

  it("includes a recursively-scanned projects/ note's wing", async () => {
    const dir = await vault();
    const p = join(dir, "mage", "projects", "p", "notes", "n.md");
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, "---\ntags: [proj/r]\n---\n# N\n");
    const r = await skills({ dir });
    expect(r.wings).toContain("proj");
  });
});
