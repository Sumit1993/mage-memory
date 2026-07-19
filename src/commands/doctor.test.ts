import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClaudeSettings,
  MAGE_HOOKS,
  diffMageHooks,
  hasCommandeerHooks,
  upsertMageHooks,
} from "../adapters/claude-code/settings.js";
import { gitInit } from "../git.js";
import { detectRedactHook, installRedactHook } from "../git-hooks.js";
import { METADATA_SCHEMA, METADATA_SCHEMA_V1, exists } from "../paths.js";
import { tmpDir } from "../../test/fixtures/kb.js";
import { type DoctorCheck, doctor, mageInstalledIn, readinessFooter } from "./doctor.js";
import * as footprintModule from "../metrics/footprint.js";

async function freshDir(prefix = "mage-doctor-"): Promise<string> {
  return tmpDir(prefix);
}

/** Find a check by name in a DoctorResult. */
function check(checks: DoctorCheck[], name: string) {
  return checks.find((c) => c.name === name);
}

/**
 * Build a minimal in-repo mage KB inside a git repo at `dir`. Writes
 * `mage/metadata.json` + (optionally) `mage/INDEX.md`. Does NOT write a
 * .gitignore unless `gitignoreSinks` is true.
 */
async function makeInRepoKb(
  dir: string,
  opts: { gitignoreSinks?: boolean; index?: boolean } = {},
): Promise<void> {
  await gitInit(dir);
  await mkdir(join(dir, "mage"), { recursive: true });
  const meta = {
    schema: METADATA_SCHEMA,
    mode: "in-repo",
    project: "demo",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: new Date().toISOString(),
  };
  await writeFile(join(dir, "mage", "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
  if (opts.index !== false) {
    await writeFile(join(dir, "mage", "INDEX.md"), "# Index\n");
  }
  if (opts.gitignoreSinks) {
    await writeFile(join(dir, ".gitignore"), "mage/.mage/\n");
  }
}

// ─── diffMageHooks (pure unit) ───────────────────────────────────────────────

describe("diffMageHooks", () => {
  it("full installed block → connected + matches, nothing missing/stale", () => {
    const settings = upsertMageHooks(null);
    const d = diffMageHooks(settings);
    expect(d.connected).toBe(true);
    expect(d.matches).toBe(true);
    expect(d.missingIds).toEqual([]);
    expect(d.staleIds).toEqual([]);
  });

  it("dropping two ids → those ids are missing and matches is false", () => {
    const settings = upsertMageHooks(null) as ClaudeSettings;
    // Remove the PostToolUse and PreCompact mage groups.
    const dropped = ["mage:observe:PostToolUse", "mage:observe:PreCompact"];
    for (const ev of Object.keys(settings.hooks ?? {})) {
      const groups = settings.hooks?.[ev];
      if (groups) {
        settings.hooks![ev] = groups.filter((g) => !dropped.includes(g.id ?? ""));
      }
    }
    const d = diffMageHooks(settings);
    expect(d.connected).toBe(true);
    expect(d.matches).toBe(false);
    expect(new Set(d.missingIds)).toEqual(new Set(dropped));
    expect(d.staleIds).toEqual([]);
  });

  it("changing a command → that id is stale and matches is false", () => {
    const settings = upsertMageHooks(null) as ClaudeSettings;
    const ss = settings.hooks?.SessionStart?.find((g) => g.id === "mage:observe:SessionStart");
    if (ss) ss.hooks = [{ type: "command", command: "mage observe --old" }];
    const d = diffMageHooks(settings);
    expect(d.connected).toBe(true);
    expect(d.matches).toBe(false);
    expect(d.staleIds).toContain("mage:observe:SessionStart");
    expect(d.missingIds).toEqual([]);
  });

  it("an extra mage:* id beyond MAGE_HOOKS blocks matches", () => {
    const settings = upsertMageHooks(null) as ClaudeSettings;
    settings.hooks!.SessionStart!.push({
      id: "mage:legacy:Gone",
      hooks: [{ type: "command", command: "mage observe" }],
    });
    const d = diffMageHooks(settings);
    expect(d.connected).toBe(true);
    expect(d.matches).toBe(false);
    // it is not "missing" or "stale" — it's an extra; matches still false.
    expect(d.missingIds).toEqual([]);
    expect(d.staleIds).toEqual([]);
  });

  it("ignores commandeer rows by default — a base block still matches", () => {
    const base = upsertMageHooks(null); // 10 base rows, no commandeer
    const d = diffMageHooks(base); // default: commandeer not expected
    expect(d.matches).toBe(true);
    expect(d.missingIds).toEqual([]);
  });

  it("with commandeer:true, a base block reports the commandeer rows missing", () => {
    const base = upsertMageHooks(null);
    const d = diffMageHooks(base, { commandeer: true });
    expect(d.matches).toBe(false);
    expect(new Set(d.missingIds)).toEqual(
      new Set(["mage:memory:PreToolUse", "mage:memory:PostToolUse", "mage:flatten:Stop"]),
    );
  });

  it("with commandeer:true, a full commandeer block matches", () => {
    const full = upsertMageHooks(null, { commandeer: true });
    const d = diffMageHooks(full, { commandeer: true });
    expect(d.matches).toBe(true);
    expect(d.missingIds).toEqual([]);
  });

  it("a stale commandeer command is detected when the flag is driven off the installed hooks (F9)", () => {
    // doctor's resolveConnection now passes { commandeer: hasCommandeerHooks(settings) }
    // so a drifted mage:memory:* command is caught rather than silently passing.
    const full = upsertMageHooks(null, { commandeer: true }) as ClaudeSettings & {
      hooks: Record<string, Array<{ id?: string; hooks: Array<{ command: string }> }>>;
    };
    const cmd0 = full.hooks.PreToolUse?.find((g) => g.id === "mage:memory:PreToolUse")?.hooks[0];
    expect(cmd0).toBeDefined();
    if (cmd0) cmd0.command = "mage OLD-memory-hook"; // simulate a version-bump drift
    // The OLD default (commandeer omitted) MISSES the drift — the bug:
    expect(diffMageHooks(full).matches).toBe(true);
    // Driven off the installed hooks (the fix), the stale commandeer row is detected:
    const d = diffMageHooks(full, { commandeer: hasCommandeerHooks(full) });
    expect(d.matches).toBe(false);
    expect(d.staleIds).toContain("mage:memory:PreToolUse");
  });

  it("empty settings → not connected", () => {
    expect(diffMageHooks({})).toMatchObject({ connected: false, matches: false });
  });

  it("null settings → not connected", () => {
    const d = diffMageHooks(null);
    expect(d.connected).toBe(false);
    expect(d.matches).toBe(false);
  });

  it("a non-object entry in a hooks-event array does not throw (doctor stays total)", () => {
    // A hand-edited settings file can carry `null`/scalars in a hooks array; `g.id`
    // on a null would throw and crash `mage doctor`, which must never throw.
    const settings = { hooks: { SessionStart: [null, 7, "x"] } } as unknown as ClaudeSettings;
    expect(() => diffMageHooks(settings)).not.toThrow();
    expect(diffMageHooks(settings).connected).toBe(false);
  });
});

describe("doctor — recall budget (ADR-0039)", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("breach -> ok: false, NOT optional", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    vi.spyOn(footprintModule, "measureFootprint").mockResolvedValueOnce({ budget: { usedBytes: 95000, capBytes: 100000, ratio: 0.95, state: "breach", usedLines: 190, capLines: 200, byteRatio: 0.95, lineRatio: 0.95, binding: "bytes" }, yield: { sufficientData: false, sessions: 0, notesTracked: 10, notesRead: 0, notesNeverRead: 10 }, surfaces: [], pointers: { total: 0, measurable: 0, dead: 0, unmeasurable: 0, measurableBytes: 0 } });
    const r = await doctor({ cwd: dir });
    const c = check(r.checks, "recall budget");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(false);
    expect(c?.detail).toMatch(/BREACH/);
  });

  it("warn -> ok: true, optional, states percentage and remedy", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    vi.spyOn(footprintModule, "measureFootprint").mockResolvedValueOnce({ budget: { usedBytes: 75000, capBytes: 100000, ratio: 0.75, state: "warn", usedLines: 150, capLines: 200, byteRatio: 0.75, lineRatio: 0.75, binding: "bytes" }, yield: { sufficientData: false, sessions: 0, notesTracked: 10, notesRead: 0, notesNeverRead: 10 }, surfaces: [], pointers: { total: 0, measurable: 0, dead: 0, unmeasurable: 0, measurableBytes: 0 } });
    const r = await doctor({ cwd: dir });
    const c = check(r.checks, "recall budget");
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/warn/);
    expect(c?.detail).toMatch(/mage footprint/);
  });

  it("measurement failure -> check is skipped/optional", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    vi.spyOn(footprintModule, "measureFootprint").mockRejectedValueOnce(new Error("measure failed"));
    const r = await doctor({ cwd: dir });
    const c = check(r.checks, "recall budget");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(true);
    expect(c?.detail).toMatch(/failed/);
  });
});

