import { describe, expect, it } from "vitest";
import type { ScannedNote } from "../scan.js";
import type {
  LensCounts,
  Proposal,
  PromoteTally,
  SignatureStat,
} from "./types.js";
import { BASE_THRESHOLDS, type Thresholds } from "./thresholds.js";
import { buildManifest } from "./promote.js";

// ─── fixtures ──────────────────────────────────────────────────────────────────

function lenses(p: Partial<LensCounts> = {}): LensCounts {
  return { correction: 0, failure: 0, workflow: 0, preference: 0, ...p };
}

/** A signature stat: `key` is `${wing}::${keywords.join(",")}`; sessions is the gate. */
function stat(p: {
  wing?: string;
  keywords?: string[];
  sessions: number;
  hint?: string;
  lastSeen?: string;
}): SignatureStat {
  return {
    sessions: p.sessions,
    lenses: lenses({ correction: 1 }),
    wing: p.wing ?? "",
    keywords: p.keywords ?? [],
    lastSeen: p.lastSeen ?? "2026-06-08T00:00:00.000Z",
    hint: p.hint ?? "correction: do X",
  };
}

/** Build a tally from `(key → stat)` pairs (sessions map left empty unless given). */
function tally(
  signatures: Record<string, SignatureStat>,
  sessions: PromoteTally["sessions"] = {},
): PromoteTally {
  return { v: 1, signatures, sessions };
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

const T: Thresholds = BASE_THRESHOLDS; // promoteSessions = 3

describe("buildManifest — the note rung is GONE (ADR-0038)", () => {
  it("NEVER emits a note proposal, however recurrent an uncovered signature is", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 50 }) });
    const m = buildManifest(t, [], T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.proposals.filter((p) => p.action === "note")).toHaveLength(0);
  });

  it("an uncovered signature is a dead end — not proposed, not counted as covered", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 9 }) });
    const notes = [note({ wing: "billing", keywords: ["webhook"] })]; // different wing → no coverage
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.covered).toBe(0);
  });

  it("promoteSessions (K) no longer gates anything — M alone decides", () => {
    // sessions=8 clears M=5. A low-sensitivity K=4 (or any K) must not change the outcome.
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"], relPath: "notes/pay.md", type: "playbook" })];
    const withHighK = buildManifest(t, notes, { ...BASE_THRESHOLDS, promoteSessions: 99 }, [], {});
    const withLowK = buildManifest(t, notes, { ...BASE_THRESHOLDS, promoteSessions: 1 }, [], {});
    expect(withHighK.proposals.map((x) => x.target)).toEqual(["notes/pay.md"]);
    expect(withLowK.proposals.map((x) => x.target)).toEqual(["notes/pay.md"]);
  });

  it("counts EVERY covered signature, including one below the old K gate", () => {
    // Pre-ADR-0038 the K gate ran first, so this scored covered=0. K is gone, so it counts.
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 1 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"] })];
    expect(buildManifest(t, notes, T, [], {}).covered).toBe(1);
  });
});

describe("buildManifest — graduation rung (covered PROCEDURAL note >= graduateSessions)", () => {
  it("emits a graduate proposal for a covered playbook note recurring >= M sessions", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"], relPath: "notes/pay.md", type: "playbook" })];
    const m = buildManifest(t, notes, T, [], {});
    const grad = m.proposals.find((p) => p.action === "graduate");
    expect(grad).toBeDefined();
    expect(grad?.target).toBe("notes/pay.md");
    expect(m.covered).toBe(1); // still counted as covered (info), AND graduated.
  });

  it("does NOT graduate a covered procedural note BELOW M sessions (only covered++)", () => {
    // promoteSessions=3 is met but graduateSessions=5 is not (sessions=4).
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 4 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"], type: "playbook" })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals.filter((p) => p.action === "graduate")).toHaveLength(0);
    expect(m.covered).toBe(1);
  });

  it("does NOT graduate a NON-procedural covered note (e.g. reference) even >= M", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 9 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"], type: "reference" })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals.filter((p) => p.action === "graduate")).toHaveLength(0);
    expect(m.covered).toBe(1);
  });

  it("graduates a gotcha note too (the other procedural type)", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"], relPath: "notes/g.md", type: "gotcha" })];
    const grad = buildManifest(t, notes, T, [], {}).proposals.find((p) => p.action === "graduate");
    expect(grad?.target).toBe("notes/g.md");
  });

  it("dedupes graduation by note relPath when multiple recurring signatures cover one note", () => {
    const t = tally({
      "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }),
      "payments::retry": stat({ wing: "payments", keywords: ["retry"], sessions: 9 }),
    });
    const notes = [note({ wing: "payments", keywords: ["webhook", "retry"], relPath: "notes/pay.md", type: "playbook" })];
    const grads = buildManifest(t, notes, T, [], {}).proposals.filter((p) => p.action === "graduate");
    expect(grads).toHaveLength(1);
    expect(grads[0]?.target).toBe("notes/pay.md");
  });

  it("respects the rejected buffer for a graduate proposal", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"], relPath: "notes/pay.md", type: "playbook" })];
    const rejected: Proposal[] = [{ action: "graduate", target: "notes/pay.md", payload: {}, evidence: "declined" }];
    const grads = buildManifest(t, notes, T, rejected, {}).proposals.filter((p) => p.action === "graduate");
    expect(grads).toHaveLength(0);
  });
});

