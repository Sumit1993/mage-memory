import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { gitInit } from "../git.js";
import { REDACT_HOOK_MARKER, resolveHooksDir } from "../git-hooks.js";
import { upsertMageHooks } from "../adapters/claude-code/settings.js";
import { canonicalizeHubRepo } from "../hub-url.js";
import { logger } from "../logger.js";
import { connect, connectAllProjects } from "./connect.js";
import { disconnect } from "./disconnect.js";

async function freshDir(): Promise<string> {
  return tmpDir("mage-connect-");
}

function localPath(dir: string): string {
  return join(dir, ".claude", "settings.local.json");
}

async function exists(p: string): Promise<boolean> {
  try {
    await readFile(p, "utf8");
    return true;
  } catch {
    return false;
  }
}

describe("connect", () => {
  it("connect into a fresh dir creates settings.local.json with all 10 mage groups", async () => {
    const dir = await freshDir();
    const r = await connect({ cwd: dir, yes: true });

    expect(r.scope).toBe("local");
    expect(r.path).toBe(localPath(dir));
    expect(r.wired).toBe(10);

    const settings = JSON.parse(await readFile(r.path, "utf8")) as {
      hooks: Record<string, Array<{ id?: string }>>;
    };
    const ids = Object.values(settings.hooks)
      .flat()
      .map((g) => g.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("mage:"));
    expect(ids).toHaveLength(10);
    expect(new Set(ids)).toEqual(
      new Set([
        "mage:observe:SessionStart",
        "mage:nudge:SessionStart",
        "mage:observe:UserPromptSubmit",
        "mage:observe:PostToolUse",
        "mage:observe:PostToolUseFailure",
        "mage:observe:PreCompact",
        "mage:observe:SessionEnd",
        "mage:metrics:Stop",
        "mage:observe:Stop",
        "mage:observe:SubagentStop",
      ]),
    );
  });

  // ─── commandeer tier (ADR-0032) ──────────────────────────────────────────────

  it("commandeers in a KB with auto-memory on: wires 13 + sets autoMemoryDirectory", async () => {
    const { dir, root } = await withKb({ kind: "repo" });
    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.commandeer).toBe(true);
    expect(r.wired).toBe(13);
    const settings = JSON.parse(await readFile(r.path, "utf8")) as {
      autoMemoryDirectory?: string;
      hooks: Record<string, Array<{ id?: string; matcher?: string }>>;
    };
    expect(settings.autoMemoryDirectory).toBe(root);
    const pre = settings.hooks.PreToolUse ?? [];
    expect(pre[0]?.id).toBe("mage:memory:PreToolUse");
    expect(pre[0]?.matcher).toBe("Write|Edit");
  });

  it("does NOT commandeer when auto-memory is disabled (10 groups, no autoMemoryDirectory)", async () => {
    const { dir } = await withKb({ kind: "repo" });
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), JSON.stringify({ autoMemoryEnabled: false }));
    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.commandeer).toBe(false);
    expect(r.wired).toBe(10);
    const settings = JSON.parse(await readFile(r.path, "utf8")) as {
      autoMemoryDirectory?: string;
      hooks: Record<string, unknown[]>;
    };
    expect(settings.autoMemoryDirectory).toBeUndefined();
    expect(settings.hooks.PreToolUse).toBeUndefined();
  });

  it("does NOT commandeer in a fresh non-KB dir (no docs root resolves)", async () => {
    const r = await connect({ cwd: await freshDir(), yes: true });
    expect(r.commandeer).toBe(false);
    expect(r.wired).toBe(10);
  });

  it("stashes a user's own autoMemoryDirectory before displacing it", async () => {
    const { dir, root } = await withKb({ kind: "repo" });
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), JSON.stringify({ autoMemoryDirectory: "/my/own/dir" }));
    await connect({ cwd: dir, yes: true, gitHook: false });
    const settings = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      autoMemoryDirectory?: string;
      mageStashedAutoMemoryDirectory?: string;
    };
    expect(settings.autoMemoryDirectory).toBe(root); // displaced to the KB
    expect(settings.mageStashedAutoMemoryDirectory).toBe("/my/own/dir"); // preserved for restore
  });

  it("stashes a user value even when it already equals the KB root (so disconnect restores, not deletes)", async () => {
    // F10: a user who explicitly set autoMemoryDirectory = the KB root must not have it
    // silently deleted by a connect/disconnect round-trip.
    const { dir, root } = await withKb({ kind: "repo" });
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), JSON.stringify({ autoMemoryDirectory: root }));
    await connect({ cwd: dir, yes: true, gitHook: false });
    const settings = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      autoMemoryDirectory?: string;
      mageStashedAutoMemoryDirectory?: string;
    };
    expect(settings.autoMemoryDirectory).toBe(root);
    expect(settings.mageStashedAutoMemoryDirectory).toBe(root); // stashed → disconnect restores it
  });

  it("reconnect with auto-memory now OFF releases the relocation and restores the stashed user value", async () => {
    // F3: the commandeer tier gating OFF must reconcile autoMemoryDirectory, never leave
    // CC writing memories to the KB with no Gate-0 scrub.
    const { dir } = await withKb({ kind: "repo" });
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), JSON.stringify({ autoMemoryDirectory: "/my/own/dir" }));
    await connect({ cwd: dir, yes: true, gitHook: false }); // commandeers, stashes /my/own/dir

    // User disables auto-memory, then reconnects.
    const wired = JSON.parse(await readFile(localPath(dir), "utf8"));
    wired.autoMemoryEnabled = false;
    await writeFile(localPath(dir), JSON.stringify(wired));
    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.commandeer).toBe(false);

    const settings = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      autoMemoryDirectory?: string;
      mageStashedAutoMemoryDirectory?: string;
      hooks?: Record<string, unknown>;
    };
    expect(settings.autoMemoryDirectory).toBe("/my/own/dir"); // restored, not left at the KB
    expect(settings.mageStashedAutoMemoryDirectory).toBeUndefined(); // stash cleared
    expect(settings.hooks?.PreToolUse).toBeUndefined(); // commandeer scrub hooks stripped
  });

  it("reconnect with auto-memory OFF and no prior user value drops mage's KB relocation", async () => {
    // F3 (no-stash branch): mage commandeered a KB with no pre-existing user value; turning
    // auto-memory off must delete mage's autoMemoryDirectory, not strand it.
    const { dir, root } = await withKb({ kind: "repo" });
    await connect({ cwd: dir, yes: true, gitHook: false }); // commandeers, autoMemoryDirectory = root
    let settings = JSON.parse(await readFile(localPath(dir), "utf8"));
    expect(settings.autoMemoryDirectory).toBe(root);

    settings.autoMemoryEnabled = false;
    await writeFile(localPath(dir), JSON.stringify(settings));
    await connect({ cwd: dir, yes: true, gitHook: false });
    settings = JSON.parse(await readFile(localPath(dir), "utf8"));
    expect(settings.autoMemoryDirectory).toBeUndefined();
    expect(settings.mageStashedAutoMemoryDirectory).toBeUndefined();
  });

  it("merges into a pre-existing file preserving its content + makes a .bak", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const pre = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "host-thing" }] }],
      },
    };
    await writeFile(localPath(dir), `${JSON.stringify(pre, null, 2)}\n`);

    const r = await connect({ cwd: dir, yes: true });
    expect(r.wired).toBe(10);
    expect(r.backedUp).toBe(true);

    // .bak preserves the original verbatim
    expect(await exists(`${localPath(dir)}.bak`)).toBe(true);
    const bak = JSON.parse(await readFile(`${localPath(dir)}.bak`, "utf8"));
    expect(bak).toEqual(pre);

    const settings = JSON.parse(await readFile(r.path, "utf8")) as {
      permissions: { allow: string[] };
      hooks: Record<string, Array<{ id?: string; hooks: Array<{ command: string }> }>>;
    };
    // unknown top-level key survives untouched
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    // host's own SessionStart group is preserved alongside the mage one
    const hostGroup = settings.hooks.SessionStart?.find((g) => g.hooks[0]?.command === "host-thing");
    expect(hostGroup).toBeTruthy();
    const mageGroup = settings.hooks.SessionStart?.find((g) => g.id === "mage:observe:SessionStart");
    expect(mageGroup).toBeTruthy();
  });

  it("re-connect is idempotent", async () => {
    const dir = await freshDir();
    await connect({ cwd: dir, yes: true });
    const after1 = await readFile(localPath(dir), "utf8");

    const r2 = await connect({ cwd: dir, yes: true });
    const after2 = await readFile(localPath(dir), "utf8");

    expect(r2.wired).toBe(10);
    expect(after2).toBe(after1);

    // still exactly 10 mage groups (no duplication)
    const settings = JSON.parse(after2) as { hooks: Record<string, Array<{ id?: string }>> };
    const ids = Object.values(settings.hooks)
      .flat()
      .map((g) => g.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("mage:"));
    expect(ids).toHaveLength(10);
  });

  it("--user targets the user path", async () => {
    const dir = await freshDir();
    // resolveSettingsTarget for user maps to homedir()/.claude/settings.json; assert scope + path tail.
    const home = await tmpDir("mage-home-");
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // gitHook:false + a non-git temp cwd so this --user settings test never
      // installs a pre-commit hook into the REAL repo via process.cwd() (the git
      // hook target is independent of the --user settings target).
      const r = await connect({ user: true, yes: true, cwd: dir, gitHook: false });
      expect(r.scope).toBe("user");
      expect(r.path.endsWith(join(".claude", "settings.json"))).toBe(true);
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  });

  it("malformed JSON -> connect throws and does NOT write", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), "{ not json");

    await expect(connect({ cwd: dir, yes: true })).rejects.toThrow(/malformed JSON/i);

    // file is untouched and NO backup written
    expect(await readFile(localPath(dir), "utf8")).toBe("{ not json");
    expect(await exists(`${localPath(dir)}.bak`)).toBe(false);
  });

  // ─── Gate-2 redaction pre-commit hook (ADR-0018 §7) ─────────────────────────

  it("in a non-repo dir, connect installs no hook (result.hook reports not-a-repo)", async () => {
    const dir = await freshDir();
    const r = await connect({ cwd: dir, yes: true });
    expect(r.wired).toBe(10);
    expect(r.hook).toEqual({ installed: false, reason: "not-a-repo" });
  });

  it("in a git repo, connect installs an executable pre-commit hook with the marker", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    const r = await connect({ cwd: dir, yes: true });
    expect(r.hook?.installed).toBe(true);

    const hooksDir = await resolveHooksDir(dir);
    const hookPath = join(hooksDir as string, "pre-commit");
    const body = await readFile(hookPath, "utf8");
    expect(body).toContain(REDACT_HOOK_MARKER);
    expect(body).toContain("mage redact --check --staged");

    const st = await stat(hookPath);
    expect(st.mode & 0o100).toBe(0o100);
  });

  it("re-connecting in a git repo reports the hook as already present", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    await connect({ cwd: dir, yes: true });
    const r2 = await connect({ cwd: dir, yes: true });
    expect(r2.hook).toEqual({ installed: false, reason: "already" });
  });

  it("a pre-existing foreign pre-commit hook is left untouched (exists-foreign)", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    const hooksDir = await resolveHooksDir(dir);
    const hookPath = join(hooksDir as string, "pre-commit");
    const foreign = "#!/bin/sh\necho host-hook\n";
    await writeFile(hookPath, foreign);

    const r = await connect({ cwd: dir, yes: true });
    expect(r.hook).toEqual({ installed: false, reason: "exists-foreign" });
    // foreign hook preserved verbatim
    expect(await readFile(hookPath, "utf8")).toBe(foreign);
  });

  it("gitHook:false skips the hook entirely (no hook written, no result.hook)", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.wired).toBe(10);
    expect(r.hook).toBeUndefined();

    const hooksDir = await resolveHooksDir(dir);
    const hookPath = join(hooksDir as string, "pre-commit");
    expect(await exists(hookPath)).toBe(false);
  });

  // ─── Capture-sink gitignore self-heal (ADR-0021) ────────────────────────────

  async function readGitignore(dir: string): Promise<string> {
    try {
      return await readFile(join(dir, ".gitignore"), "utf8");
    } catch {
      return "";
    }
  }

  it("in-repo KB: connect gitignores the mage/-prefixed capture sinks at the repo root", async () => {
    // A mage/metadata.json makes resolveDocsRoot return kind 'in-repo' (repo = dir).
    const { dir } = await withKb({ kind: "repo" });

    await connect({ cwd: dir, yes: true, gitHook: false });

    const gi = await readGitignore(dir);
    const lines = gi.split(/\r?\n/);
    expect(lines).toContain("mage/.mage/");
  });

  it("in-repo KB: re-running connect is idempotent (no duplicate sink patterns)", async () => {
    const { dir } = await withKb({ kind: "repo" });

    await connect({ cwd: dir, yes: true, gitHook: false });
    const after1 = await readGitignore(dir);
    await connect({ cwd: dir, yes: true, gitHook: false });
    const after2 = await readGitignore(dir);

    expect(after2).toBe(after1);
    const count = (pat: string) =>
      after2.split(/\r?\n/).filter((l) => l === pat).length;
    expect(count("mage/.mage/")).toBe(1);
  });

  it("in-repo KB under --user: sink self-heal still runs when cwd is inside the KB", async () => {
    // A mage/metadata.json makes resolveDocsRoot return kind 'in-repo' (repo = dir).
    const { dir } = await withKb({ kind: "repo" });

    // Isolate HOME so --user targets a throwaway settings file, not the real one.
    const home = await tmpDir("mage-home-");
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // --user targets ~/.claude/settings.json, but the sink ignores key off cwd,
      // which is inside the KB — so they MUST still be written at the repo root.
      await connect({ user: true, cwd: dir, yes: true, gitHook: false });
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }

    const lines = (await readGitignore(dir)).split(/\r?\n/);
    expect(lines).toContain("mage/.mage/");
  });

  it("hub KB: connect gitignores the hub capture-sink patterns at the hub root", async () => {
    // A projects/ dir + root metadata.json makes resolveDocsRoot return kind 'hub'.
    const { dir } = await withKb({ kind: "hub" });

    await connect({ cwd: dir, yes: true, gitHook: false });

    const lines = (await readGitignore(dir)).split(/\r?\n/);
    for (const pat of [".mage/", "**/.mage/"]) {
      expect(lines).toContain(pat);
    }
  });

  it("fresh non-KB dir: connect does not crash and writes no sink gitignore rules", async () => {
    const dir = await freshDir();
    // No mage/, no projects/ → resolveDocsRoot returns null → self-heal skipped.
    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.wired).toBe(10);

    // No .gitignore created for the capture sinks.
    expect(await exists(join(dir, ".gitignore"))).toBe(false);
  });
});