// ─── doctor: KB + connection health ──────────────────────────────────────────

describe("doctor KB health", () => {
  // Isolate HOME so the user-settings fallback never reads the real ~/.claude.
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("no KB → an informational optional 'mage KB' check, result still passes", async () => {
    const dir = await freshDir();
    const r = await doctor({ cwd: dir });
    const kbCheck = check(r.checks, "mage KB");
    expect(kbCheck?.optional).toBe(true);
    expect(kbCheck?.ok).toBe(true);
    expect(kbCheck?.detail).toMatch(/No mage KB here/);
    // env checks still ran
    expect(check(r.checks, "node version")).toBeDefined();
  });

  it("KB whose sinks are NOT ignored → gitignore check fails; --fix makes it pass and writes patterns", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: false });

    const before = await doctor({ cwd: dir });
    const giBefore = check(before.checks, "gitignore (sinks)");
    expect(giBefore?.ok).toBe(false);
    expect(giBefore?.detail).toMatch(/mage doctor --fix/);

    const after = await doctor({ cwd: dir, fix: true });
    const giAfter = check(after.checks, "gitignore (sinks)");
    expect(giAfter?.ok).toBe(true);

    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain("mage/.mage/");
    // --fix also establishes the cockpit ignore (safe-by-default, ADR-0020 §6).
    expect(gi).toContain("mage/dashboard.html");
  });

  it("KB with sinks already ignored → gitignore check passes without --fix", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const r = await doctor({ cwd: dir });
    expect(check(r.checks, "gitignore (sinks)")?.ok).toBe(true);
  });

  it("connected-but-partial hook block → connection check fails and nudges mage connect", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });

    // Wire a deliberately partial mage block into local settings (drop two ids).
    const partial = upsertMageHooks(null) as ClaudeSettings;
    const drop = ["mage:observe:Stop", "mage:metrics:Stop"];
    for (const ev of Object.keys(partial.hooks ?? {})) {
      partial.hooks![ev] = (partial.hooks?.[ev] ?? []).filter((g) => !drop.includes(g.id ?? ""));
    }
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      `${JSON.stringify(partial, null, 2)}\n`,
    );

    const r = await doctor({ cwd: dir });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(false);
    expect(conn?.detail).toMatch(/hook block out of date/);
    expect(conn?.detail).toMatch(/mage connect/);
    // overall result fails because connection is required
    expect(r.passed).toBe(false);
  });

  it("not connected at all → connection check nudges `mage connect`", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const r = await doctor({ cwd: dir });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(false);
    expect(conn?.detail).toMatch(/not connected; run `mage connect`/);
  });

  it("capture history but no hooks → reports DISCONNECTED (not the fresh-KB nudge)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    // It WAS capturing (a session stream exists) but no hooks are wired now.
    await mkdir(join(dir, "mage", ".mage", "learnings"), { recursive: true });
    await writeFile(join(dir, "mage", ".mage", "learnings", "s1.jsonl"), '{"v":1,"type":"session_start"}\n');
    const r = await doctor({ cwd: dir });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(false);
    expect(conn?.detail).toMatch(/DISCONNECTED/);
  });

  it("fully-connected current block → connection check passes", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const full = upsertMageHooks(null);
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      `${JSON.stringify(full, null, 2)}\n`,
    );
    const r = await doctor({ cwd: dir });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(true);
    expect(conn?.detail).toMatch(/mage hooks current/);
  });

  it("missing INDEX.md → advisory (optional) check, not a hard failure", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true, index: false });
    const r = await doctor({ cwd: dir });
    const idx = check(r.checks, "INDEX.md");
    expect(idx?.ok).toBe(false);
    expect(idx?.optional).toBe(true);
    expect(idx?.detail).toMatch(/mage index/);
  });
});