describe("buildManifest — rejected back-off (action+target match suppresses)", () => {
  const covering = () => [
    note({ wing: "payments", keywords: ["webhook"], relPath: "notes/pay.md", type: "playbook" }),
  ];
  const recurring = () =>
    tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }) });

  it("suppresses a note whose graduate proposal was already rejected", () => {
    const rejected: Proposal[] = [
      { action: "graduate", target: "notes/pay.md", payload: {}, evidence: "declined" },
    ];
    const m = buildManifest(recurring(), covering(), T, rejected, {});
    expect(m.proposals).toHaveLength(0);
    expect(m.covered).toBe(1); // suppressed from proposal, but still a covered signature.
  });

  it("does NOT suppress when the rejected entry targets a different note", () => {
    const rejected: Proposal[] = [
      { action: "graduate", target: "notes/other.md", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(recurring(), covering(), T, rejected, {}).proposals).toHaveLength(1);
  });

  it("does NOT suppress when the rejected entry is a different action on the same target", () => {
    const rejected: Proposal[] = [
      { action: "demote", target: "notes/pay.md", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(recurring(), covering(), T, rejected, {}).proposals).toHaveLength(1);
  });
});

describe("buildManifest — bounded promotion budget (0.0.11)", () => {
  /** N covered playbook notes, each with its own recurring signature at `sessions`. */
  function graduatable(keys: string[], sessions: (k: string) => number) {
    const sigs: Record<string, SignatureStat> = {};
    const notes: ScannedNote[] = [];
    for (const k of keys) {
      sigs[`w::${k}`] = stat({ wing: "w", keywords: [k], sessions: sessions(k) });
      notes.push(note({ wing: "w", keywords: [k], relPath: `notes/${k}.md`, type: "playbook" }));
    }
    return { t: tally(sigs), notes };
  }

  it("surfaces at most `promotionBudget` proposals and reports the rest as deferred", () => {
    const { t, notes } = graduatable(["a", "b", "c", "d", "e", "f", "g", "h"], () => 6);
    const m = buildManifest(t, notes, { ...BASE_THRESHOLDS, promotionBudget: 5 }, [], {});
    expect(m.proposals).toHaveLength(5);
    expect(m.deferred).toBe(3);
  });

  it("ranks stronger recurrence first within the budget", () => {
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

  it("an uncovered signature never consumes budget, however loud", () => {
    const { t, notes } = graduatable(["quiet"], () => 6);
    t.signatures["::loud"] = stat({ keywords: ["loud"], sessions: 500 });
    const m = buildManifest(t, notes, { ...BASE_THRESHOLDS, promotionBudget: 1 }, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual(["notes/quiet.md"]);
    expect(m.deferred).toBe(0); // the loud uncovered signature was never eligible at all.
  });
});

describe("buildManifest — determinism + cursors passthrough", () => {
  it("orders tied proposals by target ascending (stable manifest)", () => {
    const sigs: Record<string, SignatureStat> = {};
    const notes: ScannedNote[] = [];
    for (const k of ["zebra", "alpha", "mango"]) {
      sigs[`w::${k}`] = stat({ wing: "w", keywords: [k], sessions: 6 });
      notes.push(note({ wing: "w", keywords: [k], relPath: `notes/${k}.md`, type: "playbook" }));
    }
    const m = buildManifest(tally(sigs), notes, T, [], {});
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

  it("an empty tally yields no proposals and zero covered", () => {
    const m = buildManifest(tally({}), [], T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.covered).toBe(0);
  });
});
