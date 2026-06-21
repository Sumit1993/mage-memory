import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { readStagedDrafts } from "../grooming/staging.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import { learningsPath, stagingPath } from "../paths.js";
import { emitAdditionalContext, nudgeCmd } from "./nudge.js";

afterEach(() => {
  vi.restoreAllMocks();
});

let clock = 0;
function base(session: string): EventBase {
  clock += 1;
  return { ts: new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString(), session };
}
function toJsonl(events: ObserveEvent[]): string {
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

/** A CLOSED chapter (terminated by session_end) carrying a correction + a failure. */
async function seedChapter(learnings: string, session: string, topic: string): Promise<void> {
  const events: ObserveEvent[] = [
    buildUserPrompt(base(session), `add the ${topic} flow`),
    buildToolUse(base(session), {
      tool: "Edit",
      paths: [`${topic}.ts`],
      detail: `edit ${topic}.ts`,
      ok: true,
      error_summary: null,
    }),
    buildUserPrompt(base(session), `no, reuse the existing ${topic} helper instead`),
    buildToolUse(base(session), {
      tool: "Bash",
      paths: [],
      detail: `test ${topic}`,
      ok: false,
      error_summary: `${topic} tests failed: 2 red`,
    }),
    buildSessionEnd(base(session)),
  ];
  await mkdir(learnings, { recursive: true });
  await writeFile(join(learnings, `${session}.jsonl`), toJsonl(events), "utf8");
}

/** Seed `n` back-to-back CLOSED chapters (each a session_end-terminated work segment) in one stream. */
async function seedClosedChapters(learnings: string, session: string, n: number): Promise<void> {
  const events: ObserveEvent[] = [];
  for (let i = 0; i < n; i++) {
    events.push(buildUserPrompt(base(session), `work item ${i}`));
    events.push(
      buildToolUse(base(session), { tool: "Bash", paths: [], detail: `step ${i}`, ok: true, error_summary: null }),
    );
    events.push(buildSessionEnd(base(session)));
  }
  await mkdir(learnings, { recursive: true });
  await writeFile(join(learnings, `${session}.jsonl`), toJsonl(events), "utf8");
}

describe("mage nudge — gating", () => {
  it("does nothing on `clear` or a missing source (ADR-0030: clear is excluded)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    for (const source of ["clear", undefined]) {
      const r = await nudgeCmd({ cwd: dir, source });
      expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null });
    }
  });

  it("fires on startup and resume — surfacing the backlog reminder, not the fresh digest (ADR-0030)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // one CLOSED, unmined chapter
    for (const source of ["startup", "resume"]) {
      const r = await nudgeCmd({ cwd: dir, source, force: true });
      expect(r.ran).toBe(true);
      // startup/resume carry no fresh chapter → no digest banner, just the backlog line.
      expect(r.nudge).not.toBeNull();
      expect(r.nudge).not.toContain("Raw material, NOT lessons");
      expect(r.nudge).toContain("1 chapter unmined");
      expect(r.nudge).toContain("mage:groom");
    }
  });

  it("no-ops (fail-open) when there is no knowledge base", async () => {
    const empty = await tmpDir("mage-nudge-nokb-");
    const r = await nudgeCmd({ cwd: empty, source: "compact" });
    expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null });
  });
});