// ─── doctor --report: content-free ───────────────────────────────────────────

describe("doctor --report", () => {
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("output is content-free: no secret, no note keyword, no absolute tmp path", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });

    // Plant a secret-looking string AND a unique note keyword inside the KB.
    const SECRET = "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ";
    const KEYWORD = "zzunique_keyword_marker_42";
    await mkdir(join(dir, "mage", "notes"), { recursive: true });
    await writeFile(
      join(dir, "mage", "notes", "leak.md"),
      `---\nkeywords: [${KEYWORD}]\n---\n# Note\ntoken = ${SECRET}\n`,
    );
    // Plant a learnings stream with an error event carrying the secret + keyword.
    await mkdir(join(dir, "mage", ".mage", "learnings"), { recursive: true });
    await writeFile(
      join(dir, "mage", ".mage", "learnings", "s1.jsonl"),
      `${JSON.stringify({ v: 1, ts: "t", session: "s1", type: "tool_use", tool: "Bash", paths: [], detail: `${KEYWORD} ${SECRET}`, ok: false, error_summary: SECRET })}\n`,
    );

    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      await doctor({ cwd: dir, report: true });
    } finally {
      spy.mockRestore();
    }

    const out = writes.join("");
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(KEYWORD);
    // absolute tmpdir path must not leak (paths are reduced to <kb>/basenames)
    expect(out).not.toContain(dir);
    // sanity: it IS a report with version + metrics scaffolding
    expect(out).toMatch(/doctor --report/);
    expect(out).toMatch(/metrics \(numbers only\)/);
    expect(out).toMatch(/recentErrors=\d+/);
  });

  it("--report still returns a normal DoctorResult (doctor returns, does not exit)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const r = await doctor({ cwd: dir, report: true });
      expect(Array.isArray(r.checks)).toBe(true);
      expect(typeof r.passed).toBe("boolean");
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── existing env behavior preserved ─────────────────────────────────────────

describe("doctor env checks still run", () => {
  it("includes node/platform/git checks regardless of KB", async () => {
    const dir = await freshDir();
    const home = await freshDir("mage-home-");
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const r = await doctor({ cwd: dir });
      expect(check(r.checks, "node version")).toBeDefined();
      expect(check(r.checks, "platform")).toBeDefined();
      expect(check(r.checks, "git")).toBeDefined();
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  });

  it("MAGE_HOOKS length is the expected hook count (10 base + 3 commandeer)", () => {
    expect(MAGE_HOOKS.length).toBe(13);
  });

  it("skips the GitHub network probe under test (no 5s fetch → no timeout flake)", async () => {
    const dir = await freshDir();
    const home = await freshDir("mage-home-");
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const r = await doctor({ cwd: dir });
      expect(check(r.checks, "github reachable")).toBeUndefined();
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  });
});

// ─── link integrity (code-repo <-> hub references; --fix heals a moved repo) ────

describe("doctor — link integrity", () => {
  async function makeHub(
    hub: string,
    projects: Array<{ name: string; code_repo_path: string }>,
  ): Promise<void> {
    await mkdir(join(hub, "projects"), { recursive: true });
    const meta = {
      schema: METADATA_SCHEMA,
      name: "h",
      created_at: "",
      projects: projects.map((p) => ({
        name: p.name,
        storage: "hub-owned",
        code_repo_path: p.code_repo_path,
        code_repo_url: "",
      })),
    };
    await writeFile(join(hub, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
  }

  async function makeExternalRepo(repo: string, hub: string, project: string): Promise<void> {
    await mkdir(join(repo, "mage"), { recursive: true });
    const meta = {
      schema: METADATA_SCHEMA,
      mode: "external",
      project,
      hub_path: hub,
      hub_repo: null,
      hub_refs: [],
      linked_at: "",
    };
    await writeFile(join(repo, "mage", "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
  }

  it("passes when an external repo's two-way link is consistent", async () => {
    const hub = await freshDir("mage-hub-");
    const repo = await freshDir("mage-ext-");
    await makeHub(hub, [{ name: "engine", code_repo_path: repo }]);
    await makeExternalRepo(repo, hub, "engine");
    const r = await doctor({ cwd: repo });
    expect(check(r.checks, "link integrity")?.ok).toBe(true);
  });

  it("flags a stale hub back-reference and repairs it with --fix", async () => {
    const hub = await freshDir("mage-hub-");
    const repo = await freshDir("mage-ext-");
    await makeHub(hub, [{ name: "engine", code_repo_path: "/old/moved/away" }]);
    await makeExternalRepo(repo, hub, "engine");

    expect(check((await doctor({ cwd: repo })).checks, "link integrity")?.ok).toBe(false);

    const after = await doctor({ cwd: repo, fix: true });
    expect(check(after.checks, "link integrity")?.ok).toBe(true);
    const hubMeta = JSON.parse(await readFile(join(hub, "metadata.json"), "utf8"));
    expect(hubMeta.projects[0].code_repo_path).toBe(repo); // healed to the real path
  });

  it("flags a moved/unreachable hub (not auto-fixable)", async () => {
    const repo = await freshDir("mage-ext-");
    await makeExternalRepo(repo, "/no/such/hub", "engine");
    const c = check((await doctor({ cwd: repo })).checks, "link integrity");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("not a reachable hub");
  });

  it("from a hub, warns (advisory) about a project whose code repo is missing", async () => {
    const hub = await freshDir("mage-hub-");
    await makeHub(hub, [{ name: "engine", code_repo_path: "/gone/repo" }]);
    const c = check((await doctor({ cwd: hub })).checks, "link integrity");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(true);
  });
});

// ─── doctor --fix repair-drift (Decision 7) ───────────────────────────────────

describe("doctor --fix — hook-block drift refresh", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  /** Write `settings` as the repo-local settings.local.json under `dir`. */
  async function writeLocalSettings(dir: string, settings: ClaudeSettings): Promise<void> {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
    );
  }

  /** Re-read the local settings and diff against the current MAGE_HOOKS. */
  async function localDiff(dir: string) {
    const raw = await readFile(join(dir, ".claude", "settings.local.json"), "utf8");
    return diffMageHooks(JSON.parse(raw) as ClaudeSettings);
  }

  it("connected-but-partial block: --fix rewrites the block to current and passes", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const partial = upsertMageHooks(null) as ClaudeSettings;
    const drop = ["mage:observe:Stop", "mage:metrics:Stop"];
    for (const ev of Object.keys(partial.hooks ?? {})) {
      partial.hooks![ev] = (partial.hooks?.[ev] ?? []).filter((g) => !drop.includes(g.id ?? ""));
    }
    await writeLocalSettings(dir, partial);

    const after = await doctor({ cwd: dir, fix: true });
    const conn = check(after.checks, "connection");
    expect(conn?.ok).toBe(true);
    expect(conn?.detail).toMatch(/refreshed drifted mage hook block/);
    // The on-disk block is now the full, current set.
    expect((await localDiff(dir)).matches).toBe(true);
  });

  it("--fix clears an EXTRA renamed mage:* id (strip+add, not just upsert)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const drifted = upsertMageHooks(null) as ClaudeSettings;
    // A leftover from a renamed hook — upsert-by-id alone would never remove it.
    drifted.hooks!.SessionStart!.push({
      id: "mage:legacy:Gone",
      hooks: [{ type: "command", command: "mage observe" }],
    });
    await writeLocalSettings(dir, drifted);

    const after = await doctor({ cwd: dir, fix: true });
    expect(check(after.checks, "connection")?.ok).toBe(true);
    const d = await localDiff(dir);
    expect(d.matches).toBe(true); // matches requires NO extra mage:* id
  });

  it("without --fix, a drifted block stays a required failure (no rewrite)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const partial = upsertMageHooks(null) as ClaudeSettings;
    partial.hooks!.SessionStart = (partial.hooks?.SessionStart ?? []).filter(
      (g) => g.id !== "mage:observe:SessionStart",
    );
    await writeLocalSettings(dir, partial);

    const r = await doctor({ cwd: dir });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(false);
    expect(conn?.detail).toMatch(/hook block out of date/);
    // file untouched: still drifted
    expect((await localDiff(dir)).matches).toBe(false);
  });

  it("--fix does NOT wire a never-connected repo from scratch", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const r = await doctor({ cwd: dir, fix: true });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(false);
    expect(conn?.detail).toMatch(/not connected; run `mage connect`/);
    // crucial: --fix created no settings file (connect-from-scratch is not a repair)
    expect(await exists(join(dir, ".claude", "settings.local.json"))).toBe(false);
  });

  it("--fix write failure degrades to the nudge (no throw, no false success, file intact)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const partial = upsertMageHooks(null) as ClaudeSettings;
    partial.hooks!.SessionStart = (partial.hooks?.SessionStart ?? []).filter(
      (g) => g.id !== "mage:observe:SessionStart",
    );
    await writeLocalSettings(dir, partial);
    const file = join(dir, ".claude", "settings.local.json");
    await chmod(file, 0o400); // read-only → writeClaudeSettings throws inside refreshHookBlock

    try {
      const r = await doctor({ cwd: dir, fix: true }); // must not throw
      const conn = check(r.checks, "connection");
      expect(conn?.ok).toBe(false);
      expect(conn?.detail).toMatch(/auto-fix could not be applied/);
      // file untouched: still drifted on disk
      expect((await localDiff(dir)).matches).toBe(false);
    } finally {
      await chmod(file, 0o600); // restore so afterEach cleanup can unlink
    }
  });

  it("user-scope drift: --fix refreshes ~/.claude/settings.json and preserves foreign keys", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true }); // no LOCAL settings → user-scope fallback
    // Drifted mage block in the (isolated) user settings, plus a foreign key.
    const partial = upsertMageHooks(null) as ClaudeSettings;
    partial.hooks!.SessionStart = (partial.hooks?.SessionStart ?? []).filter(
      (g) => g.id !== "mage:observe:SessionStart",
    );
    (partial as Record<string, unknown>).$schema = "https://example/keep-me";
    const userFile = join(home, ".claude", "settings.json");
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(userFile, `${JSON.stringify(partial, null, 2)}\n`);

    const r = await doctor({ cwd: dir, fix: true });
    const conn = check(r.checks, "connection");
    expect(conn?.ok).toBe(true);
    expect(conn?.detail).toMatch(/user: refreshed drifted mage hook block/);

    const onDisk = JSON.parse(await readFile(userFile, "utf8")) as ClaudeSettings;
    expect(diffMageHooks(onDisk).matches).toBe(true);
    expect((onDisk as Record<string, unknown>).$schema).toBe("https://example/keep-me");
  });
});

