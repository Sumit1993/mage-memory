import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A docs root with a `mage/metadata.json` so resolveDocsRoot finds an in-repo KB. */
async function tmpRepo(grooming?: { sensitivity?: string }): Promise<{
  repo: string;
  docsRoot: string;
  learnings: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), "mage-promote-cmd-"));
  made.push(repo);
  const docsRoot = join(repo, "mage");
  await mkdir(docsRoot, { recursive: true });
  await writeFile(
    join(docsRoot, "metadata.json"),
    JSON.stringify({
      schema: "mage.v1",
      mode: "in-repo",
      project: "t",
      hub_path: null,
      hub_repo: null,
      hub_refs: [],
      linked_at: "2026-06-08",
      ...(grooming ? { grooming } : {}),
    }),
    "utf8",
  );
  const learnings = join(docsRoot, ".mage", "learnings");
  await mkdir(learnings, { recursive: true });
  return { repo, docsRoot, learnings };
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
    const empty = await mkdtemp(join(tmpdir(), "mage-promote-nokb-"));
    made.push(empty);
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
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]?.action).toBe("note");
    expect(parsed.covered).toBe(0);
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

  it("the high-sensitivity dial lowers the gate (K=2) so 2 sessions surface", async () => {
    const { repo, learnings } = await tmpRepo({ sensitivity: "high" });
    await seedCorrection(learnings, "sess-1", PROMPT);
    await seedCorrection(learnings, "sess-2", PROMPT); // 2 sessions, high → K=2
    vi.spyOn(console, "log").mockImplementation(() => {});

    const writes = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    const parsed = JSON.parse(writes[0] ?? "") as PromoteManifest;
    expect(parsed.proposals).toHaveLength(1);
  });

  it("suppresses a proposal already in the rejected buffer (back-off)", async () => {
    const { repo, docsRoot, learnings } = await tmpRepo();
    await seedCorrection(learnings, "sess-1", PROMPT);
    await seedCorrection(learnings, "sess-2", PROMPT);
    await seedCorrection(learnings, "sess-3", PROMPT);
    vi.spyOn(console, "log").mockImplementation(() => {});

    // Discover the signature key from an unsuppressed run, then reject it.
    const first = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    const target = (JSON.parse(first[0] ?? "") as PromoteManifest).proposals[0]?.target ?? "";
    expect(target.length).toBeGreaterThan(0);
    await writeRejected(docsRoot, [{ action: "note", target, payload: {}, evidence: "declined" }]);

    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const second = captureStdout();
    await promoteCmd({ dir: repo, json: true });
    const parsed = JSON.parse(second[0] ?? "") as PromoteManifest;
    expect(parsed.proposals).toHaveLength(0);
  });

  it("persists the folded tally on the read path (derived cache, like the rollup Stop fold)", async () => {
    const { repo, docsRoot, learnings } = await tmpRepo();
    await seedCorrection(learnings, "sess-1", PROMPT);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await promoteCmd({ dir: repo });
    const tally = await readTally(docsRoot);
    expect(tally.sessions["sess-1"]?.offset).toBe(3);
    expect(Object.keys(tally.signatures).length).toBeGreaterThan(0);
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
