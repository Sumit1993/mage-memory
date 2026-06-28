import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { gitInit } from "../git.js";
import { REDACT_HOOK_MARKER, resolveHooksDir } from "../git-hooks.js";
import { connect, connectAllProjects } from "./connect.js";

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

  it("commandeers in a KB with auto-memory on: wires 12 + sets autoMemoryDirectory", async () => {
    const { dir, root } = await withKb({ kind: "repo" });
    const r = await connect({ cwd: dir, yes: true, gitHook: false });
    expect(r.commandeer).toBe(true);
    expect(r.wired).toBe(12);
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
