import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScannedNote } from "../scan.js";
import { coveringNote, isCovered } from "./covering-note.js";

// ─── tmp fixture plumbing (house pattern; this module is pure) ────────────────

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-promote-cover-"));
  made.push(dir);
  return dir;
}

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
    expect(isCovered({ wing: "payments", keywords: ["webhook", "idempotency"] }, notes)).toBe(true);
  });

  it("does NOT cover when wing differs even though a keyword overlaps", () => {
    const notes = [note({ wing: "billing", keywords: ["webhook"] })];
    expect(isCovered({ wing: "payments", keywords: ["webhook"] }, notes)).toBe(false);
  });

  it("does NOT cover when wing matches but no keyword overlaps", () => {
    const notes = [note({ wing: "payments", keywords: ["refund", "dispute"] })];
    expect(isCovered({ wing: "payments", keywords: ["webhook"] }, notes)).toBe(false);
  });

  it("a cross-cutting signature ('') is covered by ANY note with a keyword overlap", () => {
    const notes = [note({ wing: "billing", keywords: ["webhook"] })];
    expect(isCovered({ wing: "", keywords: ["webhook"] }, notes)).toBe(true);
  });

  it("matches case-insensitively on both wing and keywords", () => {
    const notes = [note({ wing: "Payments", keywords: ["WebHook"] })];
    expect(isCovered({ wing: "payments", keywords: ["webhook"] }, notes)).toBe(true);
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
    expect(isCovered({ wing: "payments", keywords: ["webhook"] }, notes)).toBe(true);
  });

  it("a keyword-less signature is never covered", () => {
    const notes = [note({ wing: "payments", keywords: ["webhook"] })];
    expect(isCovered({ wing: "payments", keywords: [] }, notes)).toBe(false);
  });

  it("returns false against an empty note set", () => {
    expect(isCovered({ wing: "payments", keywords: ["webhook"] }, [])).toBe(false);
  });
});

describe("coveringNote — returns the FIRST covering note (deterministic)", () => {
  it("returns the covering note, or null when none covers", async () => {
    await tmp(); // exercise the house tmp pattern
    const a = note({ relPath: "notes/a.md", wing: "payments", keywords: ["webhook"] });
    const b = note({ relPath: "notes/b.md", wing: "payments", keywords: ["webhook", "retry"] });
    const found = coveringNote({ wing: "payments", keywords: ["webhook"] }, [a, b]);
    expect(found?.relPath).toBe("notes/a.md"); // first in scan order wins
    expect(coveringNote({ wing: "payments", keywords: ["refund"] }, [a, b])).toBeNull();
  });
});