describe("connect --all-projects (Decision 11C)", () => {
  async function makeHubWithProjects(
    projects: Array<{ name: string; code_repo_path: string }>,
  ): Promise<string> {
    const { dir } = await withKb({
      kind: "hub",
      projects: projects.map((p) => ({
        name: p.name,
        storage: "hub-owned",
        code_repo_path: p.code_repo_path,
        code_repo_url: "",
      })),
    });
    return dir;
  }

  it("wires every registered project's code repo (repo-local each)", async () => {
    const a = await freshDir();
    const b = await freshDir();
    const hub = await makeHubWithProjects([
      { name: "alpha", code_repo_path: a },
      { name: "beta", code_repo_path: b },
    ]);
    const r = await connectAllProjects({ cwd: hub, yes: true, gitHook: false });
    expect(r.wired).toBe(2);
    expect(await exists(localPath(a))).toBe(true);
    expect(await exists(localPath(b))).toBe(true);
  });

  it("skips a project whose code repo is absent here, wires the rest", async () => {
    const a = await freshDir();
    const hub = await makeHubWithProjects([
      { name: "alpha", code_repo_path: a },
      { name: "ghost", code_repo_path: "/no/such/repo/here" },
    ]);
    const r = await connectAllProjects({ cwd: hub, yes: true, gitHook: false });
    expect(r.wired).toBe(1);
    expect(r.projects.find((p) => p.project === "ghost")?.skipped).toMatch(/not present/);
    expect(await exists(localPath(a))).toBe(true);
  });

  it("a hub with no projects wires nothing (no throw)", async () => {
    const hub = await makeHubWithProjects([]);
    const r = await connectAllProjects({ cwd: hub, yes: true, gitHook: false });
    expect(r.wired).toBe(0);
    expect(r.projects).toEqual([]);
  });

  it("throws when not run from a hub", async () => {
    const notHub = await freshDir();
    await expect(connectAllProjects({ cwd: notHub, yes: true })).rejects.toThrow(
      /must run from a mage hub/,
    );
  });
});

