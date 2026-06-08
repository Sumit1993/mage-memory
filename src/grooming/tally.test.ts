import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCompact,
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import type { PromoteTally } from "./types.js";
import {
  foldSession,
  foldTally,
  promoteTallyPath,
  PROMOTE_VERSION,
  readTally,
  writeTally,
} from "./tally.js";

// ─── tmp fixture plumbing ─────────────────────────────────────────────────────

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-promote-tally-"));
  made.push(dir);
  return dir;
}

// ─── ObserveEvent builders (monotonic clock) ──────────────────────────────────

let clock = 0;
function nextTs(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString();
}
function base(session: string): EventBase {
  return { ts: nextTs(), session };
}
function prompt(session: string, text: string): ObserveEvent {
  return buildUserPrompt(base(session), text);
}
function tool(session: string, paths: string[]): ObserveEvent {
  return buildToolUse(base(session), { tool: "Read", paths, detail: null, ok: true, error_summary: null });
}
const compact = (session: string): ObserveEvent => buildCompact(base(session), "manual");
const sessionEnd = (session: string): ObserveEvent => buildSessionEnd(base(session));

function toJsonl(events: ObserveEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * A closed segment carrying ONE correction signature (a prompt right after a
 * tool_use, in the `payments` wing). Repeating these words always buckets the same
 * `(wing+keywords)` key.
 */
function correctionSegment(session: string): ObserveEvent[] {
  return [tool(session, ["payments/webhook.ts"]), prompt(session, "always validate the webhook idempotency"), sessionEnd(session)];
}

/**
 * The signature key the correctionSegment produces. Keywords are derived from
 * "always validate the webhook idempotency" (alpha-sorted, stopwords dropped), in
 * the `payments` wing. Kept explicit so the distinct-session assertions are concrete.
 */
const SIG_KEY = "payments::always,idempotency,validate,webhook";

// ─── readTally / writeTally — fail-open + round-trip ──────────────────────────

describe("readTally — fresh empty on missing/corrupt (fail-open)", () => {
  it("returns a fresh empty tally when no file exists", async () => {
    const dir = await tmp();
    expect(await readTally(dir)).toEqual({ v: PROMOTE_VERSION, signatures: {}, sessions: {} });
  });

  it("returns a fresh empty tally when the file is corrupt JSON (fail-open)", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".metrics"), { recursive: true });
    await writeFile(promoteTallyPath(dir), "{ not json", "utf8");
    expect(await readTally(dir)).toEqual({ v: PROMOTE_VERSION, signatures: {}, sessions: {} });
  });

  it("round-trips a written tally with a trailing newline", async () => {
    const dir = await tmp();
    const t: PromoteTally = {
      v: PROMOTE_VERSION,
      signatures: {
        "w::k": { sessions: 2, lenses: { correction: 2, failure: 0, workflow: 0, preference: 0 }, wing: "w", keywords: ["k"], lastSeen: "t", hint: "h" },
      },
      sessions: { "s-1": { offset: 3, sigs: ["w::k"] } },
    };
    await writeTally(dir, t);
    expect(await readTally(dir)).toEqual(t);
    const raw = await readFile(promoteTallyPath(dir), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

// ─── foldSession — immutability ───────────────────────────────────────────────

describe("foldSession — never mutates its inputs", () => {
  it("returns a NEW tally and leaves the prior one untouched", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, signatures: {}, sessions: {} };
    const folded = foldSession(empty, "s-1", correctionSegment("s-1"), null);
    expect(empty.signatures).toEqual({}); // input unchanged
    expect(empty.sessions).toEqual({});
    expect(folded).not.toBe(empty);
    expect(folded.signatures[SIG_KEY]?.sessions).toBe(1);
  });
});

// ─── (a) IDEMPOTENCY — re-folding an unchanged file adds nothing ──────────────

describe("(a) idempotency — re-folding an unchanged stream is a no-op", () => {
  it("foldSession twice over the SAME events adds nothing the second time", () => {
    const events = correctionSegment("s-1");
    const empty: PromoteTally = { v: PROMOTE_VERSION, signatures: {}, sessions: {} };
    const once = foldSession(empty, "s-1", events, null);
    const twice = foldSession(once, "s-1", events, null);
    expect(twice).toEqual(once);
    expect(twice.signatures[SIG_KEY]?.sessions).toBe(1);
  });

  it("foldTally twice over an unchanged file leaves counts stable", async () => {
    const dir = await tmp();
    const learnings = join(dir, ".learnings");
    await mkdir(learnings, { recursive: true });
    await writeFile(join(learnings, "s-1.jsonl"), toJsonl(correctionSegment("s-1")), "utf8");

    const first = await foldTally(dir, learnings, null);
    await writeTally(dir, first);
    const second = await foldTally(dir, learnings, null);

    expect(second).toEqual(first);
    expect(second.signatures[SIG_KEY]?.sessions).toBe(1);
    expect(second.sessions["s-1"]?.offset).toBe(3);
  });
});

// ─── (b) DISTINCT-SESSION — one session, signature recurs across TWO folds ────

describe("(b) distinct-session — a signature recurring in ONE session counts ONCE", () => {
  it("a growing file folded twice (same signature in both chapters) counts the session once", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, signatures: {}, sessions: {} };

    // Fold 1: first closed chapter carries the signature.
    const chapter1 = correctionSegment("s-1");
    const after1 = foldSession(empty, "s-1", chapter1, null);
    expect(after1.signatures[SIG_KEY]?.sessions).toBe(1);
    expect(after1.sessions["s-1"]?.offset).toBe(3);

    // Fold 2: the file GREW — a second closed chapter with the SAME signature words
    // (same wing via a payments/ path, same correction text → same `(wing+keywords)` key).
    const chapter2 = [
      tool("s-1", ["payments/retry.ts"]),
      prompt("s-1", "always validate the webhook idempotency"),
      compact("s-1"),
    ];
    const grown = [...chapter1, ...chapter2];
    const after2 = foldSession(after1, "s-1", grown, null);

    // Same session, same signature, second occurrence → STILL sessions === 1.
    expect(after2.signatures[SIG_KEY]?.sessions).toBe(1);
    // But the lens count accumulated (the second contribution merged its lens).
    expect(after2.signatures[SIG_KEY]?.lenses.correction).toBeGreaterThanOrEqual(2);
    // The offset advanced past the new chapter (never regress).
    expect(after2.sessions["s-1"]?.offset).toBe(grown.length);
  });
});

