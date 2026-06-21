import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpDir } from "../../test/fixtures/kb.js";
import type { Proposal } from "./types.js";
import {
  isRejected,
  PROPOSALS_FILE,
  proposalsPath,
  readProposals,
  readRejected,
  REJECTED_FILE,
  rejectedPath,
  writeProposals,
  writeRejected,
} from "./proposals.js";

// ─── fixtures ──────────────────────────────────────────────────────────────────

function noteProposal(target: string): Proposal {
  return {
    action: "note",
    target,
    payload: { wing: "payments", keywords: ["webhook"], hint: "a user correction" },
    evidence: "recurred in 3 sessions",
  };
}

// ─── paths ──────────────────────────────────────────────────────────────────────

describe("paths — gitignored .mage/metrics siblings", () => {
  it("places both stores under .mage/metrics/", () => {
    const root = "/x/mage";
    expect(proposalsPath(root)).toBe(join(root, ".mage", "metrics", PROPOSALS_FILE));
    expect(rejectedPath(root)).toBe(join(root, ".mage", "metrics", REJECTED_FILE));
  });
});

// ─── reads — fail-open ──────────────────────────────────────────────────────────

describe("readProposals / readRejected — fail-open to []", () => {
  it("returns [] when the file is absent", async () => {
    const dir = await tmpDir();
    expect(await readProposals(dir)).toEqual([]);
    expect(await readRejected(dir)).toEqual([]);
  });

  it("returns [] on corrupt JSON", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".mage", "metrics"), { recursive: true });
    await writeFile(proposalsPath(dir), "{ not json", "utf8");
    await writeFile(rejectedPath(dir), "]]", "utf8");
    expect(await readProposals(dir)).toEqual([]);
    expect(await readRejected(dir)).toEqual([]);
  });

  it("returns [] when the JSON is not an array", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, ".mage", "metrics"), { recursive: true });
    await writeFile(proposalsPath(dir), JSON.stringify({ action: "note" }), "utf8");
    expect(await readProposals(dir)).toEqual([]);
  });

  it("drops torn entries that aren't proposal-shaped", async () => {
    const dir = await tmpDir();
    const good = noteProposal("payments::webhook");
    await mkdir(join(dir, ".mage", "metrics"), { recursive: true });
    await writeFile(
      proposalsPath(dir),
      JSON.stringify([good, null, 7, { target: "no-action" }, { action: "note" }]),
      "utf8",
    );
    expect(await readProposals(dir)).toEqual([good]);
  });
});

// ─── writes — round-trip + on-disk shape ────────────────────────────────────────

describe("writeProposals / writeRejected — pretty JSON, trailing NL, mkdir", () => {
  it("round-trips through write → read", async () => {
    const dir = await tmpDir();
    const ps = [noteProposal("a::x"), noteProposal("b::y")];
    await writeProposals(dir, ps);
    expect(await readProposals(dir)).toEqual(ps);
  });

  it("creates .metrics/ and emits pretty JSON ending in a newline", async () => {
    const dir = await tmpDir();
    await writeRejected(dir, [noteProposal("a::x")]);
    const raw = await readFile(rejectedPath(dir), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  "); // 2-space indentation.
    expect(JSON.parse(raw)).toEqual([noteProposal("a::x")]);
  });

  it("writes an empty array cleanly", async () => {
    const dir = await tmpDir();
    await writeProposals(dir, []);
    expect(await readProposals(dir)).toEqual([]);
  });
});

// ─── isRejected — back-off predicate ────────────────────────────────────────────

describe("isRejected — matches on action + target", () => {
  it("suppresses an equivalent proposal already in the buffer", () => {
    const rejected = [noteProposal("payments::webhook")];
    const candidate = noteProposal("payments::webhook");
    expect(isRejected(candidate, rejected)).toBe(true);
  });

  it("ignores payload + evidence differences (identity is action + target)", () => {
    const rejected: Proposal[] = [
      { action: "note", target: "payments::webhook", payload: {}, evidence: "old" },
    ];
    const candidate = noteProposal("payments::webhook"); // different payload/evidence.
    expect(isRejected(candidate, rejected)).toBe(true);
  });

  it("does NOT suppress a different target", () => {
    const rejected = [noteProposal("payments::webhook")];
    expect(isRejected(noteProposal("payments::refund"), rejected)).toBe(false);
  });

  it("does NOT suppress a different action on the same target", () => {
    const rejected: Proposal[] = [
      { action: "graduate", target: "t", payload: {}, evidence: "" },
    ];
    const candidate: Proposal = { action: "note", target: "t", payload: {}, evidence: "" };
    expect(isRejected(candidate, rejected)).toBe(false);
  });

  it("returns false against an empty buffer", () => {
    expect(isRejected(noteProposal("a::x"), [])).toBe(false);
  });
});
