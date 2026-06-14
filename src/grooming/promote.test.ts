import { describe, expect, it } from "vitest";
import type { ScannedNote } from "../scan.js";
import type {
  LensCounts,
  Proposal,
  PromoteTally,
  SignatureStat,
} from "./types.js";
import { BASE_THRESHOLDS, type Thresholds } from "./thresholds.js";
import { buildManifest, noteProposalFor } from "./promote.js";

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

// ─── noteProposalFor ────────────────────────────────────────────────────────────

describe("noteProposalFor — the canonical note proposal for a signature", () => {
  it("targets the signature key with action note and a {wing,keywords,hint} payload", () => {
    const s = stat({ wing: "payments", keywords: ["webhook", "retry"], sessions: 4, hint: "correction: fix retry" });
    const p = noteProposalFor("payments::retry,webhook", s);
    expect(p.action).toBe("note");
    expect(p.target).toBe("payments::retry,webhook");
    expect(p.payload).toEqual({ wing: "payments", keywords: ["webhook", "retry"], hint: "correction: fix retry" });
  });

  it("evidence cites the distinct-session recurrence count", () => {
    const s = stat({ keywords: ["x"], sessions: 5, hint: "correction: do X" });
    const p = noteProposalFor("::x", s);
    expect(p.evidence).toContain("5 session");
    expect(p.evidence).toContain("correction: do X");
  });

  it("is deterministic — the same stat yields the same action+target (dedupe key)", () => {
    const s = stat({ keywords: ["x"], sessions: 3 });
    const a = noteProposalFor("::x", s);
    const b = noteProposalFor("::x", s);
    expect(a.action).toBe(b.action);
    expect(a.target).toBe(b.target);
  });
});

// ─── buildManifest — the K gate ──────────────────────────────────────────────────

describe("buildManifest — recurrence gate (>= promoteSessions)", () => {
  it("emits a note proposal for a signature AT the gate, uncovered, not rejected", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 3 }) });
    const m = buildManifest(t, [], T, [], {});
    expect(m.proposals).toHaveLength(1);
    expect(m.proposals[0]?.target).toBe("::webhook");
    expect(m.covered).toBe(0);
  });

  it("emits for a signature ABOVE the gate", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 9 }) });
    expect(buildManifest(t, [], T, [], {}).proposals).toHaveLength(1);
  });

  it("ignores a signature BELOW the gate (not yet recurrent)", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 2 }) });
    const m = buildManifest(t, [], T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.covered).toBe(0);
  });

  it("respects a higher gate from a low-sensitivity thresholds object", () => {
    const low: Thresholds = { ...BASE_THRESHOLDS, promoteSessions: 4 };
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 3 }) });
    expect(buildManifest(t, [], low, [], {}).proposals).toHaveLength(0);
    expect(buildManifest(t, [], BASE_THRESHOLDS, [], {}).proposals).toHaveLength(1);
  });
});

describe("buildManifest — covering-note gate (covered counts, never proposed)", () => {
  it("does NOT propose a signature an existing note covers; bumps `covered`", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 5 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"] })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals).toHaveLength(0);
    expect(m.covered).toBe(1);
  });

  it("proposes when the only note is in a DIFFERENT wing (no coverage)", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 5 }) });
    const notes = [note({ wing: "billing", keywords: ["webhook"] })];
    const m = buildManifest(t, notes, T, [], {});
    expect(m.proposals).toHaveLength(1);
    expect(m.covered).toBe(0);
  });

  it("a below-gate covered signature is NOT counted in `covered` (gate is checked first)", () => {
    const t = tally({ "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 1 }) });
    const notes = [note({ wing: "payments", keywords: ["webhook"] })];
    expect(buildManifest(t, notes, T, [], {}).covered).toBe(0);
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
  it("suppresses a signature whose note proposal was already rejected", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 5 }) });
    const rejected: Proposal[] = [
      { action: "note", target: "::webhook", payload: {}, evidence: "declined" },
    ];
    const m = buildManifest(t, [], T, rejected, {});
    expect(m.proposals).toHaveLength(0);
    expect(m.covered).toBe(0); // suppressed, not covered.
  });

  it("does NOT suppress when the rejected entry targets a different signature", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 5 }) });
    const rejected: Proposal[] = [
      { action: "note", target: "::other", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(t, [], T, rejected, {}).proposals).toHaveLength(1);
  });

  it("does NOT suppress when the rejected entry is a different action on the same target", () => {
    const t = tally({ "::webhook": stat({ keywords: ["webhook"], sessions: 5 }) });
    const rejected: Proposal[] = [
      { action: "demote", target: "::webhook", payload: {}, evidence: "declined" },
    ];
    expect(buildManifest(t, [], T, rejected, {}).proposals).toHaveLength(1);
  });
});

describe("buildManifest — bounded promotion budget (0.0.11)", () => {
  it("surfaces at most `promotionBudget` proposals and reports the rest as deferred", () => {
    const sigs: Record<string, SignatureStat> = {};
    for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      sigs[`::${k}`] = stat({ keywords: [k], sessions: 4 });
    }
    const m = buildManifest(tally(sigs), [], { ...BASE_THRESHOLDS, promotionBudget: 5 }, [], {});
    expect(m.proposals).toHaveLength(5);
    expect(m.deferred).toBe(3);
  });

  it("ranks stronger recurrence first within the budget", () => {
    const t = tally({
      "::weak": stat({ keywords: ["weak"], sessions: 3 }),
      "::strong": stat({ keywords: ["strong"], sessions: 9 }),
      "::mid": stat({ keywords: ["mid"], sessions: 5 }),
    });
    const m = buildManifest(t, [], { ...BASE_THRESHOLDS, promotionBudget: 2 }, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual(["::strong", "::mid"]);
    expect(m.deferred).toBe(1);
  });

  it("ranks the graduate rung ahead of a higher-recurrence note proposal", () => {
    const t = tally({
      "payments::webhook": stat({ wing: "payments", keywords: ["webhook"], sessions: 8 }),
      "::loud": stat({ keywords: ["loud"], sessions: 50 }),
    });
    const notes = [note({ wing: "payments", keywords: ["webhook"], relPath: "notes/pay.md", type: "playbook" })];
    const m = buildManifest(t, notes, { ...BASE_THRESHOLDS, promotionBudget: 1 }, [], {});
    expect(m.proposals).toHaveLength(1);
    expect(m.proposals[0]?.action).toBe("graduate"); // graduate wins the slot despite the note's higher count
    expect(m.deferred).toBe(1);
  });

  it("deferred is 0 when everything eligible fits the budget", () => {
    const t = tally({ "::x": stat({ keywords: ["x"], sessions: 4 }) });
    expect(buildManifest(t, [], BASE_THRESHOLDS, [], {}).deferred).toBe(0);
  });
});

describe("buildManifest — determinism + cursors passthrough", () => {
  it("sorts proposals by signature key ascending (stable manifest)", () => {
    const t = tally({
      "::zebra": stat({ keywords: ["zebra"], sessions: 3 }),
      "::alpha": stat({ keywords: ["alpha"], sessions: 3 }),
      "::mango": stat({ keywords: ["mango"], sessions: 3 }),
    });
    const m = buildManifest(t, [], T, [], {});
    expect(m.proposals.map((p) => p.target)).toEqual(["::alpha", "::mango", "::zebra"]);
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