describe("doctor — redact pre-commit hook (detect+nudge)", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("installed hook → redact hook check passes", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    await installRedactHook(dir);
    expect(await detectRedactHook(dir)).toBe("present");
    const c = check((await doctor({ cwd: dir })).checks, "redact hook");
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/installed/);
  });

  it("missing hook → advisory nudge (never a hard failure)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const c = check((await doctor({ cwd: dir })).checks, "redact hook");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(true);
    expect(c?.detail).toMatch(/redaction pre-commit hook/);
  });

  it("hubs are skipped (a hub is not a connected code repo)", async () => {
    const hub = await freshDir("mage-hub-");
    await gitInit(hub); // git repo, so the skip is by KB kind, not not-a-repo
    await mkdir(join(hub, "projects"), { recursive: true });
    await writeFile(
      join(hub, "metadata.json"),
      `${JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }, null, 2)}\n`,
    );
    const r = await doctor({ cwd: hub });
    expect(check(r.checks, "redact hook")).toBeUndefined();
  });

  it("--fix never installs the redact hook (detect-only)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    await doctor({ cwd: dir, fix: true });
    // detect-only: --fix must not have written the hook
    expect(await detectRedactHook(dir)).toBe("absent");
  });

  it("a foreign (non-mage) pre-commit hook → advisory ok, KB still passes, never clobbered", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    const FOREIGN = "#!/bin/sh\necho someone-elses-hook\n";
    await writeFile(hookPath, FOREIGN);
    await chmod(hookPath, 0o755);
    expect(await detectRedactHook(dir)).toBe("foreign");

    const r = await doctor({ cwd: dir, fix: true });
    const c = check(r.checks, "redact hook");
    expect(c?.ok).toBe(true);
    expect(c?.optional).toBe(true);
    expect(c?.detail).toMatch(/non-mage pre-commit hook/);
    // never clobbered, even under --fix
    expect(await readFile(hookPath, "utf8")).toBe(FOREIGN);
  });

  it("a symlink at pre-commit → foreign (advisory), never followed/clobbered by --fix", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const target = join(dir, "real-hook.sh");
    await writeFile(target, "#!/bin/sh\necho linked\n");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    await symlink(target, hookPath);
    expect(await detectRedactHook(dir)).toBe("foreign");

    const r = await doctor({ cwd: dir, fix: true });
    expect(check(r.checks, "redact hook")?.optional).toBe(true);
    // still a foreign symlink afterward — --fix neither followed nor replaced it
    expect(await detectRedactHook(dir)).toBe("foreign");
    expect(await readFile(target, "utf8")).toBe("#!/bin/sh\necho linked\n");
  });
});

