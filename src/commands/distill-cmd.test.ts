import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { learningsPath } from "../paths.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import type { DistillManifest } from "../distill/types.js";
import { readWatermark, writeWatermark, DISTILL_VERSION } from "../distill/watermark.js";
import { distillCmd } from "./distill-cmd.js";

// ─── tmp fixture plumbing ─────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

/** A docs root with a `mage/metadata.json` so resolveDocsRoot finds an in-repo KB. */
async function tmpRepo(): Promise<{ repo: string; docsRoot: string; learnings: string }> {
  const kb = await withKb({ kind: "repo", schema: 1 });
  const learnings = learningsPath(kb.root);
  await mkdir(learnings, { recursive: true }); // fixture does not pre-create .mage/learnings
  return { repo: kb.dir, docsRoot: kb.root, learnings };
}

const SESSION = "sess-1";
let clock = 0;
function base(): EventBase {
  clock += 1;
  return { ts: new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString(), session: SESSION };
}
function toJsonl(events: ObserveEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
async function seedSession(learnings: string): Promise<void> {
  const events: ObserveEvent[] = [
    buildUserPrompt(base(), "hello"),
    buildToolUse(base(), { tool: "Read", paths: ["a.ts"], detail: null, ok: true, error_summary: null }),
    buildSessionEnd(base()),
  ];
  await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");
}

// ─── no-KB error ──────────────────────────────────────────────────────────────

describe("distillCmd — no knowledge base", () => {
  it("throws a friendly error when no mage KB is found", async () => {
    const empty = await tmpDir();
    await expect(distillCmd({ dir: empty })).rejects.toThrow(/No mage knowledge base found/);
  });
});

// ─── read mode --json shape ───────────────────────────────────────────────────

describe("distillCmd — read mode --json", () => {
  it("writes a single JSON line with the manifest shape", async () => {
    const { repo, learnings } = await tmpRepo();
    await seedSession(learnings);

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    });

    const res = await distillCmd({ dir: repo, json: true });

    expect(res.manifest).toBeDefined();
    expect(writes).toHaveLength(1);
    const line = writes[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line) as DistillManifest;
    expect(Array.isArray(parsed.clusters)).toBe(true);
    expect(parsed.clusters).toHaveLength(1);
    expect(parsed.clusters[0]?.session).toBe(SESSION);
    expect(parsed.cursors[SESSION]).toBe(3);
    expect(parsed.capped).toBe(false);
  });

  it("returns a manifest in the human (non-json) path too", async () => {
    const { repo, learnings } = await tmpRepo();
    await seedSession(learnings);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await distillCmd({ dir: repo });
    expect(res.manifest?.clusters).toHaveLength(1);
    expect(res.advanced).toBeUndefined();
  });
});

// ─── --seen parsing (the only write path) ─────────────────────────────────────

describe("distillCmd — --seen disposition (the only write path)", () => {
  it("advances the watermark and returns the parsed advance", async () => {
    const { repo, docsRoot } = await tmpRepo();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await distillCmd({ dir: repo, seen: `${SESSION}:3` });
    expect(res.advanced).toEqual({ session: SESSION, offset: 3 });
    expect((await readWatermark(docsRoot)).cursors[SESSION]).toBe(3);
  });

  it("splits on the LAST colon so a session id may contain a colon", async () => {
    const { repo, docsRoot } = await tmpRepo();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await distillCmd({ dir: repo, seen: "host:abc:7" });
    expect(res.advanced).toEqual({ session: "host:abc", offset: 7 });
    expect((await readWatermark(docsRoot)).cursors["host:abc"]).toBe(7);
  });

  it("never regresses an existing higher watermark", async () => {
    const { repo, docsRoot } = await tmpRepo();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await writeWatermark(docsRoot, { v: DISTILL_VERSION, cursors: { [SESSION]: 10 } });

    await distillCmd({ dir: repo, seen: `${SESSION}:3` });
    expect((await readWatermark(docsRoot)).cursors[SESSION]).toBe(10);
  });

  it("never echoes a session id that trips a secret detector to the log", async () => {
    const { repo, docsRoot } = await tmpRepo();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    // A live GitHub PAT shape used (wrongly) as the session id — must not be echoed.
    const pat = "ghp_" + "0123456789abcdefghijklmnopqrstuvwx";
    const res = await distillCmd({ dir: repo, seen: `${pat}:0` });

    // The disposition still happens (the value is a valid cursor key)…
    expect(res.advanced).toEqual({ session: pat, offset: 0 });
    expect((await readWatermark(docsRoot)).cursors[pat]).toBe(0);
    // …but the secret-shaped id never appears in any log line.
    expect(logs.join("\n")).not.toContain(pat);
    expect(logs.some((l) => l.includes("advanced to 0"))).toBe(true);
  });

  it("logs the session id normally when it is an ordinary (non-secret) id", async () => {
    const { repo } = await tmpRepo();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });

    await distillCmd({ dir: repo, seen: `${SESSION}:3` });
    expect(logs.some((l) => l.includes(SESSION))).toBe(true);
  });

  it("rejects a non-integer offset", async () => {
    const { repo } = await tmpRepo();
    await expect(distillCmd({ dir: repo, seen: `${SESSION}:1.5` })).rejects.toThrow(/non-negative integer/);
  });

  it("rejects a negative offset", async () => {
    const { repo } = await tmpRepo();
    await expect(distillCmd({ dir: repo, seen: `${SESSION}:-1` })).rejects.toThrow(/non-negative integer/);
  });

  it("rejects a missing offset (no colon)", async () => {
    const { repo } = await tmpRepo();
    await expect(distillCmd({ dir: repo, seen: "no-colon" })).rejects.toThrow(/expected "<session>:<offset>"/);
  });

  it("rejects an empty session (leading colon)", async () => {
    const { repo } = await tmpRepo();
    await expect(distillCmd({ dir: repo, seen: ":5" })).rejects.toThrow(/expected "<session>:<offset>"/);
  });

  it("rejects a trailing-colon (empty offset)", async () => {
    const { repo } = await tmpRepo();
    await expect(distillCmd({ dir: repo, seen: `${SESSION}:` })).rejects.toThrow(/expected "<session>:<offset>"/);
  });
});
