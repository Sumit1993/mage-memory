import { describe, expect, it } from "vitest";
import { COLD_NOTES, LOW_MATCH, SPARSE_NOTES, commandReference, computeNudges } from "./nudges.js";
import type { NudgePanel } from "./nudges.js";
import type { DashboardData as DD } from "./types.js";

// ─── fixture builders ─────────────────────────────────────────────────────────
//
// A minimal-but-valid DashboardData base; per-test overrides tweak only the
// fields the rule under test reads (kpis, proposals, ladder, skills, health).

function base(): DD {
  return {
    meta: {
      kbName: "kb",
      kind: "in-repo",
      root: "/abs/kb",
      mageVersion: "9.9.9",
      lastRefreshed: "2026-06-09T12:00:00.000Z",
    },
    kpis: { notes: 0, skills: 0, wings: 0, contextMatchPct: 0, awaitingYou: 0, graduateReady: 0 },
    proposals: [],
    wings: [],
    notes: [],
    skills: [],
    graph: { nodes: [], edges: [] },
    activity: [],
    ladder: { scratch: 0, notes: 0, skills: 0, climbing: [] },
    health: { notesDueForReview: 0, danglingLinks: 0, orphanNotes: 0, lastCommit: null },
  };
}

/** The set of panels present in a nudge array (handy for absence assertions). */
function panels(data: DD): Set<NudgePanel> {
  return new Set(computeNudges(data).map((n) => n.panel));
}

/** The nudge mounted in a given panel, or undefined. */
function nudgeFor(data: DD, panel: NudgePanel) {
  return computeNudges(data).find((n) => n.panel === panel);
}

// ─── thresholds are the documented suppression knobs ──────────────────────────

describe("thresholds", () => {
  it("exposes the named suppression thresholds", () => {
    expect(COLD_NOTES).toBe(5);
    expect(SPARSE_NOTES).toBe(15);
    expect(LOW_MATCH).toBe(50);
  });
});

// ─── COLD KB: gently guided ────────────────────────────────────────────────────

describe("computeNudges — cold KB", () => {
  it("yields getting-started + proposals + a distill/connection nudge", () => {
    // 1 note, 0 skills, 0 proposals, scratch > 0.
    const d = base();
    d.kpis = { ...d.kpis, notes: 1 };
    d.ladder = { ...d.ladder, scratch: 42, notes: 1 };

    const p = panels(d);
    expect(p.has("getting-started")).toBe(true);
    expect(p.has("proposals")).toBe(true);
    // scratch>0 AND no proposals → the ladder/distill nudge appears.
    expect(p.has("ladder")).toBe(true);
    expect(p.has("notes")).toBe(true);
    // scratch>0 → connection is suppressed (capture is NOT quiet).
    expect(p.has("connection")).toBe(false);

    // the getting-started nudge carries the exact onboarding commands.
    const gs = nudgeFor(d, "getting-started");
    expect(gs?.commands).toEqual(["mage:learn", "mage distill"]);
    expect(gs?.why).toContain("mage:learn");

    // the distill nudge embeds the REAL scratch count.
    const distill = nudgeFor(d, "ladder");
    expect(distill?.commands).toEqual(["mage distill"]);
    expect(distill?.why).toContain("42 observed events");
  });

  it("yields the connection nudge instead of distill when capture is quiet (scratch=0)", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 2 };
    // scratch stays 0.
    const p = panels(d);
    expect(p.has("connection")).toBe(true); // capture is quiet → wire mage in.
    expect(p.has("ladder")).toBe(false); // no scratch → no distill-the-scratch nudge.
    expect(nudgeFor(d, "connection")?.commands).toEqual(["mage connect"]);
  });
});

// ─── MATURE KB: stays clean ────────────────────────────────────────────────────

describe("computeNudges — mature KB", () => {
  it("shows FEW nudges — capture/notes/getting-started/graduate all absent", () => {
    // notes>15, a skill exists, no proposals, scratch>0, healthy graph, skill ok.
    const d = base();
    d.kpis = { ...d.kpis, notes: 31, skills: 1 };
    d.ladder = { scratch: 2335, notes: 31, skills: 1, climbing: [] };
    d.skills = [{ name: "alpha:deploy", wing: "alpha", contextMatchPct: 88, status: "ok" }];
    // health all zero (the base() default).

    const p = panels(d);
    // getting-started / notes capture nudges vanish past their thresholds.
    expect(p.has("getting-started")).toBe(false);
    expect(p.has("notes")).toBe(false);
    // graduate vanishes once a skill exists.
    expect(p.has("skills")).toBe(false);
    // health/optimize are issue-gated and there are no issues.
    expect(p.has("health")).toBe(false);
    // connection is suppressed (scratch>0).
    expect(p.has("connection")).toBe(false);

    // proposals empty → the proposal/distill nudges DO still show (the one prod).
    expect(p.has("proposals")).toBe(true);
    expect(p.has("ladder")).toBe(true); // scratch>0 + no proposals → distill.
    expect(nudgeFor(d, "proposals")?.commands).toEqual(["mage distill", "mage promote", "mage dream"]);
  });

  it("falls fully silent once proposals also exist", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 31, skills: 1 };
    d.ladder = { scratch: 2335, notes: 31, skills: 1, climbing: [] };
    d.skills = [{ name: "alpha:deploy", contextMatchPct: 88, status: "ok" }];
    d.proposals = [{ kind: "note", target: "x::y", why: "recurred" }];

    // proposals exist → proposal + distill nudges vanish; nothing else qualifies.
    expect(computeNudges(d)).toEqual([]);
  });
});

