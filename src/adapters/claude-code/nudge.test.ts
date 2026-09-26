import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../../test/fixtures/kb.js";
import {
  buildSessionEnd,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../../observe/events.js";
import type { ObserveEvent } from "../../observe/types.js";
import { METADATA_SCHEMA, chosenHubRoot, learningsPath } from "../../paths.js";
import { emitNudge, nudgeCmd } from "./nudge.js";
import * as footprintModule from "../../metrics/footprint.js";
import * as reachGrantModule from "../../reach-grant.js";
import { buildNudgeCommand } from "./nudge.js";
import { readTrend } from "../../metrics/footprint-trend.js";

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

describe("mage nudge — gating", () => {
  it("does nothing on `clear` or a missing source (ADR-0030: clear is excluded)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    for (const source of ["clear", undefined]) {
      const r = await nudgeCmd({ cwd: dir, source });
      expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null, notice: null });
    }
  });

  it("stays silent on plain startup and resume with no proposals or failed checks", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha"); // one CLOSED, unmined chapter
    for (const source of ["startup", "resume"]) {
      const r = await nudgeCmd({ cwd: dir, source, force: true });
      expect(r.ran).toBe(true);
      expect(r.notice).toBeNull();
      expect(r.nudge).toBeNull();
    }
  });

  it("no-ops (fail-open) when there is no knowledge base", async () => {
    const empty = await tmpDir("mage-nudge-nokb-");
    const r = await nudgeCmd({ cwd: empty, source: "compact" });
    expect(r).toEqual({ ran: false, drafted: 0, pending: 0, nudge: null, notice: null });
  });

  it("a successful sample writes exactly one row (ADR-0039)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", sessionId: "sess-123", force: true });
    expect(r.ran).toBe(true);

    const trend = await readTrend(root);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]?.session).toBe("sess-123");
  });

  it("sampler failure does not propagate — forces measureFootprint to reject and asserts normal output (ADR-0039)", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    
    vi.spyOn(footprintModule, "measureFootprint").mockRejectedValueOnce(new Error("simulated failure"));

    const r = await nudgeCmd({ cwd: dir, source: "startup", sessionId: "sess-fail", force: true });
    expect(r.ran).toBe(true);
    expect(r.notice).toBeNull();
    expect(r.nudge).toBeNull();
    
    const trend = await readTrend(root);
    expect(trend.rows.length).toBe(0);
  });
});

describe("mage nudge: quiet SessionStart and proposal alert", () => {
  it("stays silent on plain startup, resume, and compact", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    for (const source of ["startup", "resume", "compact"]) {
      const r = await nudgeCmd({ cwd: dir, source });
      expect(r.ran).toBe(true);
      expect(r.notice).toBeNull();
      expect(r.nudge).toBeNull();
    }
  });

  it("surfaces 1 line notice when 1 proposal is waiting", async () => {
    const { dir, root } = await withKb();
    await mkdir(join(root, ".mage", "metrics"), { recursive: true });
    await writeFile(
      join(root, ".mage", "metrics", "proposals.json"),
      JSON.stringify([{
        action: "note",
        target: "payments::webhook",
        source: "failure",
        preview: "# Webhook handling\n",
        created: "2026-06-25T00:00:00.000Z",
      }]),
      "utf8",
    );

    const r = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(r.ran).toBe(true);
    expect(r.notice).toBe("mage · 1 proposal is waiting");
    expect(r.nudge).toBeNull();
  });

  it("surfaces 1 line notice with plural when multiple proposals are waiting", async () => {
    const { dir, root } = await withKb();
    await mkdir(join(root, ".mage", "metrics"), { recursive: true });
    await writeFile(
      join(root, ".mage", "metrics", "proposals.json"),
      JSON.stringify([
        { action: "note", target: "payments::webhook", source: "failure", preview: "# Webhook\n", created: "2026-06-25T00:00:00.000Z" },
        { action: "note", target: "auth::refresh", source: "failure", preview: "# Auth\n", created: "2026-06-25T00:00:00.000Z" },
        { action: "note", target: "db::pool", source: "failure", preview: "# DB\n", created: "2026-06-25T00:00:00.000Z" },
      ]),
      "utf8",
    );

    const r = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(r.ran).toBe(true);
    expect(r.notice).toBe("mage · 3 proposals are waiting");
    expect(r.nudge).toBeNull();
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

describe("mage nudge — CLI command parsing", () => {
  it("treats whitespace-only session_id as missing and falls back to sessionId", async () => {
    const { dir, root } = await withKb();
    const cmd = buildNudgeCommand();
    const mockStdin = {
      on: (event: string, cb: any) => {
        if (event === "data") cb(Buffer.from(JSON.stringify({ cwd: dir, source: "startup", session_id: "   ", sessionId: "real-id" })));
        if (event === "end") cb();
      },
    };
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin });

    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await cmd.parseAsync([], { from: "user" });
      const trend = await readTrend(root);
      expect(trend.rows.length).toBe(1);
      expect(trend.rows[0]?.session).toBe("real-id");
    } finally {
      Object.defineProperty(process, "stdin", { value: originalStdin });
      spy.mockRestore();
    }
  });
});

