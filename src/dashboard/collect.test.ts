import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectDashboardData } from "./collect.js";
import { PROMOTE_VERSION } from "../grooming/tally.js";
import { tmpDir } from "../../test/fixtures/kb.js";

// ─── fixture plumbing ────────────────────────────────────────────────────────

/** Write a note with frontmatter + body under the docs root. */
async function note(
  root: string,
  relPath: string,
  fm: Record<string, unknown>,
  body: string,
): Promise<void> {
  const abs = join(root, relPath);
  await mkdir(join(abs, ".."), { recursive: true });
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await writeFile(abs, `---\n${yaml}\n---\n\n${body}\n`, "utf8");
}

/** Write a `.mage/metrics/<file>` JSON payload under the docs root. */
async function metrics(root: string, file: string, payload: unknown): Promise<void> {
  const dir = join(root, ".mage", "metrics");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), JSON.stringify(payload, null, 2) + "\n", "utf8");
}

const NOW = new Date("2026-06-09T12:00:00.000Z");
const FIXED_OPTS = { now: NOW, mageVersion: "9.9.9" } as const;

// ─── populated KB ────────────────────────────────────────────────────────────

describe("collectDashboardData — populated KB", () => {
  /**
   * A KB with a few notes across 2 wings + a proposals.json + a rollup + a
   * promote tally + scratch. Asserts the collected counts/proposals/wings/metrics.
   */
  async function populated(): Promise<string> {
    const root = await tmpDir("mage-dash-pop-");

    // wing "alpha": two notes (one links to the other), rooms "core".
    await note(
      root,
      "notes/a1.md",
      { type: "playbook", tags: ["alpha/core"], created: "2026-06-01", last_reviewed: "2026-06-05" },
      "# Alpha One\n\nSee [Alpha Two](a2.md).",
    );
    await note(
      root,
      "notes/a2.md",
      { type: "gotcha", tags: ["alpha/core"], created: "2026-06-02", updated: "2026-06-06" },
      "# Alpha Two\n\nNo links out.",
    );
    // wing "beta": one note, room "edge".
    await note(
      root,
      "notes/b1.md",
      { type: "note", tags: ["beta/edge"], created: "2026-06-03" },
      "# Beta One\n\nStandalone.",
    );

    // proposals.json — one "note" (alpha) + one "graduate" (the hero queue).
    await metrics(root, "proposals.json", [
      {
        action: "note",
        target: "alpha::deploy,rollback",
        payload: { wing: "alpha", keywords: ["deploy", "rollback"], hint: "rollback on failed deploy" },
        evidence: "recurred in 3 session(s): rollback on failed deploy",
      },
      {
        action: "graduate",
        target: "notes/a1.md",
        payload: { note: "notes/a1.md", wing: "alpha", type: "playbook" },
        evidence: "note recurred in 5 session(s) — a proven playbook, ready to graduate to a skill",
      },
    ]);

    // context-match rollup — two skills, 8 loads / 6 matches → 75% whole-KB.
    await metrics(root, "context-match.json", {
      v: PROMOTE_VERSION,
      skills: {
        "alpha:deploy::h1": {
          loads: 5,
          matches: 4,
          dims: { paths: 0, keywords: 4, wing: 1 },
          last_seen: "2026-06-08T00:00:00.000Z",
        },
        "beta:edge::h2": {
          loads: 3,
          matches: 2,
          dims: { paths: 0, keywords: 2, wing: 0 },
          last_seen: "2026-06-08T00:00:00.000Z",
        },
      },
      watermarks: {},
    });

    // promote tally — two signatures recurring: one at 3 sessions, one at 5.
    await metrics(root, "promote.json", {
      v: PROMOTE_VERSION,
      signatures: {
        "alpha::deploy,rollback": {
          sessions: 5,
          lenses: { correction: 2, failure: 1, workflow: 0, preference: 0 },
          wing: "alpha",
          keywords: ["deploy", "rollback"],
          lastSeen: "2026-06-08T00:00:00.000Z",
          hint: "rollback on failed deploy",
        },
        "beta::flaky,test": {
          sessions: 3,
          lenses: { correction: 1, failure: 0, workflow: 1, preference: 0 },
          wing: "beta",
          keywords: ["flaky", "test"],
          lastSeen: "2026-06-08T00:00:00.000Z",
          hint: "retry flaky tests",
        },
        "beta::oneoff": {
          sessions: 1,
          lenses: { correction: 0, failure: 0, workflow: 1, preference: 0 },
          wing: "beta",
          keywords: ["oneoff"],
          lastSeen: "2026-06-08T00:00:00.000Z",
          hint: "seen once",
        },
      },
      sessions: {},
    });

    // .mage/learnings scratch — two JSONL streams with a few lines each (+ a sidecar
    // that must be EXCLUDED from the scratch tally).
    const learnings = join(root, ".mage", "learnings");
    await mkdir(learnings, { recursive: true });
    await writeFile(join(learnings, "s1.jsonl"), '{"a":1}\n{"a":2}\n{"a":3}\n', "utf8");
    await writeFile(join(learnings, "s2.jsonl"), '{"b":1}\n{"b":2}\n', "utf8");
    await writeFile(join(learnings, "s1.skills.jsonl"), '{"x":1}\n{"x":2}\n', "utf8"); // sidecar — excluded.

    return root;
  }

  it("derives REAL counts, wings, and KPIs from the scan + metrics", async () => {
    const root = await populated();
    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    expect(data.meta.kind).toBe("repo");
    expect(data.meta.mageVersion).toBe("9.9.9");
    expect(data.meta.lastRefreshed).toBe(NOW.toISOString());
    expect(data.meta.root).toBe(root);

    // 3 notes across 2 wings (alpha, beta).
    expect(data.kpis.notes).toBe(3);
    expect(data.kpis.wings).toBe(2);
    expect(data.wings.map((w) => w.name)).toEqual(["alpha", "beta"]);
    const alpha = data.wings.find((w) => w.name === "alpha");
    expect(alpha?.noteCount).toBe(2);
    expect(alpha?.rooms).toEqual(["core"]);

    // skills + whole-KB context-match: 6/8 = 75%.
    expect(data.kpis.skills).toBe(2);
    expect(data.kpis.contextMatchPct).toBe(75);
    expect(data.skills.map((s) => s.name).sort()).toEqual(["alpha:deploy", "beta:edge"]);
  });

  it("fills the hero proposal queue and the graduate KPI", async () => {
    const root = await populated();
    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    expect(data.kpis.awaitingYou).toBe(2);
    expect(data.kpis.graduateReady).toBe(1);
    expect(data.proposals).toHaveLength(2);

    const noteProp = data.proposals.find((p) => p.kind === "note");
    expect(noteProp?.target).toBe("alpha::deploy,rollback");
    expect(noteProp?.wing).toBe("alpha");
    expect(noteProp?.why).toContain("recurred in 3 session(s)");

    const gradProp = data.proposals.find((p) => p.kind === "graduate");
    expect(gradProp?.target).toBe("notes/a1.md");
  });

  it("builds the durability ladder (scratch tally + climbing rungs)", async () => {
    const root = await populated();
    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    // scratch = 3 + 2 lines (the .skills sidecar is excluded).
    expect(data.ladder.scratch).toBe(5);
    expect(data.ladder.notes).toBe(3);
    expect(data.ladder.skills).toBe(2);
    // climbing: a signature at 5 sessions and one at 3 (the 1-session one is dropped).
    expect(data.ladder.climbing).toEqual([
      { sessions: 5, count: 1 },
      { sessions: 3, count: 1 },
    ]);
  });

  it("builds the note graph and per-day activity from real note dates/links", async () => {
    const root = await populated();
    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    expect(data.graph.nodes.map((n) => n.id).sort()).toEqual([
      "notes/a1.md",
      "notes/a2.md",
      "notes/b1.md",
    ]);
    // one real edge: a1 → a2.
    expect(data.graph.edges).toEqual([{ source: "notes/a1.md", target: "notes/a2.md" }]);

    // activity: 3 created days; reviewed pulls from updated/last_reviewed.
    const created = data.activity.find((a) => a.date === "2026-06-01");
    expect(created?.created).toBe(1);
    const reviewed = data.activity.find((a) => a.date === "2026-06-06");
    expect(reviewed?.reviewed).toBe(1); // a2 updated 2026-06-06.
  });

  it("computes health (orphans / dangling / due-for-review)", async () => {
    const root = await populated();
    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    // b1 is an orphan (no links in/out); a1↔a2 are linked.
    expect(data.health.orphanNotes).toBe(1);
    expect(data.health.danglingLinks).toBe(0);
    // a2 (no last_reviewed) + b1 (no last_reviewed) are "due"; a1 reviewed recently.
    expect(data.health.notesDueForReview).toBe(2);
    // not a git repo → null commit, no throw.
    expect(data.health.lastCommit).toBeNull();
  });
});

