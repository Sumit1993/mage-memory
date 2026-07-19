import { describe, expect, it } from "vitest";
import type { ScannedNote } from "../scan.js";
import type { NoteReadStat, Proposal, PromoteTally } from "./types.js";
import { BASE_THRESHOLDS, type Thresholds } from "./thresholds.js";
import { buildManifest } from "./promote.js";

// ─── fixtures ──────────────────────────────────────────────────────────────────

/** A note-read stat: `chapters` is the graduation gate (M). */
function stat(p: { chapters: number; lastSeen?: string }): NoteReadStat {
  return { chapters: p.chapters, lastSeen: p.lastSeen ?? "2026-06-08T00:00:00.000Z" };
}

/** Build a tally from `(note relPath → read stat)` pairs. */
function tally(
  notes: Record<string, NoteReadStat>,
  sessions: PromoteTally["sessions"] = {},
): PromoteTally {
  return { v: 2, notes, sessions };
}

function note(p: {
  wing?: string;
  keywords?: string[];
  relPath?: string;
  type?: string;
}): ScannedNote {
  const wing = p.wing ?? "";
  const wings = wing ? [{ wing, room: wing }] : [];
  return {
    relPath: p.relPath ?? "notes/n.md",
    wings,
    wing: wings[0]?.wing ?? "",
    room: wings[0]?.room ?? "",
    title: "n",
    type: p.type ?? "note",
    keywords: p.keywords ?? [],
  };
}

const T: Thresholds = BASE_THRESHOLDS; // graduateSessions = 5

describe("buildManifest — the note rung is GONE (ADR-0038)", () => {
  it("NEVER emits a note proposal, however heavily a note is read", () => {
    const t = tally({ "notes/a.md": stat({ chapters: 50 }) });
    const notes = [note({ relPath: "notes/a.md", type: "playbook" })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals.filter((p) => p.action === "note")).toHaveLength(0);
  });

  it("promoteSessions (K) no longer gates anything — M alone decides", () => {
    const t = tally({ "notes/a.md": stat({ chapters: 8 }) });
    const notes = [note({ relPath: "notes/a.md", type: "playbook" })];
    for (const promoteSessions of [1, 99]) {
      const m = buildManifest(t, notes, { ...BASE_THRESHOLDS, promoteSessions }, [], {});
      expect(m.proposals.map((x) => x.target)).toEqual(["notes/a.md"]);
    }
  });
});

describe("buildManifest — graduation on NOTE-READ usage (ADR-0038 §2)", () => {
  it("graduates a procedural note read in >= M distinct chapters", () => {
    const t = tally({ "notes/pay.md": stat({ chapters: 6 }) });
    const notes = [note({ relPath: "notes/pay.md", type: "playbook" })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals).toHaveLength(1);
    expect(m.proposals[0]?.action).toBe("graduate");
    expect(m.proposals[0]?.target).toBe("notes/pay.md");
    expect(m.proposals[0]?.evidence).toContain("read in 6 distinct chapter(s)");
    expect(m.climbing).toBe(0);
  });

  it("does NOT graduate below M — counts it as climbing instead", () => {
    const t = tally({ "notes/pay.md": stat({ chapters: 4 }) });
    const notes = [note({ relPath: "notes/pay.md", type: "playbook" })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.climbing).toBe(1);
  });

  it("graduates a gotcha too, but never a non-procedural note however used", () => {
    const notes = [
      note({ relPath: "notes/g.md", type: "gotcha" }),
      note({ relPath: "notes/r.md", type: "reference" }),
    ];
    const t = tally({
      "notes/g.md": stat({ chapters: 9 }),
      "notes/r.md": stat({ chapters: 99 }),
    });
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual(["notes/g.md"]);
  });

  it("binds by PATH, not by fuzzy keyword overlap — a wrong note can no longer graduate", () => {
    // The whole point of ADR-0038 §2: the note is identified by the path that was read.
    const t = tally({ "notes/right.md": stat({ chapters: 8 }) });
    const notes = [
      note({ relPath: "notes/wrong.md", type: "playbook", keywords: ["webhook", "retry"] }),
      note({ relPath: "notes/right.md", type: "playbook", keywords: [] }),
    ];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual(["notes/right.md"]);
  });

  it("skips a read count whose note no longer exists (deleted) without throwing", () => {
    const t = tally({ "notes/gone.md": stat({ chapters: 9 }) });
    const m = buildManifest(t, [], T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.climbing).toBe(0); // at/above M — it was eligible, it just has no target.
  });

  it("a zero-chapter entry is neither proposed nor counted as climbing", () => {
    const t = tally({ "notes/a.md": stat({ chapters: 0 }) });
    const notes = [note({ relPath: "notes/a.md", type: "playbook" })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.climbing).toBe(0);
  });
});

