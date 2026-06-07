import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connect } from "./connect.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-connect-"));
  made.push(dir);
  return dir;
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
  it("connect into a fresh dir creates settings.local.json with all 7 mage groups", async () => {
    const dir = await freshDir();
    const r = await connect({ cwd: dir, yes: true });

    expect(r.scope).toBe("local");
    expect(r.path).toBe(localPath(dir));
    expect(r.wired).toBe(7);

    const settings = JSON.parse(await readFile(r.path, "utf8")) as {
      hooks: Record<string, Array<{ id?: string }>>;
    };
    const ids = Object.values(settings.hooks)
      .flat()
      .map((g) => g.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("mage:"));
    expect(ids).toHaveLength(7);
    expect(new Set(ids)).toEqual(
      new Set([
        "mage:observe:SessionStart",
        "mage:observe:UserPromptSubmit",
        "mage:observe:PostToolUse",
        "mage:observe:PostToolUseFailure",
        "mage:observe:PreCompact",
        "mage:observe:SessionEnd",
        "mage:metrics:Stop",
      ]),
    );
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
    expect(r.wired).toBe(7);
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
    const hostGroup = settings.hooks.SessionStart.find((g) => g.hooks[0]?.command === "host-thing");
    expect(hostGroup).toBeTruthy();
    const mageGroup = settings.hooks.SessionStart.find((g) => g.id === "mage:observe:SessionStart");
    expect(mageGroup).toBeTruthy();
  });

  it("re-connect is idempotent", async () => {
    const dir = await freshDir();
    await connect({ cwd: dir, yes: true });
    const after1 = await readFile(localPath(dir), "utf8");

    const r2 = await connect({ cwd: dir, yes: true });
    const after2 = await readFile(localPath(dir), "utf8");

    expect(r2.wired).toBe(7);
    expect(after2).toBe(after1);

    // still exactly 7 mage groups (no duplication)
    const settings = JSON.parse(after2) as { hooks: Record<string, Array<{ id?: string }>> };
    const ids = Object.values(settings.hooks)
      .flat()
      .map((g) => g.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("mage:"));
    expect(ids).toHaveLength(7);
  });

  it("--user targets the user path", async () => {
    const dir = await freshDir();
    // resolveSettingsTarget for user maps to homedir()/.claude/settings.json; assert scope + path tail.
    const home = await mkdtemp(join(tmpdir(), "mage-home-"));
    made.push(home);
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const r = await connect({ user: true, yes: true });
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
});