// ─── commandeer-coverage (ADR-0034 §6-7) ──────────────────────────────────────
describe("connect commandeer-coverage", () => {
  /** A fake `~/.claude/projects/<slug>/` with one in-shape memory + a transcript cwd. */
  async function ccMemory(home: string, slug: string, cwd: string): Promise<void> {
    const projectDir = join(home, "projects", slug);
    await mkdir(join(projectDir, "memory"), { recursive: true });
    await writeFile(
      join(projectDir, "memory", "lesson.md"),
      '---\nname: ""\nmetadata:\n  node_type: memory\n  type: gotcha\n  originSessionId: s\n---\n# Lesson\n\nbody.\n',
    );
    await writeFile(join(projectDir, "s.jsonl"), `${JSON.stringify({ cwd })}\n`);
  }

  it("non-interactive connect surfaces sibling-cwd orphans but NEVER auto-adopts", async () => {
    const { dir, root, repo } = await withKb({ kind: "repo" });
    const home = await tmpDir("cc-home");
    // A sibling cwd whose memory resolves to THIS KB.
    await ccMemory(home, "-sibling", repo);

    const r = await connect({ cwd: dir, yes: true, gitHook: false, home });
    expect(r.commandeer).toBe(true);
    // §6: non-interactive connect prints the nudge only — it must not place anything.
    expect(await exists(join(root, "lesson.md"))).toBe(false);
  });
});