describe("mage nudge — unreachable external hub (ADR-0045 §6)", () => {
  async function setupUnreachable(hubRepo = "https://github.com/acme/docs.git"): Promise<{ dir: string; derivedPath: string }> {
    const code = await tmpDir("mage-nudge-unreach-code-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: "mage.v2",
        mode: "external",
        project: "engine",
        hub_path: null,
        hub_repo: hubRepo,
        hub_refs: [],
        linked_at: "2026-08-24T00:00:00.000Z",
      }),
      "utf8",
    );
    const chosen = chosenHubRoot(hubRepo, null);
    return { dir: code, derivedPath: chosen?.root ?? "" };
  }

  it("unreachable hub on startup → both channels non-null, agent text contains derived path", async () => {
    const { dir, derivedPath } = await setupUnreachable();
    const r = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(r.ran).toBe(true);
    expect(r.notice).not.toBeNull();
    expect(r.notice).toContain("mage · external hub is unreachable:");
    expect(r.notice).toContain("https://github.com/acme/docs.git");
    expect(r.nudge).not.toBeNull();
    expect(r.nudge).toContain(derivedPath);
    expect(r.nudge).toContain("mage connect");
  });

  it("unreachable hub twice in a row inside the throttle window → message appears both times", async () => {
    const { dir } = await setupUnreachable();
    const first = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(first.ran).toBe(true);
    expect(first.notice).not.toBeNull();
    expect(first.nudge).not.toBeNull();

    const second = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(second.ran).toBe(true);
    expect(second.notice).toBe(first.notice);
    expect(second.nudge).toBe(first.nudge);
  });

  it("resolved hub with no proposals or failed checks stays silent on startup", async () => {
    const { dir, root } = await withKb();
    await seedChapter(learningsPath(root), "s1", "alpha");
    const r = await nudgeCmd({ cwd: dir, source: "startup", force: true });
    expect(r.ran).toBe(true);
    expect(r.notice).toBeNull();
    expect(r.nudge).toBeNull();
  });

  it("the agent text carries the mage init prohibition, never the instruction", async () => {
    const { dir } = await setupUnreachable();
    const r = await nudgeCmd({ cwd: dir, source: "startup" });
    expect(r.nudge).not.toBeNull();
    // The prohibition is exactly what the agent channel must carry; only the
    // `mage init --local` ALTERNATIVE is an instruction, and only that is dropped.
    expect(r.nudge).toContain("Do NOT run `mage init` here");
    expect(r.nudge).not.toContain("mage init --local");
  });
});

