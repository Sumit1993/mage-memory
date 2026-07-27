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

  it("harvests from memory-genre sources ONLY — ADR-to-ADR Relations links do not govern", async () => {
    const dir = await vault();
    await decision(
      dir,
      "0001-linked-by-memory.md",
      "---\ntype: decision\nstatus: accepted\ntags: [alpha/x]\n---\n# 0001 — Linked By Memory\n",
    );
    // An accepted ADR reachable ONLY from another decision note's Relations list.
    await decision(
      dir,
      "0002-linked-by-adr-only.md",
      "---\ntype: decision\nstatus: accepted\ntags: [alpha/x]\n---\n# 0002 — Linked By ADR Only\n",
    );
    // The decision note that links it — a wing-tagged note, but NOT a harvest source.
    await decision(
      dir,
      "0003-relations-hub.md",
      "---\ntype: decision\nstatus: accepted\ntags: [alpha/x]\n---\n# 0003 — Relations Hub\n\n## Relations\n\n- builds_on [ADR 0002](0002-linked-by-adr-only.md)\n",
    );
    // Work- and doc-genre notes are not harvest sources either.
    await note(
      dir,
      "plan.md",
      "---\ntype: plan\ntags: [alpha/x]\n---\n# Plan\nLink to [ADR 0002](../decisions/0002-linked-by-adr-only.md).",
    );
    await note(
      dir,
      "spec.md",
      "---\ntype: spec\ntags: [alpha/x]\n---\n# Spec\nLink to [ADR 0002](../decisions/0002-linked-by-adr-only.md).",
    );
    // The one memory-genre note — the only legitimate harvest source.
    await note(
      dir,
      "mem.md",
      "---\ntype: gotcha\ntags: [alpha/x]\n---\n# Memory\nLink to [ADR 0001](../decisions/0001-linked-by-memory.md).",
    );

    await skills({ dir });
    const alpha = await readFile(skillFile(dir, "alpha"), "utf8");

    expect(alpha).toContain("0001 — Linked By Memory");
    expect(alpha).not.toContain("0002 — Linked By ADR Only");
    expect(alpha).not.toContain("0003 — Relations Hub");
  });

  it("a fully cross-linked ADR corpus does not become the wing's governing list", async () => {
    // Reproduces the shipped regression at scale: 38 wing-tagged ADRs, each
    // linking its neighbours from `## Relations`. Only the ADRs a MEMORY note
    // links may govern — here, three.
    const dir = await vault();
    for (let i = 1; i <= 38; i++) {
      const num = String(i).padStart(4, "0");
      const prev = String(Math.max(1, i - 1)).padStart(4, "0");
      const next = String(Math.min(38, i + 1)).padStart(4, "0");
      await decision(
        dir,
        `${num}-adr.md`,
        `---\ntype: decision\nstatus: accepted\ntags: [alpha/x]\n---\n# ${num} — Decision ${i}\n\n## Relations\n\n- builds_on [prev](${prev}-adr.md)\n- companion [next](${next}-adr.md)\n`,
      );
    }
    await note(
      dir,
      "mem.md",
      "---\ntype: gotcha\ntags: [alpha/x]\n---\n# Memory\nSee [a](../decisions/0005-adr.md), [b](../decisions/0011-adr.md), [c](../decisions/0030-adr.md).",
    );

    await skills({ dir });
    const alpha = await readFile(skillFile(dir, "alpha"), "utf8");

    const govLines = alpha
      .split("\n")
      .filter((l) => /^- \[\d{4} — Decision \d+\]\(/.test(l));
    expect(govLines.length).toBe(3);
    expect(alpha).not.toContain("more in decisions/");
    expect(alpha).toContain("0005 — Decision 5]");
    expect(alpha).toContain("0011 — Decision 11]");
    expect(alpha).toContain("0030 — Decision 30]");
  });

  it("classifies targets by frontmatter type, not folder (ADR-0011)", async () => {
    const dir = await vault();
    // A decision-genre note living OUTSIDE decisions/ — must still be harvested.
    await note(
      dir,
      "0007-stray-decision.md",
      "---\ntype: decision\nstatus: accepted\n---\n# 0007 — Stray Decision\n",
    );
    // A memory-genre note living INSIDE decisions/ — must NOT be harvested.
    await decision(
      dir,
      "0008-not-a-decision.md",
      "---\ntype: gotcha\nstatus: accepted\n---\n# 0008 — Not A Decision\n",
    );
    await note(
      dir,
      "mem.md",
      "---\ntype: gotcha\ntags: [alpha/x]\n---\n# Memory\nSee [stray](0007-stray-decision.md) and [gotcha](../decisions/0008-not-a-decision.md).",
    );

    await skills({ dir });
    const alpha = await readFile(skillFile(dir, "alpha"), "utf8");

    expect(alpha).toContain("- [0007 — Stray Decision](mage/notes/0007-stray-decision.md)");
    expect(alpha).not.toContain("0008 — Not A Decision");
  });

  it("threads metadata.json genres overrides through target classification", async () => {
    const dir = await vault();
    const metaPath = join(dir, "mage", "metadata.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<
      string,
      unknown
    >;
    meta.genres = { ruling: "decision" };
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    await decision(
      dir,
      "0009-custom-type.md",
      "---\ntype: ruling\nstatus: accepted\n---\n# 0009 — Custom Type Decision\n",
    );
    await note(
      dir,
      "mem.md",
      "---\ntype: gotcha\ntags: [alpha/x]\n---\n# Memory\nSee [ruling](../decisions/0009-custom-type.md).",
    );

    await skills({ dir });
    const alpha = await readFile(skillFile(dir, "alpha"), "utf8");

    expect(alpha).toContain("0009 — Custom Type Decision");
  });

  it("caps the Governing decisions section at 12, keeping the most recent", async () => {
    const dir = await vault();
    const links: string[] = [];
    for (let i = 1; i <= 15; i++) {
      const num = String(i).padStart(4, "0");
      await decision(
        dir,
        `${num}-adr.md`,
        `---\ntype: decision\nstatus: accepted\n---\n# ${num} — Decision ${i}\n`,
      );
      links.push(`[ADR ${num}](../decisions/${num}-adr.md)`);
    }
    await note(
      dir,
      "mem.md",
      `---\ntype: gotcha\ntags: [alpha/x]\n---\n# Memory\nLinks: ${links.join(", ")}.`,
    );

    await skills({ dir });
    const alpha = await readFile(skillFile(dir, "alpha"), "utf8");

    const govLines = alpha
      .split("\n")
      .filter((l) => /^- \[\d{4} — Decision \d+\]\(/.test(l));
    expect(govLines.length).toBe(12);
    // Oldest three dropped, newest kept.
    expect(alpha).not.toContain("0001 — Decision 1]");
    expect(alpha).not.toContain("0003 — Decision 3]");
    expect(alpha).toContain("0004 — Decision 4]");
    expect(alpha).toContain("0015 — Decision 15]");
    expect(alpha).toContain("- …and 3 more in decisions/");
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