describe("reach tier — connect grants out-of-repo KB access (ADR-0042)", () => {
  /** An external-mode code repo pointing at a hub that exists on disk. */
  async function externalRepo(opts: { hubExists: boolean }): Promise<{
    code: string;
    hub: string;
  }> {
    const hub = await tmpDir("mage-reach-hub-");
    const code = await tmpDir("mage-reach-code-");
    if (opts.hubExists) {
      await mkdir(join(hub, "projects", "engine"), { recursive: true });
      await writeFile(
        join(hub, "metadata.json"),
        JSON.stringify({ schema: "mage.v2", name: "h", created_at: "", projects: [] }),
      );
    }
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: "mage.v2",
        mode: "external",
        project: "engine",
        hub_path: opts.hubExists ? hub : join(hub, "gone"),
        hub_repo: null,
        hub_refs: [],
        linked_at: "",
      }),
    );
    return { code, hub };
  }

  it("grants the hub repo root and records mage ownership", async () => {
    const { code, hub } = await externalRepo({ hubExists: true });
    const r = await connect({ cwd: code, yes: true, gitHook: false });

    expect(r.reach).toEqual([hub]);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.permissions.additionalDirectories).toEqual([hub]);
    expect(s.mageOwnedAdditionalDirectories).toEqual([hub]);
  });

  it("grants independently of the commandeer tier — auto-memory OFF still reaches the hub", async () => {
    const { code, hub } = await externalRepo({ hubExists: true });
    // Pre-seed auto-memory disabled: the commandeer tier gates off, reach must not.
    await mkdir(join(code, ".claude"), { recursive: true });
    await writeFile(
      localPath(code),
      `${JSON.stringify({ autoMemoryEnabled: false }, null, 2)}\n`,
    );

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.commandeer).toBe(false);
    expect(r.reach).toEqual([hub]);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.permissions.additionalDirectories).toEqual([hub]);
  });

  it("skips the grant when the hub is absent on this machine", async () => {
    const { code } = await externalRepo({ hubExists: false });
    const r = await connect({ cwd: code, yes: true, gitHook: false });

    expect(r.reach).toEqual([]);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.permissions?.additionalDirectories).toBeUndefined();
    expect(s.mageOwnedAdditionalDirectories).toBeUndefined();
  });

  it("an absent hub does not abort connect — hooks still wire (regression)", async () => {
    // Regression: ensureSinkIgnores used to throw ENOENT when mode=external resolved
    // through a hub_path absent on this machine, so connect died before finishing.
    // The committed hub_path is machine-specific, so this is the normal state on a
    // fresh clone — it must degrade to a nudge, never an exception (ADR-0042 §7).
    const { code } = await externalRepo({ hubExists: false });
    const r = await connect({ cwd: code, yes: true, gitHook: false });

    // 10 base hooks: resolveDocsRoot returns null when hub is absent, so commandeer
    // tier does not gate on (autoMemoryDirectory not set to repo mage/). The point is that connect COMPLETES.
    expect(r.wired).toBe(10);
    expect(r.commandeer).toBe(false);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.hooks?.SessionStart?.some((g: { id?: string }) => g.id === "mage:observe:SessionStart")).toBe(
      true,
    );
  });

  it("SAYS WHY the commandeer tier declined when the hub is unreachable (#158)", async () => {
    // The decline is correct (ADR-0032 gates autoMemoryDirectory on a resolvable docs
    // root, and pointing it at the repo `mage/` would misfile into a second KB) — but a
    // silent decline is the same absent-vs-healthy blind spot one level out.
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { code, hub } = await externalRepo({ hubExists: false });
      const r = await connect({ cwd: code, yes: true, gitHook: false });
      expect(r.commandeer).toBe(false);
      const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(said).toMatch(/Skipping the commandeer tier/);
      expect(said).toContain(hub);
      expect(said).toMatch(/mage connect/);
      expect(said).toMatch(/Do NOT run `mage init`/);
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses to grant a directory that exists but is NOT a hub", async () => {
    // `mage/metadata.json` is git-tracked, so hub_path is untrusted: anyone who can land
    // a commit could point it at ~/.ssh or / and have connect widen harness access to it.
    // Existence alone must never be enough — the target must look like a mage hub.
    const victim = await tmpDir("mage-reach-notahub-");
    await writeFile(join(victim, "id_rsa"), "PRIVATE");
    const code = await tmpDir("mage-reach-evil-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: "mage.v2",
        mode: "external",
        project: "engine",
        hub_path: victim,
        hub_repo: null,
        hub_refs: [],
        linked_at: "",
      }),
    );

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.reach).toEqual([]);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.permissions?.additionalDirectories).toBeUndefined();
    expect(s.mageOwnedAdditionalDirectories).toBeUndefined();
  });

  it("an in-repo KB is granted nothing", async () => {
    const { dir } = await withKb({});
    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.reach).toEqual([]);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.mageOwnedAdditionalDirectories).toBeUndefined();
  });

  it("is idempotent — re-connecting does not duplicate the grant", async () => {
    const { code, hub } = await externalRepo({ hubExists: true });
    await connect({ cwd: code, yes: true, gitHook: false });
    const r = await connect({ cwd: code, yes: true, gitHook: false });

    expect(r.reach).toEqual([hub]);
    const s = JSON.parse(await readFile(r.path, "utf8"));
    expect(s.permissions.additionalDirectories).toEqual([hub]);
  });

  it("--user scope writes no grant (machine-specific paths stay out of the shared file)", async () => {
    const { code } = await externalRepo({ hubExists: true });
    const home = await tmpDir("mage-home-");
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const r = await connect({ cwd: code, yes: true, user: true, gitHook: false });
      expect(r.reach).toEqual([]);
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  });
});

