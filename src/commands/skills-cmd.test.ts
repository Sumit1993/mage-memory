import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./init.js";
import { skills } from "./skills-cmd.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
  vi.restoreAllMocks();
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

/** Write a per-session `.learnings/<session>.jsonl` full stream from raw events. */
async function stream(
  dir: string,
  session: string,
  events: Array<Record<string, unknown>>,
): Promise<void> {
  const p = join(dir, "mage", ".learnings", `${session}.jsonl`);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** A session that loads a mage skill and then immediately ends (CLOSED via terminator). */
function closedLoadEvents(session: string, matched: boolean): Array<Record<string, unknown>> {
  return [
    { v: 1, ts: "2026-06-07T00:00:00.000Z", session, type: "session_start", harness: "x", cwd: "/r", repo_root: "/r", mage_version: "0.0.6", source: "startup" },
    {
      v: 1,
      ts: "2026-06-07T00:00:01.000Z",
      session,
      type: "skill_load",
      skill: "mage-wing-mage",
      args: null,
      match: { wing: "mage", keywords: ["rollup"], paths: [] },
      trigger_hash: "h1",
    },
    matched
      ? { v: 1, ts: "2026-06-07T00:00:02.000Z", session, type: "user_prompt", text: "fix the rollup fold" }
      : { v: 1, ts: "2026-06-07T00:00:02.000Z", session, type: "user_prompt", text: "nothing relevant here" },
    { v: 1, ts: "2026-06-07T00:00:03.000Z", session, type: "session_end", reason: "done" },
  ];
}

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

describe("mage skills --metrics (read-only)", () => {
  it("--metrics --quiet folds + writes the rollup and prints nothing", async () => {
    const dir = await vault();
    await stream(dir, "s1", closedLoadEvents("s1", true));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const r = await skills({ dir, metrics: true, quiet: true });

    expect(spy).not.toHaveBeenCalled();
    expect(r.metricsRows).toBeDefined();
    // The rollup file was written under <root>/.metrics/context-match.json.
    const rollupRaw = await readFile(join(dir, "mage", ".metrics", "context-match.json"), "utf8");
    const rollup = JSON.parse(rollupRaw) as { skills: Record<string, { loads: number; matches: number }> };
    const stat = rollup.skills["mage-wing-mage::h1"];
    expect(stat).toBeDefined();
    expect(stat?.loads).toBe(1);
    expect(stat?.matches).toBe(1);
  });

  it("--metrics prints a report", async () => {
    const dir = await vault();
    await stream(dir, "s1", closedLoadEvents("s1", true));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      lines.push(String(m));
    });

    const r = await skills({ dir, metrics: true });

    const out = lines.join("\n");
    expect(out).toContain("mage-wing-mage");
    expect(out.toLowerCase()).toContain("loads");
    expect(r.metricsRows?.length).toBe(1);
  });

  it("--metrics on a repo with no .learnings prints the empty-state line and does not throw", async () => {
    const dir = await vault();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      lines.push(String(m));
    });

    const r = await skills({ dir, metrics: true });

    expect(lines.join("\n")).toContain("No skill-load metrics yet.");
    expect(r.metricsRows).toEqual([]);
  });

  it("--metrics with no knowledge base prints the empty-state and does not throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mage-skills-nokb-"));
    made.push(dir);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      lines.push(String(m));
    });

    const r = await skills({ dir, metrics: true });

    expect(lines.join("\n")).toContain("No knowledge base found.");
    expect(r).toEqual({ repo: dir, wings: [], written: [], metricsRows: [] });
  });

  it("--metrics --json emits parseable JSON", async () => {
    const dir = await vault();
    await stream(dir, "s1", closedLoadEvents("s1", false));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      lines.push(String(m));
    });

    await skills({ dir, metrics: true, json: true });

    const parsed = JSON.parse(lines.join("\n")) as Array<{ skill: string; loads: number; matchRate: number }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.skill).toBe("mage-wing-mage");
    expect(parsed[0]?.loads).toBe(1);
    expect(parsed[0]?.matchRate).toBe(0);
  });

  it("metrics mode does not regenerate wing skills (read-only)", async () => {
    const dir = await vault();
    await note(dir, "a.md", "---\ntags: [alpha/x]\n---\n# A\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const r = await skills({ dir, metrics: true, quiet: true });

    expect(r.written).toEqual([]);
    // No wing skill should have been written in metrics mode.
    await expect(readFile(skillFile(dir, "alpha"), "utf8")).rejects.toThrow();
  });
});
