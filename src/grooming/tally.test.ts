import { describe, expect, it } from "vitest";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpDir } from "../../test/fixtures/kb.js";
import { STATE_DIR, LEARNINGS_DIR, METRICS_DIR } from "../paths.js";
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

/** The docs root the pure-fold tests key on (absolute, so repoRoot can stay null). */
const DOCS = "/repo/mage";

/**
 * A closed segment carrying ONE note READ (ADR-0038 §2): a Read of a note under the
 * docs root, plus a prompt so the chapter clears MIN_CHAPTER_WORK_EVENTS.
 */
function noteReadSegment(session: string, docsRoot: string = DOCS): ObserveEvent[] {
  return [
    tool(session, [`${docsRoot}/notes/pay.md`]),
    prompt(session, "why does this fail"),
    sessionEnd(session),
  ];
}

/** The docs-root-relative note key `noteReadSegment` produces. */
const NOTE_REL = "notes/pay.md";

// ─── readTally / writeTally — fail-open + round-trip ──────────────────────────

describe("readTally — fresh empty on missing/corrupt (fail-open)", () => {
  it("returns a fresh empty tally when no file exists", async () => {
    const dir = await tmpDir();
    expect(await readTally(dir)).toEqual({ v: PROMOTE_VERSION, notes: {}, sessions: {} });
  });

  it("returns a fresh empty tally when the file is corrupt JSON (fail-open)", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, STATE_DIR, METRICS_DIR), { recursive: true });
    await writeFile(promoteTallyPath(dir), "{ not json", "utf8");
    expect(await readTally(dir)).toEqual({ v: PROMOTE_VERSION, notes: {}, sessions: {} });
  });

  it("round-trips a written tally with a trailing newline", async () => {
    const dir = await tmpDir();
    const t: PromoteTally = {
      v: PROMOTE_VERSION,
      notes: {
        "notes/k.md": { chapters: 2, lastSeen: "t" },
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
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };
    const folded = foldSession(empty, "s-1", noteReadSegment("s-1"), DOCS, null);
    expect(empty.notes).toEqual({}); // input unchanged
    expect(empty.sessions).toEqual({});
    expect(folded).not.toBe(empty);
    expect(folded.notes[NOTE_REL]?.chapters).toBe(1);
  });
});

// ─── (a) IDEMPOTENCY — re-folding an unchanged file adds nothing ──────────────

describe("(a) idempotency — re-folding an unchanged stream is a no-op", () => {
  it("foldSession twice over the SAME events adds nothing the second time", () => {
    const events = noteReadSegment("s-1");
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };
    const once = foldSession(empty, "s-1", events, DOCS, null);
    const twice = foldSession(once, "s-1", events, DOCS, null);
    expect(twice).toEqual(once);
    expect(twice.notes[NOTE_REL]?.chapters).toBe(1);
  });

  it("foldTally twice over an unchanged file leaves counts stable", async () => {
    const dir = await tmpDir();
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });
    await writeFile(join(learnings, "s-1.jsonl"), toJsonl(noteReadSegment("s-1", dir)), "utf8");

    const first = await foldTally(dir, learnings, null);
    await writeTally(dir, first);
    const second = await foldTally(dir, learnings, null);

    expect(second).toEqual(first);
    expect(second.notes[NOTE_REL]?.chapters).toBe(1);
    expect(second.sessions["s-1"]?.offset).toBe(3);
  });
});

// ─── (b) DISTINCT-CHAPTER — one session, signature recurs across TWO chapters ──