describe("mage nudge — digest path (ADR-0029)", () => {
  it("on compact, surfaces the just-closed chapter's earned-signal DIGEST and writes NO drafts", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });

    expect(r.ran).toBe(true);
    expect(r.drafted).toBe(0); // the digest path never drafts
    expect(r.nudge).toContain("Raw material, NOT lessons"); // the non-claim banner
    expect(r.nudge).toContain("Corrections"); // the seeded correction surfaced
    expect(r.nudge).toContain("reuse the existing alpha helper");
    // .mage/staging/ stays empty — only agent-initiated `mage stage` writes there.
    expect(await readStagedDrafts(stagingPath(root))).toHaveLength(0);
  });

  it("surfaces the most-recently-closed chapter across sessions", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // earlier ts
    await seedChapter(learningsPath(root), "s2", "betazoid"); // later ts wins

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.nudge).toContain("betazoid");
    expect(r.nudge).not.toContain("alpha");
  });

  it("emits nothing when no chapter has closed and nothing is pending", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });
    // An OPEN chapter (no terminator) → nothing closed to digest.
    await writeFile(
      join(learnings, "s1.jsonl"),
      toJsonl([
        buildUserPrompt(base("s1"), "start the work"),
        buildToolUse(base("s1"), { tool: "Bash", paths: [], detail: "npm test", ok: true, error_summary: null }),
      ]),
      "utf8",
    );
    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.ran).toBe(true);
    expect(r.nudge).toBeNull();
  });

  it("a secret in observed scratch never reaches the digest (nudge re-scrubs)", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });
    // RAW scratch (bypassing capture-time scrub) so the nudge's OWN scrub is the only defense.
    const events: ObserveEvent[] = [
      buildToolUse(base("s"), { tool: "Bash", paths: [], detail: "deploy", ok: true, error_summary: null }),
      buildUserPrompt(base("s"), "the key is AKIAIOSFODNN7EXAMPLE — rotate it and never commit it"),
      buildToolUse(base("s"), {
        tool: "Bash",
        paths: [],
        detail: "deploy",
        ok: false,
        error_summary: "auth failed: AKIAIOSFODNN7EXAMPLE rejected by the provider",
      }),
      buildSessionEnd(base("s")),
    ];
    await writeFile(join(learnings, "s.jsonl"), toJsonl(events), "utf8");

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.nudge).not.toBeNull();
    expect(r.nudge).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.nudge).toContain("[REDACTED:");
  });
});

describe("mage nudge — autonomy-scaled backlog mandate (ADR-0030)", () => {
  it("operator (default) prints a plain `mage:groom` reminder, no autonomous-write authorization", async () => {
    const { dir, root } = await withKb({ grooming: { autonomy: "operator" } });
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).toContain("autonomy: operator");
    expect(r.nudge).toContain("Review with `mage:groom`");
    expect(r.nudge).not.toContain("authorized");
  });

  it("approver authorizes grooming + uncommitted durable-note writes with Gate-2", async () => {
    const { dir, root } = await withKb({ grooming: { autonomy: "approver" } });
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).toContain("autonomy: approver");
    expect(r.nudge).toContain("authorized");
    expect(r.nudge).toContain("UNCOMMITTED");
    expect(r.nudge).toContain("Gate-2");
    // The approver mandate stops at writing durable notes — no graduation authorization.
    expect(r.nudge).not.toContain("mage:graduate");
    expect(r.nudge).not.toContain("dispose");
  });

  it("overseer adds dispose-borderline + graduate", async () => {
    const { dir, root } = await withKb({ grooming: { autonomy: "overseer" } });
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).toContain("autonomy: overseer");
    expect(r.nudge).toContain("dispose");
    expect(r.nudge).toContain("graduate");
    // ADR-0030 §1 lists merge as an Overseer job — the mandate must tell the agent to merge.
    expect(r.nudge).toContain("merge related lessons into existing notes");
    expect(r.nudge).toContain("UNCOMMITTED");
  });
});

describe("mage nudge — capped backlog tally (ADR-0030 §2)", () => {
  it("counts unmined closed chapters and caps the count at 9+", async () => {
    const { dir, root } = await withKb();
    await seedClosedChapters(learningsPath(root), "s1", 12); // 12 closed chapters, none mined
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).toContain("9+ chapters unmined");
    expect(r.nudge).not.toContain("12 chapters unmined");
  });

  it("renders an exact (sub-cap) unmined count", async () => {
    const { dir, root } = await withKb();
    await seedClosedChapters(learningsPath(root), "s1", 3);
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).toContain("3 chapters unmined");
  });

  it("renders the graduable part as an upper bound, not an exact count", async () => {
    const { dir, root } = await withKb();
    await seedClosedChapters(learningsPath(root), "s1", 3);
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    // graduableTally is a documented UPPER BOUND (backlog.ts) — the phrasing must say "up to … eligible",
    // never the exact-reading "N notes ready to graduate".
    expect(r.nudge).toContain("eligible to graduate");
    expect(r.nudge).not.toContain("ready to graduate");
  });
});

describe("emitAdditionalContext", () => {
  it("writes the SessionStart hookSpecificOutput JSON contract", () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    emitAdditionalContext("hello world");
    spy.mockRestore();
    const out = JSON.parse(writes.join(""));
    expect(out).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "hello world" },
    });
  });
});
