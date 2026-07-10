import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../../test/fixtures/kb.js";
import { readStagedDrafts } from "../../grooming/staging.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../../observe/events.js";
import type { ObserveEvent } from "../../observe/types.js";
import { learningsPath, stagingPath } from "../../paths.js";
import { emitNudge, nudgeCmd } from "./nudge.js";

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
      expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null, notice: null });
    }
  });

  it("fires on startup and resume — surfacing the last-closed chapter's digest + the backlog line (ADR-0030 amendment)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // one CLOSED, unmined chapter
    for (const source of ["startup", "resume"]) {
      const r = await nudgeCmd({ cwd: dir, source, force: true });
      expect(r.ran).toBe(true);
      // The digest now surfaces at session entry too (a session_end closed the chapter), with the
      // offer-first entry note, alongside the backlog line.
      expect(r.nudge).not.toBeNull();
      expect(r.nudge).toContain("Raw material, NOT lessons"); // the digest banner IS present now
      expect(r.nudge).toContain("(session start)"); // the offer-first entry note
      expect(r.nudge).toContain("1 chapter unmined");
      expect(r.nudge).toContain("mage:groom");
    }
  });

  it("no-ops (fail-open) when there is no knowledge base", async () => {
    const empty = await tmpDir("mage-nudge-nokb-");
    const r = await nudgeCmd({ cwd: empty, source: "compact" });
    expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null, notice: null });
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
    expect(r.notice).toBeNull(); // nothing for the human to see either
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
  it("operator (default) tells the agent to ASK the user — no autonomous-write authorization", async () => {
    const { dir, root } = await withKb({ grooming: { autonomy: "operator" } });
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).toContain("autonomy: operator");
    expect(r.nudge).toContain("ASK");
    expect(r.nudge).toContain("mage:learn"); // offers single-insight capture too
    expect(r.nudge).not.toContain("authorized");
  });

  it("approver authorizes grooming + uncommitted durable-note writes with Gate-2", async () => {
    const { dir, root } = await withKb({ grooming: { autonomy: "approver" } });
    await seedChapter(learningsPath(root), "s1", "alpha");
    // The autonomy-scaled mandate applies at a `compact` boundary; session ENTRY is always
    // offer-first regardless of level (ADR-0030 amendment §4), tested separately below.
    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
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
    // Full-autonomy mandate is a `compact`-boundary behaviour; entry is offer-first (§4, tested below).
    const r = await nudgeCmd({ cwd: dir, source: "compact", force: true });
    expect(r.nudge).toContain("autonomy: overseer");
    expect(r.nudge).toContain("dispose");
    expect(r.nudge).toContain("graduate");
    // ADR-0030 §1 lists merge as an Overseer job — the mandate must tell the agent to merge.
    expect(r.nudge).toContain("merge related lessons into existing notes");
    expect(r.nudge).toContain("UNCOMMITTED");
  });
});