describe("mage nudge — KB access grant (#202)", () => {
  // Isolate HOME: the check unions LOCAL + USER scope (CC concatenates array settings
  // across scopes), so a real ~/.claude grant would mask a missing local one.
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    home = await tmpDir("mage-reachhome-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  async function externalRepo(opts: { hubExists: boolean }): Promise<{
    code: string;
    hub: string;
  }> {
    const hub = await tmpDir("mage-reachdr-hub-");
    const code = await tmpDir("mage-reachdr-code-");
    const hubPath = opts.hubExists ? hub : join(hub, "gone");
    if (opts.hubExists) {
      await mkdir(join(hub, "projects", "engine", "notes"), { recursive: true });
      await writeFile(
        join(hub, "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
      );
    }
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: METADATA_SCHEMA,
        mode: "external",
        project: "engine",
        hub_path: hubPath,
        hub_repo: null,
        hub_refs: [],
        linked_at: "",
      }),
    );
    return { code, hub: hubPath };
  }

  async function writeLocalGrant(code: string, dirs: string[]): Promise<void> {
    await mkdir(join(code, ".claude"), { recursive: true });
    await writeFile(
      join(code, ".claude", "settings.local.json"),
      `${JSON.stringify({ permissions: { additionalDirectories: dirs } }, null, 2)}\n`,
    );
  }

  async function hybridRepo(opts: { hubExists: boolean }): Promise<{
    code: string;
    hub: string;
  }> {
    const hub = await tmpDir("mage-reachdr-hybrid-hub-");
    const code = await tmpDir("mage-reachdr-hybrid-code-");
    const hubPath = opts.hubExists ? hub : join(hub, "gone");
    if (opts.hubExists) {
      await mkdir(join(hub, "projects", "engine", "notes"), { recursive: true });
      await writeFile(
        join(hub, "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
      );
    }
    await mkdir(join(code, "mage", "notes"), { recursive: true });
    await writeFile(join(code, "mage", "notes", "overview.md"), "# Engine\n");
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: METADATA_SCHEMA,
        mode: "hybrid",
        project: "engine",
        hub_path: null,
        hub_repo: null,
        hub_refs: [
          {
            hub_path: hubPath,
            hub_repo: null,
            project: "engine",
            storage: "repo-owned",
            linked_at: "",
          },
        ],
        linked_at: "",
      }),
    );
    return { code, hub: hubPath };
  }

  it("hub present, no grant → both channels name the grant and mage connect, on startup and again on resume", async () => {
    const { code, hub } = await externalRepo({ hubExists: true });
    const r = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });
    expect(r.ran).toBe(true);
    expect(r.notice).toMatch(/access grant/);
    expect(r.notice).toContain(hub);
    expect(r.nudge).toMatch(/mage connect/);
    expect(r.nudge).toMatch(/NOT run `mage init`/);

    const rResume = await nudgeCmd({ cwd: code, source: "resume", sessionId: "s1" });
    expect(rResume.notice).toBe(r.notice);
  });

  it("hybrid mode: hub present, no grant → names only external hub as unreachable; in-repo notes are readable", async () => {
    const { code, hub } = await hybridRepo({ hubExists: true });
    const r = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });
    expect(r.ran).toBe(true);
    expect(r.notice).toMatch(/access grant/);
    expect(r.notice).toContain(hub);
    expect(r.nudge).toMatch(/in-repo notes.*readable/i);
    expect(r.nudge).toMatch(/only the external hub is unreachable/i);
    expect(r.nudge).not.toContain("cannot read a single note");
    expect(r.nudge).toMatch(/mage connect/);
    expect(r.nudge).toMatch(/NOT run `mage init`/);
  });

  it("grant present → no grant text", async () => {
    const { code, hub } = await externalRepo({ hubExists: true });
    await writeLocalGrant(code, [hub]);
    const r = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });
    expect(r.notice ?? "").not.toMatch(/access grant/);
    expect(r.nudge ?? "").not.toMatch(/access grant/);
  });

  it("in-repo KB → no grant text", async () => {
    const { dir } = await withKb({ kind: "repo" });
    const r = await nudgeCmd({ cwd: dir, source: "startup", sessionId: "s1" });
    expect(r.notice ?? "").not.toMatch(/access grant/);
    expect(r.nudge ?? "").not.toMatch(/access grant/);
  });

  it("hub absent → the unreachable-hub message speaks, not the grant line", async () => {
    const { code } = await externalRepo({ hubExists: false });
    const r = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });
    expect(r.notice).toMatch(/unreachable/);
    expect(r.notice).not.toMatch(/access grant/);
  });

  it("a throwing grant check leaves the nudge intact (fail-open)", async () => {
    const { code } = await externalRepo({ hubExists: true });
    const baseline = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });

    vi.spyOn(reachGrantModule, "reachGrantStatus").mockRejectedValue(new Error("boom"));

    const r = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });
    expect(r.ran).toBe(baseline.ran);
    expect(r.drafted).toBe(baseline.drafted);
    expect(r.pending).toBe(baseline.pending);
  });
});
