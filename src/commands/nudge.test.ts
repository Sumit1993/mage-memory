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

/** A CLOSED chapter (terminated by session_end) carrying a correction + a failure —
 *  distinct per `topic` so distinct chapters don't dedup into one draft. */
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

describe("mage nudge — boundary distill → staging", () => {
  it("on compact, distills the closed chapter and drafts a lesson into .mage/staging/", async () => {
    const { dir, mage, learnings } = await makeKb();
    await seedChapter(learnings, "s1", "alpha");

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });

    expect(r.ran).toBe(true);
    expect(r.drafted).toBeGreaterThanOrEqual(1);
    expect(r.pending).toBe(r.drafted);
    expect(r.nudge).toContain("mage:groom");

    const drafts = await readStagedDrafts(stagingPath(mage));
    expect(drafts).toHaveLength(r.drafted);
    expect(drafts[0]?.body).toContain("Drafted by mage at a session boundary");
    expect(drafts[0]?.frontmatter.type).toBe("gotcha");
  });

  it("re-running drafts nothing new (the staged batch dedups it)", async () => {
    const { dir, learnings } = await makeKb();
    await seedChapter(learnings, "s1", "alpha");

    const first = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(first.drafted).toBeGreaterThanOrEqual(1);

    const second = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(second.drafted).toBe(0); // already staged → deduped, never re-drafted
    expect(second.pending).toBe(first.pending); // no growth
  });

  it("caps newly-drafted lessons at the staging budget", async () => {
    const { dir, learnings } = await makeKb();
    // Five distinct chapters → five distinct candidate clusters.
    for (const i of [1, 2, 3, 4, 5]) await seedChapter(learnings, `s${i}`, `topic${i}`);

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.drafted).toBe(3); // BASE_THRESHOLDS.stagingBudget; the rest defer
  });

  it("does not silently drop two distinct chapters that share a generic lead (collision guard)", async () => {
    const { dir, mage, learnings } = await makeKb();
    // Two sessions whose most-salient signal is IDENTICAL text → identical title-derived
    // dedup key. The stable per-cluster slug must still yield TWO distinct drafts.
    for (const s of ["s1", "s2"]) {
      const events: ObserveEvent[] = [
        buildUserPrompt(base(s), "start"),
        buildToolUse(base(s), { tool: "Read", paths: ["x.ts"], detail: "read x", ok: true, error_summary: null }),
        buildUserPrompt(base(s), "no, use the shared helper"), // identical correction in both
        buildSessionEnd(base(s)),
      ];
      await writeFile(join(learnings, `${s}.jsonl`), toJsonl(events), "utf8");
    }

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.drafted).toBe(2); // both distinct chapters drafted, not collapsed to one
    expect(await readStagedDrafts(stagingPath(mage))).toHaveLength(2);
  });

  it("a secret in observed scratch never reaches the staged draft (nudge re-scrubs)", async () => {
    const { dir, mage, learnings } = await makeKb();
    // Write RAW scratch (bypassing capture-time scrub) so the nudge's OWN scrub is the
    // only defense — a planted AWS key must not survive into the draft.
    const events: ObserveEvent[] = [
      buildUserPrompt(base("s"), "the key is AKIAIOSFODNN7EXAMPLE — do not commit it"),
      buildToolUse(base("s"), {
        tool: "Bash",
        paths: [],
        detail: "deploy",
        ok: false,
        error_summary: "AKIAIOSFODNN7EXAMPLE rejected",
      }),
      buildSessionEnd(base("s")),
    ];
    await writeFile(join(learnings, "s.jsonl"), toJsonl(events), "utf8");

    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.drafted).toBeGreaterThanOrEqual(1);
    const drafts = await readStagedDrafts(stagingPath(mage));
    const allText = drafts.map((d) => `${d.title}\n${d.body}`).join("\n");
    expect(allText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(allText).toContain("[REDACTED:");
  });
});

describe("mage nudge — anti-nag throttle", () => {
  it("throttles a pending-only reminder but always surfaces a fresh draft", async () => {
    const { dir, learnings } = await makeKb();
    await seedChapter(learnings, "s1", "alpha");

    // First compact: a fresh draft → always surfaced (no throttle on new work).
    const first = await nudgeCmd({ cwd: dir, source: "compact" });
    expect(first.drafted).toBeGreaterThanOrEqual(1);
    expect(first.nudge).not.toBeNull();

    // Second compact: nothing new (deduped) AND the window has not elapsed → silent.
    const second = await nudgeCmd({ cwd: dir, source: "compact" });
    expect(second.drafted).toBe(0);
    expect(second.nudge).toBeNull();

    // force bypasses the throttle (still surfaces the pending batch).
    const forced = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(forced.nudge).not.toBeNull();
    expect(forced.nudge).toContain("pending");
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