describe("mage nudge — startup digest (ADR-0030 amendment)", () => {
  it("session entry is offer-first even at overseer — drops to the operator mandate (§4)", async () => {
    const { dir, root } = await withKb({ grooming: { autonomy: "overseer" } });
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    // Configured overseer, but session entry never authorizes autonomous grooming.
    expect(r.nudge).toContain("autonomy: operator");
    expect(r.nudge).not.toContain("dispose");
    expect(r.nudge).not.toContain("UNCOMMITTED");
    expect(r.nudge).toContain("(session start)"); // the offer-first entry note is present
  });

  it("prints a deterministic, UNRANKED chapter teaser to the user-visible notice (§3)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // 1 failure + 1 correction
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    // Source-neutral, plain-language, counts-only.
    expect(r.notice).toContain("mage · recent work:");
    expect(r.notice).toContain("1 error"); // "failures" surface as plain "errors"
    expect(r.notice).toContain("1 correction");
    expect(r.notice).toContain("mage:learn"); // the actionable command in the guaranteed channel
    // counts only — the teaser must NOT surface the failure text (mage narrows, it never ranks).
    expect(r.notice).not.toContain("alpha tests failed");
  });

  it("shows the last-closed chapter's digest once, then de-dupes it on the next entry", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    // No `force` → the once-per-chapter watermark governs (force would bypass the de-dup).
    const first = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(first.nudge).toContain("Raw material, NOT lessons"); // digest surfaced
    const second = await nudgeCmd({ cwd: dir, source: "startup" });
    // Same chapter → digest not re-shown; the backlog is also within its throttle window now,
    // so this entry surfaces nothing at all.
    expect(second.nudge).toBeNull();
  });

  it("a compact-shown chapter is not re-shown at the next session entry (shared watermark)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    const onCompact = await nudgeCmd({ cwd: dir, source: "compact" });
    expect(onCompact.nudge).toContain("Raw material, NOT lessons");
    const onEntry = await nudgeCmd({ cwd: dir, source: "startup" });
    // The compact path stamped the watermark; the startup path must honour it (and the backlog is
    // now within its throttle window too, so this entry surfaces nothing at all).
    expect(onEntry.nudge ?? "").not.toContain("Raw material, NOT lessons");
  });

  it("a new closed session after one was shown surfaces on the next entry (cache miss re-reads)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    const first = await nudgeCmd({ cwd: dir, source: "startup" }); // no force → real cache path
    expect(first.notice).toContain("mage · recent work:");
    // A brand-new session file closes another (later) chapter → the scratch fingerprint changes →
    // the shared scan is a cache MISS → it re-reads and the newer chapter surfaces.
    await seedChapter(learningsPath(root), "s2", "betazoid");
    const second = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(second.notice).toContain("mage · recent work:");
    expect(second.nudge).toContain("betazoid"); // the newer chapter's digest, not the stale one
  });

  it("a no-signal closed chapter surfaces no digest and no teaser at entry", async () => {
    const { dir, root } = await withKb();
    const learnings = learningsPath(root);
    await mkdir(learnings, { recursive: true });
    // A CLOSED chapter (session_end terminator) with only benign, non-signal activity.
    await writeFile(
      join(learnings, "s1.jsonl"),
      toJsonl([
        buildUserPrompt(base("s1"), "just poking around"),
        buildToolUse(base("s1"), { tool: "Read", paths: ["a.ts"], detail: "read a.ts", ok: true, error_summary: null }),
        buildSessionEnd(base("s1")),
      ]),
      "utf8",
    );
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.nudge).not.toContain("Raw material, NOT lessons");
    expect(r.notice ?? "").not.toContain("mage · last session:");
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

describe("mage nudge — user-visible notice (systemMessage)", () => {
  it("surfaces a terminal-visible notice when the backlog reminder fires", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.notice).not.toBeNull();
    expect(r.notice).toContain("mage:groom"); // file them
    expect(r.notice).toContain("mage:learn"); // or capture one
  });
});

describe("mage nudge — compact bypasses the backlog throttle (resume→compact pattern)", () => {
  it("a `resume` arms the throttle and mutes a following resume, but `compact` still surfaces the backlog", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // one closed, unmined chapter = backlog

    // First resume: never reminded → shows the backlog line AND arms the 4h throttle.
    const first = await nudgeCmd({ cwd: dir, source: "resume" });
    expect(first.notice).not.toBeNull();
    expect(first.notice).toContain("mage:groom");

    // A second resume moments later is inside the window → throttled, nothing user-visible.
    const throttled = await nudgeCmd({ cwd: dir, source: "resume" });
    expect(throttled.notice).toBeNull();

    // A compact is a real chapter boundary → it BYPASSES the throttle and still surfaces the backlog,
    // so the morning resume→compact pattern can no longer eat the compact's nudge.
    const compact = await nudgeCmd({ cwd: dir, source: "compact" });
    expect(compact.notice).not.toBeNull();
    expect(compact.notice).toContain("mage:groom");
  });
});

describe("mage nudge — weekly dream-health tick", () => {
  it("folds a rot summary into BOTH channels and tells the agent to OFFER `mage dream`", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // a backlog so the reminder fires alongside
    // A stale (no last_reviewed), orphaned (no links) note → analyzeDream reports rot (not clean).
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "lonely.md"), "---\ntags: [w/r]\n---\n# Lonely\n", "utf8");

    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    // user channel (systemMessage): the terse health line the human sees.
    expect(r.notice).toContain("mage health");
    // model channel (additionalContext): the agent is told to OFFER the read-only scan, not just see it.
    expect(r.nudge).toContain("mage dream");
    expect(r.nudge).toContain("offer to run");
  });

  it("stays silent on health when the KB is clean (no rot to report)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    // No notes ⇒ analyzeDream is clean ⇒ no health line on either channel.
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.notice).not.toContain("mage health");
    expect(r.nudge).not.toContain("mage dream");
  });
});

describe("emitNudge — the two-channel SessionStart contract", () => {
  function capture(fn: () => void): string {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    fn();
    spy.mockRestore();
    return writes.join("");
  }

  it("emits the user-visible systemMessage AND the model-only additionalContext", () => {
    const out = JSON.parse(capture(() => emitNudge("see me", "context for the model")));
    expect(out).toEqual({
      systemMessage: "see me",
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "context for the model" },
    });
  });

  it("emits additionalContext alone when there is no user notice", () => {
    const out = JSON.parse(capture(() => emitNudge(null, "model only")));
    expect(out).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "model only" },
    });
    expect(out.systemMessage).toBeUndefined();
  });

  it("writes nothing when both channels are empty", () => {
    expect(capture(() => emitNudge(null, null))).toBe("");
    expect(capture(() => emitNudge("", ""))).toBe("");
  });
});