// ─── reach tier — hub_repo derivation (ADR-0043) ───────────────────────────

describe("reach tier — hub_repo derivation (ADR-0043)", () => {
  const savedMageHome = process.env.MAGE_HOME;
  let mageHome: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mageHome = await tmpDir("mage-connect-derive-home-");
    process.env.MAGE_HOME = mageHome;
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (savedMageHome === undefined) delete process.env.MAGE_HOME;
    else process.env.MAGE_HOME = savedMageHome;
  });

  async function makeHubClone(path: string, origin: string): Promise<void> {
    await mkdir(join(path, "projects", "engine"), { recursive: true });
    await writeFile(
      join(path, "metadata.json"),
      JSON.stringify({ schema: "mage.v2", name: "h", created_at: "", projects: [] }),
    );
    await mkdir(join(path, ".git"), { recursive: true });
    await writeFile(join(path, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
  }

  async function externalCodeRepo(opts: {
    hubRepo: string | null;
    hubPath: string | null;
  }): Promise<string> {
    const code = await tmpDir("mage-connect-derive-code-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: "mage.v2",
        mode: "external",
        project: "engine",
        hub_path: opts.hubPath,
        hub_repo: opts.hubRepo,
        hub_refs: [],
        linked_at: "",
      }),
    );
    return code;
  }

  it("origin match → the derived hub is used and granted", async () => {
    const hubRepo = "https://github.com/acme/docs.git";
    const derived = join(mageHome, "hubs", "github.com", "acme", "docs");
    await makeHubClone(derived, hubRepo);
    const code = await externalCodeRepo({ hubRepo, hubPath: null });

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.reach).toEqual([derived]);
  });

  it("origin mismatch is a hard, named failure — never granted, both remotes named + redacted", async () => {
    const hubRepo = "https://x-access-token:ghp_WANTED@github.com/acme/docs.git";
    const derived = join(mageHome, "hubs", "github.com", "acme", "docs");
    // A DIFFERENT remote sits at the derived location.
    await makeHubClone(derived, "https://x-access-token:ghp_ACTUAL@github.com/other/repo.git");
    const code = await externalCodeRepo({ hubRepo, hubPath: null });

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.reach).toEqual([]);

    const combined = logs.join("\n");
    expect(combined).toMatch(/mismatch/i);
    expect(combined).toContain("github.com/acme/docs");
    expect(combined).toContain("github.com/other/repo");
    expect(combined).not.toContain("ghp_WANTED");
    expect(combined).not.toContain("ghp_ACTUAL");
  });

  it("derived absent + a valid hub_path → falls back to hub_path and grants it, with a deprecation notice", async () => {
    const hubRepo = "https://github.com/acme/docs.git"; // derives to a path nothing lives at
    const legacyHub = await tmpDir("mage-connect-legacy-hub-");
    await mkdir(join(legacyHub, "projects"), { recursive: true });
    await writeFile(
      join(legacyHub, "metadata.json"),
      JSON.stringify({ schema: "mage.v2", name: "h", created_at: "", projects: [] }),
    );
    const code = await externalCodeRepo({ hubRepo, hubPath: legacyHub });

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.reach).toEqual([legacyHub]);
    expect(logs.join("\n")).toMatch(/deprecated/i);
  });

  it("a displaced clone with a matching origin is SUGGESTED (mv), never moved, never granted", async () => {
    const hubRepo = "https://github.com/acme/docs.git";
    const derived = join(mageHome, "hubs", "github.com", "acme", "docs");
    const displaced = join(mageHome, "hubs", "github.com", "old-acme", "old-docs");
    await makeHubClone(displaced, hubRepo);
    const code = await externalCodeRepo({ hubRepo, hubPath: null });

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.reach).toEqual([]);
    expect(await exists(join(derived, "metadata.json"))).toBe(false); // never moved
    expect(await exists(join(displaced, "metadata.json"))).toBe(true); // still there
    const combined = logs.join("\n");
    expect(combined).toContain(displaced);
    expect(combined).toMatch(/mv/);
  });

  it("two displaced clones → the FIRST in sorted order is suggested, deterministically", async () => {
    const hubRepo = "https://github.com/acme/docs.git";
    // Create in reverse-sorted order to prove the pick is sort-based, not creation-order.
    const zLoc = join(mageHome, "hubs", "github.com", "z-owner", "docs");
    const aLoc = join(mageHome, "hubs", "github.com", "a-owner", "docs");
    await makeHubClone(zLoc, hubRepo);
    await makeHubClone(aLoc, hubRepo);
    const code = await externalCodeRepo({ hubRepo, hubPath: null });

    const r = await connect({ cwd: code, yes: true, gitHook: false });
    expect(r.reach).toEqual([]);
    const combined = logs.join("\n");
    expect(combined).toContain(aLoc);
    expect(combined).not.toContain(zLoc);
  });

  it("a hybrid ref whose derived hub does not exist yet still reaches the grant decision (not silently dropped)", async () => {
    const hubRepo = "https://github.com/acme/docs.git";
    const { dir } = await withKb({ kind: "repo" }); // an in-repo KB registering a hybrid hub_ref
    const meta = JSON.parse(await readFile(join(dir, "mage", "metadata.json"), "utf8"));
    meta.mode = "hybrid";
    meta.hub_refs = [{ hub_path: "/nonexistent/legacy", hub_repo: hubRepo, project: "p" }];
    await writeFile(join(dir, "mage", "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.reach).toEqual([]);
    // The candidate reached the grant decision (and was reported), rather than the
    // hub_ref vanishing before ever being considered — the v1 drift bug this spec
    // calls out (one lookup gated on existsSync, one didn't, so a not-yet-cloned
    // hub_ref's grant was silently skipped with no trace at all).
    expect(logs.join("\n")).toMatch(/hub not found|clone/i);
  });

  it("--yes reaches the clone path while non-yes non-interactive path does not clone", async () => {
    const hubRepo = "https://github.com/acme/docs.git";
    const code = await externalCodeRepo({ hubRepo, hubPath: null });

    // 1. Non-yes non-interactive run: shouldClone is false, never attempts clone
    logs.length = 0;
    const rNoYes = await connect({ cwd: code, yes: false, gitHook: false });
    expect(rNoYes.reach).toEqual([]);
    expect(logs.join("\n")).toContain("interactively or with `--yes` to clone it now");
    expect(logs.join("\n")).not.toContain("Clone into");

    // 2. --yes run: shouldClone is true, reaches clone path
    logs.length = 0;
    const rYes = await connect({ cwd: code, yes: true, gitHook: false });
    expect(rYes.reach).toEqual([]);
    expect(logs.join("\n")).toMatch(/Clone into .* failed/);
  });

  it("canonicalizeHubRepo agrees with what connect derived (sanity check on the fixture paths above)", () => {
    expect(canonicalizeHubRepo("https://github.com/acme/docs.git").key).toBe("github.com/acme/docs");
  });

  // ─── issue #150 idempotency ──────────────────────────────────────────────────

  it("running connect twice produces exactly one registration per hook", async () => {
    const dir = await freshDir();
    await connect({ cwd: dir, yes: true });
    await connect({ cwd: dir, yes: true });

    const settings = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      hooks: Record<string, Array<{ id?: string; hooks: Array<{ command: string }> }>>;
    };

    for (const groups of Object.values(settings.hooks)) {
      const commands = groups.flatMap((g) => g.hooks.map((h) => h.command));
      expect(commands.length).toBe(new Set(commands).size);
    }
  });

  it("running connect on a config with foreign hooks leaves foreign hooks byte-identical and in original order", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const initialSettings = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "context-mode observe" }] },
          { hooks: [{ type: "command", command: "block-no-verify check" }] },
        ],
        Stop: [
          { hooks: [{ type: "command", command: "foreign-tool stop" }] },
        ],
      },
    };
    await writeFile(localPath(dir), `${JSON.stringify(initialSettings, null, 2)}\n`);

    await connect({ cwd: dir, yes: true });

    const updated = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    const sessionStartForeign = (updated.hooks.SessionStart ?? []).slice(0, 2);
    expect(sessionStartForeign).toEqual(initialSettings.hooks.SessionStart);

    const stopForeign = (updated.hooks.Stop ?? [])[0];
    expect(stopForeign).toEqual(initialSettings.hooks.Stop[0]);
  });

  it("running connect on a config with un-id'd or duplicate mage hooks collapses them to 1x", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const initialSettings = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "mage observe" }] },
          { hooks: [{ type: "command", command: "mage observe" }] },
          { hooks: [{ type: "command", command: "mage nudge" }] },
        ],
      },
    };
    await writeFile(localPath(dir), `${JSON.stringify(initialSettings, null, 2)}\n`);

    await connect({ cwd: dir, yes: true });

    const updated = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      hooks: Record<string, Array<{ id?: string; hooks: Array<{ command: string }> }>>;
    };

    const sessionStartCommands = (updated.hooks.SessionStart ?? []).flatMap((g) => g.hooks.map((h) => h.command));
    expect(sessionStartCommands).toEqual(["mage observe", "mage nudge"]);
  });
});