// ─── cold / empty KB ─────────────────────────────────────────────────────────

describe("collectDashboardData — cold KB (no .metrics)", () => {
  it("returns a valid, zeroed snapshot without throwing", async () => {
    const root = await tmpDir("mage-dash-cold-");
    await note(root, "notes/only.md", { type: "note" }, "# Only Note\n\nNothing else.");

    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    // The scan still works — one note, zero wings (untagged).
    expect(data.kpis.notes).toBe(1);
    expect(data.kpis.wings).toBe(0);

    // Every optional source degraded to empty/zero — never threw.
    expect(data.kpis.skills).toBe(0);
    expect(data.kpis.contextMatchPct).toBe(0);
    expect(data.kpis.awaitingYou).toBe(0);
    expect(data.kpis.graduateReady).toBe(0);
    expect(data.proposals).toEqual([]);
    expect(data.skills).toEqual([]);
    expect(data.wings).toEqual([]);
    expect(data.ladder).toEqual({ scratch: 0, notes: 1, skills: 0, climbing: [] });
    expect(data.health.lastCommit).toBeNull();
    expect(data.registry).toBeUndefined(); // in-repo → no registry key.

    // The graph still has the single node, no edges.
    expect(data.graph.nodes).toEqual([{ id: "notes/only.md", wing: "" }]);
    expect(data.graph.edges).toEqual([]);
  });

  it("a completely empty KB (zero notes) still yields a valid snapshot", async () => {
    const root = await tmpDir("mage-dash-empty-");
    const data = await collectDashboardData({ root, kind: "repo" }, FIXED_OPTS);

    expect(data.kpis.notes).toBe(0);
    expect(data.notes).toEqual([]);
    expect(data.graph).toEqual({ nodes: [], edges: [] });
    expect(data.activity).toEqual([]);
    expect(data.ladder.scratch).toBe(0);
  });
});