// ─── (c) TWO DISTINCT SESSIONS — same signature → sessions === 2 ──────────────

describe("(c) two distinct sessions with the same signature → sessions === 2", () => {
  it("foldSession over two different sessions increments distinct-session count to 2", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, signatures: {}, sessions: {} };
    const a = foldSession(empty, "s-1", correctionSegment("s-1"), null);
    const b = foldSession(a, "s-2", correctionSegment("s-2"), null);
    expect(b.signatures[SIG_KEY]?.sessions).toBe(2);
    expect(b.sessions["s-1"]).toBeDefined();
    expect(b.sessions["s-2"]).toBeDefined();
  });

  it("foldTally over two session files yields sessions === 2", async () => {
    const dir = await tmp();
    const learnings = join(dir, ".learnings");
    await mkdir(learnings, { recursive: true });
    await writeFile(join(learnings, "s-1.jsonl"), toJsonl(correctionSegment("s-1")), "utf8");
    await writeFile(join(learnings, "s-2.jsonl"), toJsonl(correctionSegment("s-2")), "utf8");

    const t = await foldTally(dir, learnings, null);
    expect(t.signatures[SIG_KEY]?.sessions).toBe(2);
  });
});

// ─── (d) PURGE-SURVIVAL — global counts persist after a session-fold is pruned ─

