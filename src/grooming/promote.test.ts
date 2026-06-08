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

function note(p: { wing?: string; keywords?: string[]; relPath?: string }): ScannedNote {
  const wing = p.wing ?? "";
  const wings = wing ? [{ wing, room: wing }] : [];
  return {
    relPath: p.relPath ?? "notes/n.md",
    wings,
    wing: wings[0]?.wing ?? "",
    room: wings[0]?.room ?? "",
    title: "n",
    type: "note",
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