// ─── hub KB (registry pointers) ──────────────────────────────────────────────

describe("collectDashboardData — hub KB (registry)", () => {
  it("fills registry pointers from hub metadata (names/urls/paths only)", async () => {
    const root = await tmpDir("mage-dash-hub-");
    await mkdir(join(root, "projects"), { recursive: true });
    await writeFile(
      join(root, "metadata.json"),
      JSON.stringify({
        schema: "mage.v1",
        name: "My Hub",
        created_at: "2026-06-01",
        projects: [
          {
            name: "svc-b",
            storage: "in-repo",
            code_repo_path: "/nonexistent/svc-b",
            code_repo_url: "https://github.com/me/svc-b",
          },
          {
            name: "svc-a",
            storage: "hub-owned",
            code_repo_path: "/nonexistent/svc-a",
            code_repo_url: "",
          },
        ],
      }),
      "utf8",
    );
    await note(root, "notes/h1.md", { type: "note", tags: ["ops/infra"] }, "# Hub Note");

    const data = await collectDashboardData({ root, kind: "hub" }, FIXED_OPTS);

    expect(data.meta.kbName).toBe("My Hub");
    expect(data.registry).toBeDefined();
    expect(data.registry?.map((r) => r.name)).toEqual(["svc-a", "svc-b"]); // sorted.
    const svcB = data.registry?.find((r) => r.name === "svc-b");
    expect(svcB?.repoUrl).toBe("https://github.com/me/svc-b");
    expect(svcB?.codePath).toBe("/nonexistent/svc-b");
    expect(svcB?.cloned).toBe(false); // path doesn't exist → not cloned.
  });
});