describe("(d) purge-survival — signature counts survive a pruned session fold", () => {
  it("foldTally prunes a vanished session's fold but keeps its global contribution", async () => {
    const dir = await tmp();
    const learnings = join(dir, ".learnings");
    await mkdir(learnings, { recursive: true });
    const f1 = join(learnings, "s-1.jsonl");
    const f2 = join(learnings, "s-2.jsonl");
    await writeFile(f1, toJsonl(correctionSegment("s-1")), "utf8");
    await writeFile(f2, toJsonl(correctionSegment("s-2")), "utf8");

    // First pass: both sessions contribute → sessions === 2, both fold entries present.
    const pass1 = await foldTally(dir, learnings, null);
    await writeTally(dir, pass1);
    expect(pass1.signatures[SIG_KEY]?.sessions).toBe(2);
    expect(pass1.sessions["s-1"]).toBeDefined();
    expect(pass1.sessions["s-2"]).toBeDefined();

    // s-1's `.learnings` file PURGES (aged out). Re-fold.
    await unlink(f1);
    const pass2 = await foldTally(dir, learnings, null);

    // The global signature count SURVIVES the purge (still 2 distinct sessions).
    expect(pass2.signatures[SIG_KEY]?.sessions).toBe(2);
    // But s-1's prunable fold-memory is gone; s-2's persists.
    expect(pass2.sessions["s-1"]).toBeUndefined();
    expect(pass2.sessions["s-2"]).toBeDefined();
  });
});

// ─── never-regress offset + multi-pass closing session ────────────────────────

describe("never-regress offset", () => {
  it("a later fold with a shrunk closed region never lowers the offset", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, signatures: {}, sessions: {} };
    const full = correctionSegment("s-1"); // closedCount === 3
    const after = foldSession(empty, "s-1", full, null);
    expect(after.sessions["s-1"]?.offset).toBe(3);

    // A degenerate re-read with NO terminator (closedCount 0) must not regress.
    const noTerminator = [tool("s-1", ["payments/x.ts"]), prompt("s-1", "validate the webhook idempotency")];
    const after2 = foldSession(after, "s-1", noTerminator, null);
    expect(after2.sessions["s-1"]?.offset).toBe(3);
    expect(after2.signatures[SIG_KEY]?.sessions).toBe(1);
  });
});

// ─── foldTally — sidecar / archive exclusion + fail-open ──────────────────────

describe("foldTally — fs orchestration", () => {
  it("ignores *.skills.jsonl sidecars and the .archive dir", async () => {
    const dir = await tmp();
    const learnings = join(dir, ".learnings");
    await mkdir(join(learnings, ".archive"), { recursive: true });
    await writeFile(join(learnings, "s-1.jsonl"), toJsonl(correctionSegment("s-1")), "utf8");
    await writeFile(join(learnings, "s-1.skills.jsonl"), toJsonl(correctionSegment("s-1")), "utf8");
    await writeFile(join(learnings, ".archive", "s-old.jsonl"), toJsonl(correctionSegment("s-old")), "utf8");

    const t = await foldTally(dir, learnings, null);
    // Only the single full stream contributes (sidecar + archive excluded).
    expect(t.signatures[SIG_KEY]?.sessions).toBe(1);
    expect(Object.keys(t.sessions)).toEqual(["s-1"]);
    expect(t.sessions["s-1.skills"]).toBeUndefined();
  });

  it("skips torn lines and an empty learnings dir (fail-open)", async () => {
    const dir = await tmp();
    const learnings = join(dir, ".learnings");
    await mkdir(learnings, { recursive: true });
    const body = "{ garbage\n" + toJsonl(correctionSegment("s-1")) + "also not json\n";
    await writeFile(join(learnings, "s-1.jsonl"), body, "utf8");

    const t = await foldTally(dir, learnings, null);
    expect(t.signatures[SIG_KEY]?.sessions).toBe(1);
  });

  it("returns a fresh empty tally when the learnings dir does not exist", async () => {
    const dir = await tmp();
    const t = await foldTally(dir, join(dir, ".learnings"), null);
    expect(t).toEqual({ v: PROMOTE_VERSION, signatures: {}, sessions: {} });
  });
});
