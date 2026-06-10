import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClaudeSettings,
  MAGE_HOOKS,
  diffMageHooks,
  upsertMageHooks,
} from "../claude-settings.js";
import { gitInit } from "../git.js";
import { METADATA_SCHEMA } from "../paths.js";
import { doctor } from "./doctor.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function freshDir(prefix = "mage-doctor-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Find a check by name in a DoctorResult. */
function check(checks: Array<{ name: string }>, name: string) {
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
    await writeFile(join(dir, ".gitignore"), "mage/.learnings/\nmage/.metrics/\n");
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

  it("empty settings → not connected", () => {
    expect(diffMageHooks({})).toMatchObject({ connected: false, matches: false });
  });

  it("null settings → not connected", () => {
    const d = diffMageHooks(null);
    expect(d.connected).toBe(false);
    expect(d.matches).toBe(false);
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
    expect(gi).toContain("mage/.learnings/");
    expect(gi).toContain("mage/.metrics/");
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
    await mkdir(join(dir, "mage", ".learnings"), { recursive: true });
    await writeFile(
      join(dir, "mage", ".learnings", "s1.jsonl"),
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

  it("MAGE_HOOKS length is the expected hook count used by the connection check", () => {
    expect(MAGE_HOOKS.length).toBe(8);
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
