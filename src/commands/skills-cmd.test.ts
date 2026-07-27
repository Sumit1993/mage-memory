import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import { init } from "./init.js";
import { skills } from "./skills-cmd.js";

afterEach(() => {
  vi.restoreAllMocks();
});

async function vault(): Promise<string> {
  const dir = await tmpDir("mage-skills-");
  await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "t" });
  return dir;
}
async function note(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, "mage", "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
async function decision(
  dir: string,
  rel: string,
  content: string,
): Promise<void> {
  const p = join(dir, "mage", "decisions", rel);
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
  const p = join(dir, "mage", ".mage", "learnings", `${session}.jsonl`);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** A session that loads a mage skill and then immediately ends (CLOSED via terminator). */
function closedLoadEvents(
  session: string,
  matched: boolean,
): Array<Record<string, unknown>> {
  return [
    {
      v: 1,
      ts: "2026-06-07T00:00:00.000Z",
      session,
      type: "session_start",
      harness: "x",
      cwd: "/r",
      repo_root: "/r",
      mage_version: "0.0.6",
      source: "startup",
    },
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
      ? {
          v: 1,
          ts: "2026-06-07T00:00:02.000Z",
          session,
          type: "user_prompt",
          text: "fix the rollup fold",
        }
      : {
          v: 1,
          ts: "2026-06-07T00:00:02.000Z",
          session,
          type: "user_prompt",
          text: "nothing relevant here",
        },
    {
      v: 1,
      ts: "2026-06-07T00:00:03.000Z",
      session,
      type: "session_end",
      reason: "done",
    },
  ];
}

describe("mage skills", () => {
  it("generates one wing skill per wing", async () => {
    const dir = await vault();
    await note(dir, "a.md", "---\ntags: [alpha/x]\n---\n# A\n");
    const r = await skills({ dir });
    expect(r.wings).toEqual(["alpha"]);
    expect(await readFile(skillFile(dir, "alpha"), "utf8")).toContain(
      "# alpha",
    );
  });

  it("cross-lists a multi-homed note into every tagged wing's skill (ADR-0012 §5)", async () => {
    const dir = await vault();
    await note(
      dir,
      "rel.md",
      "---\ntype: relationship\ntags: [a/x, b/y]\n---\n# My Rel\n",
    );
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

  it("includes governing decisions (accepted, non-superseded) sorted and deduped in wing skill", async () => {
    const dir = await vault();
    // ADRs under mage/decisions
    await decision(
      dir,
      "0004-accepted-second.md",
      "---\ntype: decision\nstatus: accepted\n---\n# 0004 — Second Accepted Decision\n",
    );
    await decision(
      dir,
      "0001-accepted-first.md",
      "---\ntype: decision\nstatus: accepted\n---\n# 0001 — First Accepted Decision\n",
    );
    await decision(
      dir,
      "0002-proposed.md",
      "---\ntype: decision\nstatus: proposed\n---\n# 0002 — Proposed Decision\n",
    );
    await decision(
      dir,
      "0003-superseded.md",
      "---\ntype: decision\nstatus: superseded\n---\n# 0003 — Superseded Decision\n",
    );

    // Notes in wing alpha
    await note(
      dir,
      "n1.md",
      "---\ntags: [alpha/x]\n---\n# Note 1\nLink to [ADR 0004](../decisions/0004-accepted-second.md) and [ADR 0002](../decisions/0002-proposed.md).",
    );
    await note(
      dir,
      "n2.md",
      "---\ntags: [alpha/y]\n---\n# Note 2\nLink to [ADR 0001](../decisions/0001-accepted-first.md) and duplicate link to [ADR 0004](../decisions/0004-accepted-second.md) and [ADR 0003](../decisions/0003-superseded.md).",
    );
    await note(
      dir,
      "n3.md",
      "---\ntags: [alpha/z]\n---\n# Note 3\nNo ADR links here.",
    );

    // Note in wing beta with no ADR links
    await note(
      dir,
      "n4.md",
      "---\ntags: [beta/w]\n---\n# Note 4\nNo ADR links.",
    );

    await skills({ dir });

    const alphaSkill = await readFile(skillFile(dir, "alpha"), "utf8");
    expect(alphaSkill).toContain("## Governing decisions");
    expect(alphaSkill).toContain(
      "- [0001 — First Accepted Decision](mage/decisions/0001-accepted-first.md)",
    );
    expect(alphaSkill).toContain(
      "- [0004 — Second Accepted Decision](mage/decisions/0004-accepted-second.md)",
    );
    expect(alphaSkill).not.toContain("0002 — Proposed Decision");
    expect(alphaSkill).not.toContain("0003 — Superseded Decision");

    // Check numerical ordering (0001 appears before 0004)
    const pos0001 = alphaSkill.indexOf("0001 — First Accepted Decision");
    const pos0004 = alphaSkill.indexOf("0004 — Second Accepted Decision");
    expect(pos0001).toBeGreaterThan(-1);
    expect(pos0004).toBeGreaterThan(pos0001);

    // Check deduplication (0004 appears exactly once in the list)
    const matches0004 = alphaSkill.match(/0004 — Second Accepted Decision/g);
    expect(matches0004?.length).toBe(1);

    // Wing with zero governing ADRs gets no Governing decisions section
    const betaSkill = await readFile(skillFile(dir, "beta"), "utf8");
    expect(betaSkill).not.toContain("Governing decisions");
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
    // The rollup file was written under <root>/.mage/metrics/context-match.json.
    const rollupRaw = await readFile(
      join(dir, "mage", ".mage", "metrics", "context-match.json"),
      "utf8",
    );
    const rollup = JSON.parse(rollupRaw) as {
      skills: Record<string, { loads: number; matches: number }>;
    };
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
    const dir = await tmpDir("mage-skills-nokb-");
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

    const parsed = JSON.parse(lines.join("\n")) as Array<{
      skill: string;
      loads: number;
      matchRate: number;
    }>;
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