// ─── per-rule, issue-gated ─────────────────────────────────────────────────────

describe("computeNudges — graduate rule", () => {
  it("nudges graduate when notes>=3 and skills==0, in the Skills panel", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 8, skills: 0 };
    d.ladder = { ...d.ladder, notes: 4, scratch: 5 };
    const grad = computeNudges(d).find(
      (n) => n.panel === "skills" && n.commands.includes("mage:graduate"),
    );
    expect(grad).toBeDefined();
    expect(grad?.commands).toEqual(["mage:graduate"]);
  });

  it("suppresses graduate once a skill exists", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 8, skills: 1 };
    d.ladder = { ...d.ladder, notes: 4 };
    const grad = computeNudges(d).find((n) => n.commands.includes("mage:graduate"));
    expect(grad).toBeUndefined();
  });
});

describe("computeNudges — health rule", () => {
  it("yields the health nudge when there are graph issues", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 31, skills: 1 };
    d.ladder = { scratch: 10, notes: 31, skills: 1, climbing: [] };
    d.health = { notesDueForReview: 0, danglingLinks: 2, orphanNotes: 1, lastCommit: null };
    const health = nudgeFor(d, "health");
    expect(health).toBeDefined();
    expect(health?.commands).toEqual(["mage dream", "mage index"]);
  });

  it("suppresses the health nudge when the graph is clean", () => {
    const d = base();
    d.health = { notesDueForReview: 0, danglingLinks: 0, orphanNotes: 0, lastCommit: null };
    expect(panels(d).has("health")).toBe(false);
  });
});

describe("computeNudges — optimize rule (condition-based, not volume-gated)", () => {
  it("yields the optimize nudge when a skill fires below LOW_MATCH", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 31, skills: 2 };
    d.skills = [
      { name: "ok-skill", contextMatchPct: 90, status: "ok" },
      { name: "bad-skill", contextMatchPct: 40, status: "reword-suggested" },
    ];
    const optimize = computeNudges(d).find((n) => n.commands.includes("mage:optimize"));
    expect(optimize).toBeDefined();
    expect(optimize?.panel).toBe("skills");
  });

  it("does NOT fire optimize for skills with null or healthy context-match", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 31, skills: 2 };
    d.skills = [
      { name: "no-data", status: "ok" }, // contextMatchPct undefined → skip.
      { name: "healthy", contextMatchPct: LOW_MATCH, status: "ok" }, // == 50, not < 50.
    ];
    const optimize = computeNudges(d).find((n) => n.commands.includes("mage:optimize"));
    expect(optimize).toBeUndefined();
  });
});

// ─── determinism ───────────────────────────────────────────────────────────────

describe("computeNudges — determinism", () => {
  it("returns a deep-equal array for the same input", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 2 };
    d.ladder = { ...d.ladder, scratch: 7, notes: 2 };
    expect(computeNudges(d)).toEqual(computeNudges(d));
  });

  it("returns a stable JSON serialization (no clock/randomness)", () => {
    const d = base();
    d.kpis = { ...d.kpis, notes: 31, skills: 1 };
    d.ladder = { scratch: 100, notes: 31, skills: 1, climbing: [] };
    d.health = { notesDueForReview: 3, danglingLinks: 1, orphanNotes: 0, lastCommit: null };
    expect(JSON.stringify(computeNudges(d))).toBe(JSON.stringify(computeNudges(d)));
  });
});

// ─── command reference ─────────────────────────────────────────────────────────

describe("commandReference", () => {
  it("groups the core commands and omits hook-fired mage observe", () => {
    const groups = commandReference(base());
    const names = groups.map((g) => g.group);
    expect(names).toEqual(["Capture", "Curate", "Maintain", "Setup & health"]);

    const allCmds = groups.flatMap((g) => g.items.map((i) => i.cmd));
    expect(allCmds).toContain("mage:learn");
    expect(allCmds).toContain("mage distill");
    expect(allCmds).toContain("mage dashboard --html");
    expect(allCmds).toContain("mage doctor --fix");
    // mage observe is hook-fired (never user-run) — must NOT appear.
    expect(allCmds).not.toContain("mage observe");
    expect(allCmds.some((c) => c.startsWith("mage observe"))).toBe(false);

    // every row carries a description.
    for (const g of groups) for (const i of g.items) expect(i.desc.length).toBeGreaterThan(0);
  });

  it("includes the Hub group ONLY for a hub KB", () => {
    const inRepo = commandReference(base());
    expect(inRepo.some((g) => g.group === "Hub")).toBe(false);

    const hub = base();
    hub.meta = { ...hub.meta, kind: "hub" };
    const hubGroups = commandReference(hub);
    const hubGroup = hubGroups.find((g) => g.group === "Hub");
    expect(hubGroup).toBeDefined();
    const hubCmds = hubGroup?.items.map((i) => i.cmd) ?? [];
    expect(hubCmds).toContain("mage link <hub>");
    expect(hubCmds).toContain("mage list");
    expect(hubCmds).toContain("mage verify");
    expect(hubCmds).toContain("mage status <repo>");
  });

  it("is deterministic for the same input", () => {
    expect(JSON.stringify(commandReference(base()))).toBe(JSON.stringify(commandReference(base())));
  });
});