describe("(b) distinct-chapter — a note read across chapters of ONE session counts each", () => {
  it("a growing file folded twice (same signature in two chapters) counts the chapters separately", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };

    // Fold 1: first closed chapter carries the signature → 1.
    const chapter1 = noteReadSegment("s-1");
    const after1 = foldSession(empty, "s-1", chapter1, DOCS, null);
    expect(after1.notes[NOTE_REL]?.chapters).toBe(1);
    expect(after1.sessions["s-1"]?.offset).toBe(3);

    // Fold 2: the file GREW — a SECOND closed chapter (compact-delimited) reading the SAME
    // note. The recurrence unit is the CHAPTER, so even within the same
    // session_id this is a distinct chapter → the count rises to 2 (0.0.11: this is what
    // lets a single continuously-compacted chat accrue recurrence toward graduation).
    const chapter2 = [
      tool("s-1", [`${DOCS}/notes/pay.md`]),
      prompt("s-1", "and again"),
      compact("s-1"),
    ];
    const grown = [...chapter1, ...chapter2];
    const after2 = foldSession(after1, "s-1", grown, DOCS, null);

    expect(after2.notes[NOTE_REL]?.chapters).toBe(2);
    // lastSeen advanced to the later chapter's tail.
    expect((after2.notes[NOTE_REL]?.lastSeen ?? "") > (after1.notes[NOTE_REL]?.lastSeen ?? "")).toBe(true);
    // The offset advanced past the new chapter (never regress).
    expect(after2.sessions["s-1"]?.offset).toBe(grown.length);
  });
});

// ─── (b2) MIN-WORK FLOOR — a trivial chapter does not mint a recurrence unit ───

describe("(b2) min-work floor — a chapter below the work floor is skipped", () => {
  it("a single salient tool_use then an immediate /compact (1 work event) counts nothing", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };
    const trivial = [tool("s-1", [`${DOCS}/notes/pay.md`]), compact("s-1")]; // 1 work event < floor (2)
    const after = foldSession(empty, "s-1", trivial, DOCS, null);
    expect(Object.keys(after.notes)).toHaveLength(0); // floored out
    expect(after.sessions["s-1"]?.offset).toBe(trivial.length); // but offset still advances
  });

  it("the same work in a chapter that CLEARS the floor does count", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };
    const ok = [
      tool("s-1", [`${DOCS}/notes/pay.md`]),
      prompt("s-1", "why does this fail"),
      compact("s-1"),
    ]; // tool + prompt = 2 work events == floor → qualifies
    const after = foldSession(empty, "s-1", ok, DOCS, null);
    expect(after.notes[NOTE_REL]?.chapters).toBe(1);
  });
});

// ─── (b3) VERSION MIGRATION — an older-version tally is discarded on read ──────

describe("(b3) version migration — readTally discards an older-version tally", () => {
  it("an older-version tally is reset to fresh so it re-folds under the current chapter + de-noised-key unit", async () => {
    const dir = await tmpDir();
    await mkdir(join(dir, STATE_DIR, METRICS_DIR), { recursive: true });
    const old = {
      v: 1,
      signatures: {
        "w::k": { sessions: 9, lenses: { correction: 9, failure: 0, workflow: 0, preference: 0 }, wing: "w", keywords: ["k"], lastSeen: "t", hint: "" },
      },
      sessions: { "s-1": { offset: 3, sigs: ["w::k"] } },
    };
    await writeFile(promoteTallyPath(dir), JSON.stringify(old), "utf8");
    expect(await readTally(dir)).toEqual({ v: PROMOTE_VERSION, notes: {}, sessions: {} });
  });
});

// ─── (c) TWO DISTINCT SESSIONS — same signature → sessions === 2 ──────────────

describe("(c) two distinct sessions reading the same note → chapters === 2", () => {
  it("foldSession over two different sessions increments distinct-session count to 2", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };
    const a = foldSession(empty, "s-1", noteReadSegment("s-1"), DOCS, null);
    const b = foldSession(a, "s-2", noteReadSegment("s-2"), DOCS, null);
    expect(b.notes[NOTE_REL]?.chapters).toBe(2);
    expect(b.sessions["s-1"]).toBeDefined();
    expect(b.sessions["s-2"]).toBeDefined();
  });

  it("foldTally over two session files yields sessions === 2", async () => {
    const dir = await tmpDir();
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });
    await writeFile(join(learnings, "s-1.jsonl"), toJsonl(noteReadSegment("s-1", dir)), "utf8");
    await writeFile(join(learnings, "s-2.jsonl"), toJsonl(noteReadSegment("s-2", dir)), "utf8");

    const t = await foldTally(dir, learnings, null);
    expect(t.notes[NOTE_REL]?.chapters).toBe(2);
  });
});

// ─── (d) PURGE-SURVIVAL — global counts persist after a session-fold is pruned ─