describe("doctor — metadata schema drift", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  /** Build an in-repo KB whose metadata.json is the prior schema (mage.v1). */
  async function makeV1InRepoKb(dir: string): Promise<void> {
    await gitInit(dir);
    await mkdir(join(dir, "mage"), { recursive: true });
    const meta = {
      schema: METADATA_SCHEMA_V1,
      mode: "in-repo",
      project: "demo",
      hub_path: null,
      hub_repo: null,
      hub_refs: [],
      linked_at: "",
    };
    await writeFile(join(dir, "mage", "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
    await writeFile(join(dir, "mage", "INDEX.md"), "# Index\n");
    await writeFile(join(dir, ".gitignore"), "mage/.mage/\n");
  }

  it("v2 metadata → schema check passes", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const c = check((await doctor({ cwd: dir })).checks, "metadata schema");
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/current/);
  });

  it("v1 metadata → advisory drift nudge (the lenient reader keeps it working)", async () => {
    const dir = await freshDir();
    await makeV1InRepoKb(dir);
    const c = check((await doctor({ cwd: dir })).checks, "metadata schema");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(true);
    expect(c?.detail).toMatch(/mage\.v1/);
    expect(c?.detail).toMatch(/mage migrate|mage doctor --fix/);
  });

  it("--fix migrates v1 metadata to v2 on disk", async () => {
    const dir = await freshDir();
    await makeV1InRepoKb(dir);
    const after = await doctor({ cwd: dir, fix: true });
    const c = check(after.checks, "metadata schema");
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/migrated/);
    const onDisk = JSON.parse(await readFile(join(dir, "mage", "metadata.json"), "utf8"));
    expect(onDisk.schema).toBe(METADATA_SCHEMA);
  });

  it("--fix migrates a v1 hub's metadata to v2 on disk", async () => {
    const hub = await freshDir("mage-hub-");
    await mkdir(join(hub, "projects"), { recursive: true });
    const meta = {
      schema: METADATA_SCHEMA_V1,
      name: "h",
      created_at: "",
      projects: [{ name: "engine", storage: "in-repo", code_repo_path: hub, code_repo_url: "" }],
    };
    await writeFile(join(hub, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const after = await doctor({ cwd: hub, fix: true });
    expect(check(after.checks, "metadata schema")?.detail).toMatch(/migrated/);
    const onDisk = JSON.parse(await readFile(join(hub, "metadata.json"), "utf8"));
    expect(onDisk.schema).toBe(METADATA_SCHEMA);
    expect(onDisk.projects[0].storage).toBe("repo-owned"); // v1 "in-repo" normalized
  });

  // An EXTERNAL-mode code repo resolves to kind "hub" with root=<hub>/projects/<project>
  // but repo=<hub>. The schema check must read the hub's real metadata at kb.repo,
  // not kb.root (which has no metadata.json) — else the check silently vanishes.
  it("external-mode KB: a v1 hub is detected (reads kb.repo, not kb.root) and --fix migrates it", async () => {
    const hub = await freshDir("mage-hub-");
    const repo = await freshDir("mage-ext-");
    await mkdir(join(hub, "projects", "engine"), { recursive: true });
    const hubMeta = {
      schema: METADATA_SCHEMA_V1,
      name: "h",
      created_at: "",
      projects: [{ name: "engine", storage: "hub-owned", code_repo_path: repo, code_repo_url: "" }],
    };
    await writeFile(join(hub, "metadata.json"), `${JSON.stringify(hubMeta, null, 2)}\n`);
    await mkdir(join(repo, "mage"), { recursive: true });
    const repoMeta = {
      schema: METADATA_SCHEMA, // the pointer file itself is current
      mode: "external",
      project: "engine",
      hub_path: hub,
      hub_repo: null,
      hub_refs: [],
      linked_at: "",
    };
    await writeFile(join(repo, "mage", "metadata.json"), `${JSON.stringify(repoMeta, null, 2)}\n`);

    // detect: the v1 hub is flagged from the external repo (would be skipped if keyed on kb.root)
    const before = check((await doctor({ cwd: repo })).checks, "metadata schema");
    expect(before?.ok).toBe(false);
    expect(before?.detail).toMatch(/mage\.v1/);

    // --fix migrates the hub's metadata.json
    const after = await doctor({ cwd: repo, fix: true });
    expect(check(after.checks, "metadata schema")?.detail).toMatch(/migrated/);
    expect(JSON.parse(await readFile(join(hub, "metadata.json"), "utf8")).schema).toBe(
      METADATA_SCHEMA,
    );
  });
});

