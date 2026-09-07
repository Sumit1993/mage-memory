import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir, withKb } from "../../../test/fixtures/kb.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../../observe/events.js";
import type { GuardFiredEvent, ObserveEvent } from "../../observe/types.js";
import { learningsPath } from "../../paths.js";
import { nudgeCmd } from "./nudge.js";
import {
  computeReceipt,
  formatReceipt,
  readSessionEvents,
} from "./receipt.js";

let clock = 0;
function base(session: string): EventBase {
  clock += 1;
  return { ts: new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString(), session };
}

function toJsonl(events: ObserveEvent[]): string {
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

function guardFired(session: string, guardId = "kit/guard/no-haiku"): GuardFiredEvent {
  clock += 1;
  return {
    v: 1,
    ts: new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString(),
    session,
    type: "guard_fired",
    guard_id: guardId,
    tool: "Agent",
    detail: "model=haiku",
  };
}

describe("session receipt: Stop hook", () => {
  it("all four counts 0 -> prints nothing", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });

    // Benign events: no guard fired, no corrections, no failures
    const events: ObserveEvent[] = [
      buildUserPrompt(base("s1"), "hello world"),
      buildToolUse(base("s1"), { tool: "Read", paths: ["a.ts"], detail: "read file", ok: true, error_summary: null }),
      buildSessionEnd(base("s1")),
    ];
    await writeFile(join(learnings, "s1.jsonl"), toJsonl(events), "utf8");

    const r = await nudgeCmd({ cwd: dir, hookEventName: "Stop", sessionId: "s1" });
    expect(r.ran).toBe(true);
    expect(r.notice).toBeNull();
    expect(r.nudge).toBeNull();
  });

  it("each count appears with correct value", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });

    const events: ObserveEvent[] = [
      // 1. Guard fired (counts for denied and guard fires)
      guardFired("s1", "sec/guard/no-creds"),
      // 2. Tool use followed by substantive correction
      buildToolUse(base("s1"), { tool: "Edit", paths: ["config.ts"], detail: "edit config", ok: true, error_summary: null }),
      buildUserPrompt(base("s1"), "no, do not edit config, use env vars instead"),
      // 3. Two tool failures with different skeletons (2 new signatures)
      buildToolUse(base("s1"), { tool: "Bash", paths: [], detail: "test", ok: false, error_summary: "connection refused at 127.0.0.1:8080" }),
      buildToolUse(base("s1"), { tool: "Bash", paths: [], detail: "build", ok: false, error_summary: "type error in src/main.ts line 10" }),
      // A duplicate skeleton that should collapse with the first failure
      buildToolUse(base("s1"), { tool: "Bash", paths: [], detail: "test retry", ok: false, error_summary: "connection refused at 127.0.0.1:9090" }),
      // A protocol failure that should be ignored
      buildToolUse(base("s1"), { tool: "Edit", paths: ["a.ts"], detail: "edit", ok: false, error_summary: "File has not been read yet" }),
      // Another guard fired
      guardFired("s1", "kit/guard/no-haiku"),
    ];
    await writeFile(join(learnings, "s1.jsonl"), toJsonl(events), "utf8");

    const r = await nudgeCmd({ cwd: dir, hookEventName: "Stop", sessionId: "s1" });
    expect(r.ran).toBe(true);
    // 2 guard fires -> 2 denied and 2 guard fires
    // 1 correction
    // 2 distinct failure skeletons
    expect(r.notice).toBe("mage: 2 denied · 1 corrected · 2 new signatures · 2 guard fires");
    expect(r.nudge).toBeNull();
  });

  it("missing KB -> prints nothing, exit 0", async () => {
    const empty = await tmpDir("mage-receipt-nokb-");
    const r = await nudgeCmd({ cwd: empty, hookEventName: "Stop", sessionId: "s1" });
    expect(r.ran).toBe(false);
    expect(r.notice).toBeNull();
    expect(r.nudge).toBeNull();
  });

  it("events from other sessions are ignored (session-scoped)", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });

    // Session s1 has clean events
    const s1Events: ObserveEvent[] = [
      buildUserPrompt(base("s1"), "working in session 1"),
      buildToolUse(base("s1"), { tool: "Read", paths: ["a.ts"], detail: "read", ok: true, error_summary: null }),
    ];
    await writeFile(join(learnings, "s1.jsonl"), toJsonl(s1Events), "utf8");

    // Session s2 has guard fires, corrections, and failures
    const s2Events: ObserveEvent[] = [
      guardFired("s2", "sec/guard/no-eval"),
      buildToolUse(base("s2"), { tool: "Edit", paths: ["b.ts"], detail: "edit", ok: true, error_summary: null }),
      buildUserPrompt(base("s2"), "wrong, revert this change immediately"),
      buildToolUse(base("s2"), { tool: "Bash", paths: [], detail: "test", ok: false, error_summary: "syntax error unexpected token" }),
    ];
    await writeFile(join(learnings, "s2.jsonl"), toJsonl(s2Events), "utf8");

    // Querying s1 ignores s2 completely
    const r1 = await nudgeCmd({ cwd: dir, hookEventName: "Stop", sessionId: "s1" });
    expect(r1.ran).toBe(true);
    expect(r1.notice).toBeNull();

    // Querying s2 sees only s2
    const r2 = await nudgeCmd({ cwd: dir, hookEventName: "Stop", sessionId: "s2" });
    expect(r2.ran).toBe(true);
    expect(r2.notice).toBe("mage: 1 denied · 1 corrected · 1 new signatures · 1 guard fires");
  });

  it("source=stop acts as Stop hook event", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });

    const events: ObserveEvent[] = [guardFired("s-alt")];
    await writeFile(join(learnings, "s-alt.jsonl"), toJsonl(events), "utf8");

    const r = await nudgeCmd({ cwd: dir, source: "stop", sessionId: "s-alt" });
    expect(r.ran).toBe(true);
    expect(r.notice).toBe("mage: 1 denied · 0 corrected · 0 new signatures · 1 guard fires");
  });
});

describe("pure receipt computation and formatting", () => {
  it("formatReceipt returns null when all counts are zero", () => {
    expect(formatReceipt({ denied: 0, corrected: 0, newSignatures: 0, guardFires: 0 })).toBeNull();
  });

  it("formatReceipt formats non-zero counts in exact order", () => {
    const formatted = formatReceipt({ denied: 1, corrected: 2, newSignatures: 3, guardFires: 4 });
    expect(formatted).toBe("mage: 1 denied · 2 corrected · 3 new signatures · 4 guard fires");
  });

  it("computeReceipt ignores continuation prompts without tool_use/assistant_msg predecessor", () => {
    const events: ObserveEvent[] = [
      buildUserPrompt(base("s1"), "first prompt"),
      buildUserPrompt(base("s1"), "no, rather use this instead"), // followed another prompt, not tool_use/assistant_msg
    ];
    const counts = computeReceipt(events);
    expect(counts.corrected).toBe(0);
  });

  it("readSessionEvents returns empty array on missing directory or session", async () => {
    const empty = await tmpDir("mage-read-empty-");
    expect(await readSessionEvents(empty, "")).toEqual([]);
    expect(await readSessionEvents(empty, "nope")).toEqual([]);
  });
});