// ─── #150: legacy id-less orphans + closed-list ownership ────────────────────

describe("connect — legacy orphan reaping (#150)", () => {
  /** Read the local settings back as a hook map. */
  async function readHooks(dir: string) {
    const parsed = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      hooks: Record<string, Array<{ id?: string; matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    return parsed.hooks;
  }

  async function seed(dir: string, settings: unknown): Promise<void> {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), `${JSON.stringify(settings, null, 2)}\n`);
  }

  it("a user's own `mage learn` hook survives connect AND disconnect", async () => {
    const dir = await freshDir();
    const mine = { hooks: [{ type: "command", command: "mage learn --auto" }] };
    await seed(dir, { hooks: { Stop: [mine] } });

    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.reaped).toBe(0);
    expect(await readHooks(dir).then((h) => h.Stop)).toContainEqual(mine);

    await disconnect({ cwd: dir, yes: true, gitHook: false });
    expect(await readHooks(dir).then((h) => h.Stop)).toEqual([mine]);
  });

  it("a two-command group holding one foreign command is never deleted", async () => {
    const dir = await freshDir();
    const mixed = {
      hooks: [
        { type: "command", command: "foreign-tool stop" },
        { type: "command", command: "mage observe" },
      ],
    };
    await seed(dir, { hooks: { Stop: [mixed] } });

    await connect({ cwd: dir, yes: true, gitHook: false });
    expect(await readHooks(dir).then((h) => h.Stop)).toContainEqual(mixed);

    await disconnect({ cwd: dir, yes: true, gitHook: false });
    expect(await readHooks(dir).then((h) => h.Stop)).toEqual([mixed]);
  });

  it("the live dark state — 30 id-less orphans BESIDE 10 tagged groups — collapses to exactly 10", async () => {
    const dir = await freshDir();
    // Measured shape of ~/.claude/settings.json on 2026-08-22: a pre-id mage's groups
    // never reaped, so 40 registrations fire where 10 should.
    const tagged = upsertMageHooks(null).settings;
    const seeded: Record<string, unknown[]> = {};
    for (const [event, groups] of Object.entries(tagged.hooks ?? {})) {
      const orphans = groups.flatMap((g) =>
        [0, 1, 2].map(() => ({
          ...(g.matcher ? { matcher: g.matcher } : {}),
          hooks: g.hooks.map((h) => ({ ...h })),
        })),
      );
      seeded[event] = [...orphans, ...groups];
    }
    await seed(dir, { hooks: seeded });
    expect(Object.values(seeded).flat()).toHaveLength(40);

    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.reaped).toBe(30);

    const after = Object.values(await readHooks(dir)).flat();
    expect(after).toHaveLength(10);
    expect(after.filter((g) => !g.id?.startsWith("mage:"))).toEqual([]);
  });
});