// ─── bare-parent warning + hub liveness rollup (Decisions 1 + 11B) ────────────

describe("doctor — bare-parent + hub liveness", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("a dir directly above a mage KB warns loudly (BARE PARENT)", async () => {
    const parent = await freshDir();
    const child = join(parent, "proj");
    await mkdir(child, { recursive: true });
    await makeInRepoKb(child, { gitignoreSinks: true });
    const r = await doctor({ cwd: parent });
    const kb = check(r.checks, "mage KB");
    expect(kb?.ok).toBe(false);
    expect(kb?.optional).toBe(true); // loud, but a parent invocation may be intentional
    expect(kb?.detail).toMatch(/BARE PARENT/);
    expect(kb?.detail).toMatch(/captures into nothing/);
  });

  it("a plain empty dir (no child KBs) keeps the benign no-KB note", async () => {
    const dir = await freshDir();
    const r = await doctor({ cwd: dir });
    const kb = check(r.checks, "mage KB");
    expect(kb?.ok).toBe(true);
    expect(kb?.detail).toMatch(/No mage KB here/);
  });

  it("at a hub, rolls up per-project liveness (present + connected, flags the rest)", async () => {
    const hub = await freshDir();
    await mkdir(join(hub, "projects"), { recursive: true });
    // alpha: present + connected (mage hooks wired in its local settings)
    const alpha = await freshDir();
    await mkdir(join(alpha, ".claude"), { recursive: true });
    await writeFile(
      join(alpha, ".claude", "settings.local.json"),
      `${JSON.stringify(upsertMageHooks(null), null, 2)}\n`,
    );
    const meta = {
      schema: METADATA_SCHEMA,
      name: "h",
      created_at: "",
      projects: [
        { name: "alpha", storage: "hub-owned", code_repo_path: alpha, code_repo_url: "" },
        { name: "ghost", storage: "hub-owned", code_repo_path: "/no/such/repo", code_repo_url: "" },
      ],
    };
    await writeFile(join(hub, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const r = await doctor({ cwd: hub });
    const hp = check(r.checks, "hub projects");
    expect(hp).toBeDefined();
    expect(hp?.optional).toBe(true);
    expect(hp?.detail).toMatch(/2 registered/);
    expect(hp?.detail).toMatch(/1 present/);
    expect(hp?.detail).toMatch(/1 connected/);
    expect(hp?.detail).toMatch(/ghost/);
  });

  it("an in-repo KB (not a hub) gets NO hub-projects check", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const r = await doctor({ cwd: dir });
    expect(check(r.checks, "hub projects")).toBeUndefined();
  });
});

