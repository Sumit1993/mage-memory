import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../../../test/fixtures/kb.js";
import { claudeHome, discoverMemoryDirs, recoverCwd } from "./projects.js";

/** Lay down a `~/.claude/projects/<slug>/` with memory files + an optional transcript. */
async function project(
  home: string,
  slug: string,
  memories: Record<string, string>,
  transcript?: { name: string; lines: unknown[] },
): Promise<string> {
  const projectDir = join(home, "projects", slug);
  const memDir = join(projectDir, "memory");
  await mkdir(memDir, { recursive: true });
  for (const [name, body] of Object.entries(memories)) {
    await writeFile(join(memDir, name), body);
  }
  if (transcript) {
    await writeFile(
      join(projectDir, transcript.name),
      `${transcript.lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    );
  }
  return projectDir;
}

describe("claudeHome", () => {
  it("honors CLAUDE_CONFIG_DIR, else falls back to ~/.claude", () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: "/custom/cc" })).toBe("/custom/cc");
    expect(claudeHome({})).toMatch(/[/\\]\.claude$/);
    expect(claudeHome({ CLAUDE_CONFIG_DIR: "" })).toMatch(/[/\\]\.claude$/);
  });
});

describe("recoverCwd", () => {
  it("recovers the true origin cwd from a transcript, NOT the lossy slug", async () => {
    const home = await tmpDir("cc-home");
    // The slug encodes the org root, but the session actually ran in a subdir —
    // exactly the real-world lossy case adopt must not be fooled by.
    const dir = await project(
      home,
      "-home-sumit-prismalens-org",
      { "a.md": "# A\n" },
      { name: "s1.jsonl", lines: [{ type: "summary" }, { cwd: "/home/sumit/prismalens-org/prismalens-agents" }] },
    );
    expect(await recoverCwd(dir)).toBe("/home/sumit/prismalens-org/prismalens-agents");
  });

  it("returns null when no transcript carries a cwd", async () => {
    const home = await tmpDir("cc-home");
    const dir = await project(home, "-slug", { "a.md": "# A\n" }, { name: "s.jsonl", lines: [{ type: "x" }] });
    expect(await recoverCwd(dir)).toBeNull();
  });

  it("returns null when there is no transcript at all", async () => {
    const home = await tmpDir("cc-home");
    const dir = await project(home, "-slug", { "a.md": "# A\n" });
    expect(await recoverCwd(dir)).toBeNull();
  });
});

describe("discoverMemoryDirs", () => {
  it("enumerates memory dirs, excludes generated twins, recovers cwd", async () => {
    const home = await tmpDir("cc-home");
    await project(
      home,
      "-home-sumit-app",
      { "lesson.md": "# Lesson\n", "MEMORY.md": "# index\n", "INDEX.md": "# index\n" },
      { name: "s.jsonl", lines: [{ cwd: "/home/sumit/app" }] },
    );
    const dirs = await discoverMemoryDirs({ home });
    expect(dirs).toHaveLength(1);
    expect(dirs[0]?.cwd).toBe("/home/sumit/app");
    // Generated MEMORY.md/INDEX.md are not adoptable captures.
    expect(dirs[0]?.files.map((f) => f.split("/").pop())).toEqual(["lesson.md"]);
  });

  it("skips dirs with no memory files and returns [] when projects/ is absent", async () => {
    const home = await tmpDir("cc-home");
    await mkdir(join(home, "projects", "-empty", "memory"), { recursive: true });
    expect(await discoverMemoryDirs({ home })).toEqual([]);
    expect(await discoverMemoryDirs({ home: join(home, "does-not-exist") })).toEqual([]);
  });

  it("discovers multiple dirs sorted by slug", async () => {
    const home = await tmpDir("cc-home");
    await project(home, "-b", { "x.md": "# X\n" }, { name: "s.jsonl", lines: [{ cwd: "/b" }] });
    await project(home, "-a", { "y.md": "# Y\n" }, { name: "s.jsonl", lines: [{ cwd: "/a" }] });
    const dirs = await discoverMemoryDirs({ home });
    expect(dirs.map((d) => d.slug)).toEqual(["-a", "-b"]);
  });
});
