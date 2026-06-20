import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStagedDrafts } from "../grooming/staging.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import { stagingPath } from "../paths.js";
import { emitAdditionalContext, nudgeCmd } from "./nudge.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** An in-repo KB at `<dir>/mage` with an empty `.mage/learnings/`. */
async function makeKb(): Promise<{ dir: string; mage: string; learnings: string }> {
  const dir = await mkdtemp(join(tmpdir(), "mage-nudge-"));
  made.push(dir);
  const mage = join(dir, "mage");
  await mkdir(join(mage, "notes"), { recursive: true });
  await writeFile(
    join(mage, "metadata.json"),
    `${JSON.stringify({ schema: "mage.v2", mode: "in-repo", project: "t" })}\n`,
  );
  const learnings = join(mage, ".mage", "learnings");
  await mkdir(learnings, { recursive: true });
  return { dir, mage, learnings };
}

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
  await writeFile(join(learnings, `${session}.jsonl`), toJsonl(events), "utf8");
}

describe("mage nudge — gating", () => {
  it("does nothing unless the SessionStart source is compact", async () => {
    const { dir, learnings } = await makeKb();
    await seedChapter(learnings, "s1", "alpha");
    for (const source of ["startup", "resume", "clear", undefined]) {
      const r = await nudgeCmd({ cwd: dir, source });
      expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null });
    }
  });

  it("no-ops (fail-open) when there is no knowledge base", async () => {
    const empty = await mkdtemp(join(tmpdir(), "mage-nudge-nokb-"));
    made.push(empty);
    const r = await nudgeCmd({ cwd: empty, source: "compact" });
    expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null });
  });
});

describe("mage nudge — digest path (ADR-0029)", () => {
  it("on compact, surfaces the just-closed chapter's earned-signal DIGEST and writes NO drafts", async () => {
    const { dir, mage, learnings } = await makeKb();
    await seedChapter(learnings, "s1", "alpha");

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });

    expect(r.ran).toBe(true);
    expect(r.drafted).toBe(0); // the digest path never drafts
    expect(r.nudge).toContain("Raw material, NOT lessons"); // the non-claim banner
    expect(r.nudge).toContain("Corrections"); // the seeded correction surfaced
    expect(r.nudge).toContain("reuse the existing alpha helper");
    // .mage/staging/ stays empty — only agent-initiated `mage stage` writes there.
    expect(await readStagedDrafts(stagingPath(mage))).toHaveLength(0);
  });

  it("surfaces the most-recently-closed chapter across sessions", async () => {
    const { dir, learnings } = await makeKb();
    await seedChapter(learnings, "s1", "alpha"); // earlier ts
    await seedChapter(learnings, "s2", "betazoid"); // later ts wins

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.nudge).toContain("betazoid");
    expect(r.nudge).not.toContain("alpha");
  });

  it("emits nothing when no chapter has closed and nothing is pending", async () => {
    const { dir, learnings } = await makeKb();
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
    const { dir, learnings } = await makeKb();
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
