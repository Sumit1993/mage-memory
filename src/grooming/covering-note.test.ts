import { describe, expect, it } from "vitest";
import type { ScannedNote } from "../scan.js";
import { tmpDir } from "../../test/fixtures/kb.js";
import { coveringNoteMin } from "./covering-note.js";

// ─── ScannedNote fixtures ─────────────────────────────────────────────────────

function note(p: {
  relPath?: string;
  wing?: string;
  wings?: Array<{ wing: string; room: string }>;
  keywords?: string[];
  type?: string;
}): ScannedNote {
  const wing = p.wing ?? "";
  const wings = p.wings ?? (wing ? [{ wing, room: wing }] : []);
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

// ─── isCovered / coveringNote ───────────────────────────────────────────────────

describe("isCovered — wing aligns AND keyword overlaps", () => {
  it("covers when same wing and a keyword overlaps", () => {
    const notes = [note({ wing: "payments", keywords: ["webhook", "retry"] })];
    expect((coveringNoteMin({ wing: "payments", keywords: ["webhook", "idempotency"] }, notes, 1) !== null)).toBe(true);
  });

  it("does NOT cover when wing differs even though a keyword overlaps", () => {
    const notes = [note({ wing: "billing", keywords: ["webhook"] })];
    expect((coveringNoteMin({ wing: "payments", keywords: ["webhook"] }, notes, 1) !== null)).toBe(false);
  });

  it("does NOT cover when wing matches but no keyword overlaps", () => {
    const notes = [note({ wing: "payments", keywords: ["refund", "dispute"] })];
    expect((coveringNoteMin({ wing: "payments", keywords: ["webhook"] }, notes, 1) !== null)).toBe(false);
  });

  it("a cross-cutting signature ('') is covered by ANY note with a keyword overlap", () => {
    const notes = [note({ wing: "billing", keywords: ["webhook"] })];
    expect((coveringNoteMin({ wing: "", keywords: ["webhook"] }, notes, 1) !== null)).toBe(true);
  });

  it("matches case-insensitively on both wing and keywords", () => {
    const notes = [note({ wing: "Payments", keywords: ["WebHook"] })];
    expect((coveringNoteMin({ wing: "payments", keywords: ["webhook"] }, notes, 1) !== null)).toBe(true);
  });

  it("matches a multi-home note's secondary wing (not just primary)", () => {
    const notes = [
      note({
        wing: "billing",
        wings: [
          { wing: "billing", room: "billing" },
          { wing: "payments", room: "payments" },
        ],
        keywords: ["webhook"],
      }),
    ];
    expect((coveringNoteMin({ wing: "payments", keywords: ["webhook"] }, notes, 1) !== null)).toBe(true);
  });

  it("a keyword-less signature is never covered", () => {
    const notes = [note({ wing: "payments", keywords: ["webhook"] })];
    expect((coveringNoteMin({ wing: "payments", keywords: [] }, notes, 1) !== null)).toBe(false);
  });

  it("returns false against an empty note set", () => {
    expect((coveringNoteMin({ wing: "payments", keywords: ["webhook"] }, [], 1) !== null)).toBe(false);
  });
});

describe("coveringNoteMin — parameterized overlap threshold (the lesson-path bar)", () => {
  const notes = [note({ wing: "mage", keywords: ["release", "badge", "version"] })];

  it("minOverlap 1 behaves like coveringNote (any single shared keyword)", () => {
    expect(coveringNoteMin({ wing: "mage", keywords: ["release"] }, notes, 1)).not.toBeNull();
  });
  it("minOverlap 2 requires two shared keywords (single overlap no longer covers)", () => {
    expect(coveringNoteMin({ wing: "mage", keywords: ["release"] }, notes, 2)).toBeNull();
    expect(coveringNoteMin({ wing: "mage", keywords: ["release", "badge"] }, notes, 2)).not.toBeNull();
  });
  it("minOverlap above the shared count never covers", () => {
    expect(coveringNoteMin({ wing: "mage", keywords: ["release", "badge"] }, notes, 3)).toBeNull();
  });
  it("a degenerate minOverlap (< 1) or a keyword-less signature is never covered", () => {
    expect(coveringNoteMin({ wing: "mage", keywords: ["release", "badge"] }, notes, 0)).toBeNull();
    expect(coveringNoteMin({ wing: "mage", keywords: [] }, notes, 5)).toBeNull();
  });
});

describe("coveringNote — returns the FIRST covering note (deterministic)", () => {
  it("returns the covering note, or null when none covers", async () => {
    await tmpDir(); // exercise the house tmp pattern
    const a = note({ relPath: "notes/a.md", wing: "payments", keywords: ["webhook"] });
    const b = note({ relPath: "notes/b.md", wing: "payments", keywords: ["webhook", "retry"] });
    const found = coveringNoteMin({ wing: "payments", keywords: ["webhook"] }, [a, b], 1);
    expect(found?.relPath).toBe("notes/a.md"); // first in scan order wins
    expect(coveringNoteMin({ wing: "payments", keywords: ["refund"] }, [a, b], 1)).toBeNull();
  });
});
