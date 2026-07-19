import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { type GroomingConfig, learningsPath } from "../paths.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import type { PromoteManifest } from "../grooming/types.js";
import { readTally } from "../grooming/tally.js";
import { writeRejected } from "../grooming/proposals.js";
import { promoteCmd } from "./promote-cmd.js";

// ─── tmp fixture plumbing (mirrors distill-cmd.test.ts) ───────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

/** A docs root with a `mage/metadata.json` so resolveDocsRoot finds an in-repo KB. */
async function tmpRepo(grooming?: GroomingConfig): Promise<{
  repo: string;
  docsRoot: string;
  learnings: string;
}> {
  const kb = await withKb({ kind: "repo", schema: 1, grooming });
  const learnings = learningsPath(kb.root);
  await mkdir(learnings, { recursive: true }); // fixture does not pre-create .mage/learnings
  return { repo: kb.dir, docsRoot: kb.root, learnings };
}

let clock = 0;
function base(session: string): EventBase {
  clock += 1;
  return { ts: new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString(), session };
}
function toJsonl(events: ObserveEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * Seed one session whose CLOSED region carries a correction signature: a tool_use then
 * a user_prompt (→ correction lens, keyed by the prompt text), ended by session_end.
 * Every session uses the SAME prompt text → the SAME signature key → distinct-session
 * recurrence.
 */
async function seedCorrection(learnings: string, session: string, prompt: string): Promise<void> {
  // The tool_use is deliberately NON-salient (no paths, no detail, ok) so it produces
  // no preference/workflow signature of its own — it only sets the correction
  // antecedent. The single signature the region yields is the correction keyed by the
  // prompt text, so the SAME prompt across sessions is the SAME signature key.
  const events: ObserveEvent[] = [
    buildToolUse(base(session), { tool: "Read", paths: [], detail: null, ok: true, error_summary: null }),
    buildUserPrompt(base(session), prompt),
    buildSessionEnd(base(session)),
  ];
  await writeFile(join(learnings, `${session}.jsonl`), toJsonl(events), "utf8");
}

const PROMPT = "always validate webhook signature before processing payload";

/**
 * Seed one session whose CLOSED region READS a note under the docs root — the ADR-0038
 * graduation signal. The prompt is there so the chapter clears MIN_CHAPTER_WORK_EVENTS.
 */
async function seedNoteRead(
  learnings: string,
  session: string,
  docsRoot: string,
  rel = "notes/pay.md",
): Promise<void> {
  const events: ObserveEvent[] = [
    buildToolUse(base(session), {
      tool: "Read",
      paths: [join(docsRoot, rel)],
      detail: null,
      ok: true,
      error_summary: null,
    }),
    buildUserPrompt(base(session), "why does this fail"),
    buildSessionEnd(base(session)),
  ];
  await writeFile(join(learnings, `${session}.jsonl`), toJsonl(events), "utf8");
}

/** Capture the single JSON line `--json` writes to stdout. */
function captureStdout(): string[] {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  return writes;
}

// ─── no-KB error ──────────────────────────────────────────────────────────────

describe("promoteCmd — no knowledge base", () => {
  it("throws a friendly error when no mage KB is found", async () => {
    const empty = await tmpDir();
    await expect(promoteCmd({ dir: empty })).rejects.toThrow(/No mage knowledge base found/);
  });
});

// ─── read mode --json shape ───────────────────────────────────────────────────

describe("promoteCmd — read mode --json", () => {
  it("writes a single JSON line with the manifest shape", async () => {
    const { repo, learnings } = await tmpRepo();
    // Three distinct sessions with the same correction → signature recurs in 3 → at K.
    await seedCorrection(learnings, "sess-1", PROMPT);
    await seedCorrection(learnings, "sess-2", PROMPT);
    await seedCorrection(learnings, "sess-3", PROMPT);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writes = captureStdout();
    const res = await promoteCmd({ dir: repo, json: true });

    expect(res.manifest).toBeDefined();
    expect(writes).toHaveLength(1);
    const line = writes[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line) as PromoteManifest;
    expect(Array.isArray(parsed.proposals)).toBe(true);
    // ADR-0038: a recurring UNCOVERED signature no longer proposes a note. The manifest
    // shape still holds (proposals/cursors/covered/deferred) — it is simply empty here.
    expect(parsed.proposals).toHaveLength(0);
    expect(parsed.climbing).toBe(0);
    // cursors surface each folded session's offset (closedCount = 3 events).
    expect(parsed.cursors["sess-1"]).toBe(3);
  });

  it("does NOT propose a signature recurring in fewer than K sessions", async () => {
    const { repo, learnings } = await tmpRepo();
    await seedCorrection(learnings, "sess-1", PROMPT);
    await seedCorrection(learnings, "sess-2", PROMPT); // only 2 < K=3
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writes = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    const parsed = JSON.parse(writes[0] ?? "") as PromoteManifest;
    expect(parsed.proposals).toHaveLength(0);
  });

  it("the sensitivity dial no longer surfaces uncovered signatures at any setting (ADR-0038)", async () => {
    // K (`promoteSessions`) only ever gated the deleted note rung, so lowering it can no
    // longer make an uncovered signature surface — the dial scales `graduateSessions` alone.
    const { repo, learnings } = await tmpRepo({ sensitivity: "high" });
    await seedCorrection(learnings, "sess-1", PROMPT);
    await seedCorrection(learnings, "sess-2", PROMPT); // 2 sessions, high → K=2
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writes = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    const parsed = JSON.parse(writes[0] ?? "") as PromoteManifest;
    expect(parsed.proposals).toHaveLength(0);
  });

  it("suppresses a GRADUATE proposal already in the rejected buffer (back-off)", async () => {
    // Exercises the command-level rejected-buffer wiring (writeRejected → readRejected →
    // buildManifest) on the only rung that emits. The note is bound by the PATH READ, so
    // no keyword derivation is needed to build a covering fixture (ADR-0038 §2).
    const { repo, docsRoot, learnings } = await tmpRepo();
    await mkdir(join(docsRoot, "notes"), { recursive: true });
    await writeFile(
      join(docsRoot, "notes/pay.md"),
      "---\ntype: playbook\n---\n\n# Pay\n\nbody\n",
      "utf8",
    );
    for (const sess of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      await seedNoteRead(learnings, sess, docsRoot); // 6 chapters >= graduateSessions (M=5)
    }
    vi.spyOn(console, "log").mockImplementation(() => {});

    // The fixture must actually PRODUCE a graduate proposal — otherwise the suppression
    // assertion below would pass vacuously.
    const before = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    const unsuppressed = JSON.parse(before[0] ?? "") as PromoteManifest;
    expect(unsuppressed.proposals).toHaveLength(1);
    expect(unsuppressed.proposals[0]?.action).toBe("graduate");
    expect(unsuppressed.proposals[0]?.target).toBe("notes/pay.md");

    await writeRejected(docsRoot, [
      { action: "graduate", target: "notes/pay.md", payload: {}, evidence: "declined" },
    ]);

    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const after = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    expect((JSON.parse(after[0] ?? "") as PromoteManifest).proposals).toHaveLength(0);
  });

  it("persists the folded tally on the read path (derived cache, like the rollup Stop fold)", async () => {
    const { repo, docsRoot, learnings } = await tmpRepo();
    await seedNoteRead(learnings, "sess-1", docsRoot);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await promoteCmd({ dir: repo });
    const tally = await readTally(docsRoot);
    expect(tally.sessions["sess-1"]?.offset).toBe(3);
    expect(Object.keys(tally.notes)).toEqual(["notes/pay.md"]);
  });

  it("returns a manifest in the human (non-json) path too", async () => {
    const { repo, learnings } = await tmpRepo();
    await seedCorrection(learnings, "sess-1", PROMPT);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await promoteCmd({ dir: repo });
    expect(res.manifest).toBeDefined();
    expect(res.advanced).toBeUndefined();
  });
});

// ─── --seen disposition (advance the tally offset) ────────────────────────────

describe("promoteCmd — --seen disposition", () => {
  it("advances the tally offset and returns the parsed advance", async () => {
    const { repo, docsRoot, learnings } = await tmpRepo();
    await seedCorrection(learnings, "sess-1", PROMPT);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await promoteCmd({ dir: repo, seen: "sess-1:3" });
    expect(res.advanced).toEqual({ session: "sess-1", offset: 3 });
    expect((await readTally(docsRoot)).sessions["sess-1"]?.offset).toBe(3);
  });

  it("splits on the LAST colon so a session id may contain a colon", async () => {
    const { repo, docsRoot } = await tmpRepo();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await promoteCmd({ dir: repo, seen: "host:abc:7" });
    expect(res.advanced).toEqual({ session: "host:abc", offset: 7 });
    expect((await readTally(docsRoot)).sessions["host:abc"]?.offset).toBe(7);
  });

  it("never regresses an existing higher offset", async () => {
    const { repo, docsRoot } = await tmpRepo();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await promoteCmd({ dir: repo, seen: "sess-1:10" });
    await promoteCmd({ dir: repo, seen: "sess-1:3" });
    expect((await readTally(docsRoot)).sessions["sess-1"]?.offset).toBe(10);
  });

  it("never echoes a session id that trips a secret detector to the log", async () => {
    const { repo, docsRoot } = await tmpRepo();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    const pat = "ghp_" + "0123456789abcdefghijklmnopqrstuvwx";
    const res = await promoteCmd({ dir: repo, seen: `${pat}:0` });

    expect(res.advanced).toEqual({ session: pat, offset: 0 });
    expect((await readTally(docsRoot)).sessions[pat]?.offset).toBe(0);
    expect(logs.join("\n")).not.toContain(pat);
    expect(logs.some((l) => l.includes("advanced to 0"))).toBe(true);
  });

  it("logs the session id normally when it is an ordinary (non-secret) id", async () => {
    const { repo } = await tmpRepo();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });

    await promoteCmd({ dir: repo, seen: "sess-1:3" });
    expect(logs.some((l) => l.includes("sess-1"))).toBe(true);
  });

  it("rejects a non-integer offset", async () => {
    const { repo } = await tmpRepo();
    await expect(promoteCmd({ dir: repo, seen: "sess-1:1.5" })).rejects.toThrow(/non-negative integer/);
  });

  it("rejects a negative offset", async () => {
    const { repo } = await tmpRepo();
    await expect(promoteCmd({ dir: repo, seen: "sess-1:-1" })).rejects.toThrow(/non-negative integer/);
  });

  it("rejects a missing offset (no colon)", async () => {
    const { repo } = await tmpRepo();
    await expect(promoteCmd({ dir: repo, seen: "no-colon" })).rejects.toThrow(/expected "<session>:<offset>"/);
  });

  it("rejects an empty session (leading colon)", async () => {
    const { repo } = await tmpRepo();
    await expect(promoteCmd({ dir: repo, seen: ":5" })).rejects.toThrow(/expected "<session>:<offset>"/);
  });

  it("rejects a trailing-colon (empty offset)", async () => {
    const { repo } = await tmpRepo();
    await expect(promoteCmd({ dir: repo, seen: "sess-1:" })).rejects.toThrow(/expected "<session>:<offset>"/);
  });
});