describe("buildManifest — rejected back-off (action+target match suppresses)", () => {
  const t = () => tally({ "notes/pay.md": stat({ chapters: 8 }) });
  const notes = () => [note({ relPath: "notes/pay.md", type: "playbook" })];

  it("suppresses a note whose graduate proposal was already rejected", () => {
    const rejected: Proposal[] = [
      { action: "graduate", target: "notes/pay.md", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(t(), notes(), T, rejected, {}).proposals).toHaveLength(0);
  });

  it("does NOT suppress when the rejected entry targets a different note", () => {
    const rejected: Proposal[] = [
      { action: "graduate", target: "notes/other.md", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(t(), notes(), T, rejected, {}).proposals).toHaveLength(1);
  });

  it("does NOT suppress when the rejected entry is a different action on the same target", () => {
    const rejected: Proposal[] = [
      { action: "demote", target: "notes/pay.md", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(t(), notes(), T, rejected, {}).proposals).toHaveLength(1);
  });
});

describe("buildManifest — bounded promotion budget (0.0.11)", () => {
  function graduatable(keys: string[], chapters: (k: string) => number) {
    const notes: ScannedNote[] = [];
    const t: Record<string, NoteReadStat> = {};
    for (const k of keys) {
      t[`notes/${k}.md`] = stat({ chapters: chapters(k) });
      notes.push(note({ relPath: `notes/${k}.md`, type: "playbook" }));
    }
    return { t: tally(t), notes };
  }

  it("surfaces at most `promotionBudget` proposals and reports the rest as deferred", () => {
    const { t, notes } = graduatable(["a", "b", "c", "d", "e", "f", "g", "h"], () => 6);
    const m = buildManifest(t, notes, { ...BASE_THRESHOLDS, promotionBudget: 5 }, [], {});
    expect(m.proposals).toHaveLength(5);
    expect(m.deferred).toBe(3);
  });

  it("ranks more-read notes first within the budget", () => {
    const by: Record<string, number> = { weak: 5, strong: 9, mid: 7 };
    const { t, notes } = graduatable(["weak", "strong", "mid"], (k) => by[k] as number);
    const m = buildManifest(t, notes, { ...BASE_THRESHOLDS, promotionBudget: 2 }, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual(["notes/strong.md", "notes/mid.md"]);
    expect(m.deferred).toBe(1);
  });

  it("deferred is 0 when everything eligible fits the budget", () => {
    const { t, notes } = graduatable(["x"], () => 6);
    expect(buildManifest(t, notes, BASE_THRESHOLDS, [], {}).deferred).toBe(0);
  });
});

describe("buildManifest — determinism + cursors passthrough", () => {
  it("orders tied proposals by target ascending (stable manifest)", () => {
    const notes: ScannedNote[] = [];
    const t: Record<string, NoteReadStat> = {};
    for (const k of ["zebra", "alpha", "mango"]) {
      t[`notes/${k}.md`] = stat({ chapters: 6 });
      notes.push(note({ relPath: `notes/${k}.md`, type: "playbook" }));
    }
    const m = buildManifest(tally(t), notes, T, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual([
      "notes/alpha.md",
      "notes/mango.md",
      "notes/zebra.md",
    ]);
  });

  it("passes cursors through as a NEW object (does not alias the input)", () => {
    const cursors = { "sess-1": 7 };
    const m = buildManifest(tally({}), [], T, [], cursors);
    expect(m.cursors).toEqual({ "sess-1": 7 });
    expect(m.cursors).not.toBe(cursors);
  });

  it("an empty tally yields no proposals and nothing climbing", () => {
    const m = buildManifest(tally({}), [], T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.climbing).toBe(0);
  });
});