// ─── recall + skills readiness (plan-readiness-doctor) ────────────────────────

describe("mageInstalledIn (pure)", () => {
  it("finds the mage@<marketplace> plugin id", () => {
    expect(mageInstalledIn({ plugins: { "mage@mage": [{}], "other@x": [{}] } })).toBe("mage@mage");
  });
  it("returns null when no mage plugin is present", () => {
    expect(mageInstalledIn({ plugins: { "frontend-design@official": [{}] } })).toBeNull();
  });
  it("fail-open on junk shapes", () => {
    expect(mageInstalledIn(null)).toBeNull();
    expect(mageInstalledIn({})).toBeNull();
    expect(mageInstalledIn({ plugins: "nope" })).toBeNull();
  });
});

describe("doctor — recall + skills readiness", () => {
  let home: string;
  let origHome: string | undefined;
  let origCfg: string | undefined;
  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    origCfg = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = join(home, ".claude"); // isolate the plugin registry too
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = origCfg;
  });

  async function writeNotes(dir: string, n: number): Promise<void> {
    await mkdir(join(dir, "mage", "notes"), { recursive: true });
    for (let i = 0; i < n; i++) {
      await writeFile(
        join(dir, "mage", "notes", `n${i}.md`),
        `---\ntype: note\ntags: [demo/room]\n---\n# Note ${i}\nbody\n`,
      );
    }
  }
  async function writeInstalledPlugins(ids: string[]): Promise<void> {
    await mkdir(join(home, ".claude", "plugins"), { recursive: true });
    const plugins = Object.fromEntries(ids.map((id) => [id, [{ scope: "user" }]]));
    await writeFile(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`,
    );
  }
  async function writeAgents(dir: string, capture: string): Promise<void> {
    await writeFile(
      join(dir, "AGENTS.md"),
      `# AGENTS.md\n\n<!-- BEGIN mage -->\ncapture with ${capture}\n<!-- END mage -->\n`,
    );
  }

  // ── skills reachable ──
  it("skills: plugin NOT installed → advisory fail with the /plugin install hint", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const c = check((await doctor({ cwd: dir, quiet: true })).checks, "skills (Claude Code plugin)");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(true);
    expect(c?.detail).toMatch(/plugin install mage@mage/);
  });
  it("skills: mage@mage in the host registry → reachable", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    await writeInstalledPlugins(["frontend-design@official", "mage@mage"]);
    const c = check((await doctor({ cwd: dir, quiet: true })).checks, "skills (Claude Code plugin)");
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/reachable \(mage@mage\)/);
  });

  // ── index freshness ──
  it("index freshness: header count < notes on disk → STALE (advisory); --fix regenerates", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    await writeNotes(dir, 3);
    await writeFile(join(dir, "mage", "INDEX.md"), "# Index\n\n> 0 notes across 1 wing.\n");

    const before = check((await doctor({ cwd: dir, quiet: true })).checks, "index freshness");
    expect(before?.ok).toBe(false);
    expect(before?.optional).toBe(true);
    expect(before?.detail).toMatch(/STALE/);

    const after = check((await doctor({ cwd: dir, fix: true, quiet: true })).checks, "index freshness");
    expect(after?.ok).toBe(true);
    expect(await readFile(join(dir, "mage", "INDEX.md"), "utf8")).toMatch(/> 3 notes/);
  });
  it("index freshness: header matches disk → ok", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true }); // 0 notes on disk
    await writeFile(join(dir, "mage", "INDEX.md"), "# Index\n\n> 0 notes across 1 wing.\n");
    expect(check((await doctor({ cwd: dir, quiet: true })).checks, "index freshness")?.ok).toBe(true);
  });
  it("index freshness: unrecognized header → skipped (no false alarm)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true }); // INDEX is just '# Index\n'
    await writeNotes(dir, 2);
    expect(check((await doctor({ cwd: dir, quiet: true })).checks, "index freshness")).toBeUndefined();
  });

  // ── AGENTS.md awareness ──
  it("AGENTS awareness: a retired /mage-learn in the block → STALE (advisory)", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    await writeAgents(dir, "/mage-learn");
    const c = check((await doctor({ cwd: dir, quiet: true })).checks, "AGENTS.md awareness");
    expect(c?.ok).toBe(false);
    expect(c?.optional).toBe(true);
    expect(c?.detail).toMatch(/\/mage-learn/);
  });
  it("AGENTS awareness: current `mage:learn` → ok", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    await writeAgents(dir, "mage:learn");
    expect(check((await doctor({ cwd: dir, quiet: true })).checks, "AGENTS.md awareness")?.ok).toBe(true);
  });
  it("AGENTS awareness: no AGENTS.md → check skipped", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    expect(check((await doctor({ cwd: dir, quiet: true })).checks, "AGENTS.md awareness")).toBeUndefined();
  });

  // ── readiness footer (advisory; never throws) ──
  it("readinessFooter resolves without throwing", async () => {
    const dir = await freshDir();
    await makeInRepoKb(dir, { gitignoreSinks: true });
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await expect(readinessFooter(dir)).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