describe("(d) purge-survival — note-read counts survive a pruned session fold", () => {
  it("foldTally prunes a vanished session's fold but keeps its global contribution", async () => {
    const dir = await tmpDir();
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });
    const f1 = join(learnings, "s-1.jsonl");
    const f2 = join(learnings, "s-2.jsonl");
    await writeFile(f1, toJsonl(noteReadSegment("s-1", dir)), "utf8");
    await writeFile(f2, toJsonl(noteReadSegment("s-2", dir)), "utf8");

    // First pass: both sessions contribute → sessions === 2, both fold entries present.
    const pass1 = await foldTally(dir, learnings, null);
    await writeTally(dir, pass1);
    expect(pass1.notes[NOTE_REL]?.chapters).toBe(2);
    expect(pass1.sessions["s-1"]).toBeDefined();
    expect(pass1.sessions["s-2"]).toBeDefined();

    // s-1's `.learnings` file PURGES (aged out). Re-fold.
    await unlink(f1);
    const pass2 = await foldTally(dir, learnings, null);

    // The global signature count SURVIVES the purge (still 2 distinct sessions).
    expect(pass2.notes[NOTE_REL]?.chapters).toBe(2);
    // But s-1's prunable fold-memory is gone; s-2's persists.
    expect(pass2.sessions["s-1"]).toBeUndefined();
    expect(pass2.sessions["s-2"]).toBeDefined();
  });
});

// ─── never-regress offset + multi-pass closing session ────────────────────────

describe("never-regress offset", () => {
  it("a later fold with a shrunk closed region never lowers the offset", () => {
    const empty: PromoteTally = { v: PROMOTE_VERSION, notes: {}, sessions: {} };
    const full = noteReadSegment("s-1"); // closedCount === 3
    const after = foldSession(empty, "s-1", full, DOCS, null);
    expect(after.sessions["s-1"]?.offset).toBe(3);

    // A degenerate re-read with NO terminator (closedCount 0) must not regress.
    const noTerminator = [tool("s-1", ["payments/x.ts"]), prompt("s-1", "validate the webhook idempotency")];
    const after2 = foldSession(after, "s-1", noTerminator, DOCS, null);
    expect(after2.sessions["s-1"]?.offset).toBe(3);
    expect(after2.notes[NOTE_REL]?.chapters).toBe(1);
  });
});

// ─── foldTally — sidecar / archive exclusion + fail-open ──────────────────────

describe("foldTally — fs orchestration", () => {
  it("ignores *.skills.jsonl sidecars and the .archive dir", async () => {
    const dir = await tmpDir();
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(join(learnings, ".archive"), { recursive: true });
    await writeFile(join(learnings, "s-1.jsonl"), toJsonl(noteReadSegment("s-1", dir)), "utf8");
    await writeFile(join(learnings, "s-1.skills.jsonl"), toJsonl(noteReadSegment("s-1", dir)), "utf8");
    await writeFile(join(learnings, ".archive", "s-old.jsonl"), toJsonl(noteReadSegment("s-old", dir)), "utf8");

    const t = await foldTally(dir, learnings, null);
    // Only the single full stream contributes (sidecar + archive excluded).
    expect(t.notes[NOTE_REL]?.chapters).toBe(1);
    expect(Object.keys(t.sessions)).toEqual(["s-1"]);
    expect(t.sessions["s-1.skills"]).toBeUndefined();
  });

  it("skips torn lines and an empty learnings dir (fail-open)", async () => {
    const dir = await tmpDir();
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });
    const body = "{ garbage\n" + toJsonl(noteReadSegment("s-1", dir)) + "also not json\n";
    await writeFile(join(learnings, "s-1.jsonl"), body, "utf8");

    const t = await foldTally(dir, learnings, null);
    expect(t.notes[NOTE_REL]?.chapters).toBe(1);
  });

  it("returns a fresh empty tally when the learnings dir does not exist", async () => {
    const dir = await tmpDir();
    const t = await foldTally(dir, join(dir, STATE_DIR, LEARNINGS_DIR), null);
    expect(t).toEqual({ v: PROMOTE_VERSION, notes: {}, sessions: {} });
  });
});
