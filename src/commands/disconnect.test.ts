import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitInit } from "../git.js";
import { resolveHooksDir } from "../git-hooks.js";
import { connect } from "./connect.js";
import { disconnect } from "./disconnect.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-disconnect-"));
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

describe("disconnect", () => {
  it("removes exactly the mage groups and leaves the rest", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const pre = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "host-thing" }] }],
      },
    };
    await writeFile(localPath(dir), `${JSON.stringify(pre, null, 2)}\n`);

    // connect wires 8 mage groups in
    await connect({ cwd: dir, yes: true });

    const r = await disconnect({ cwd: dir, yes: true });
    expect(r.scope).toBe("local");
    expect(r.removed).toBe(8);
    expect(r.backedUp).toBe(true);

    const settings = JSON.parse(await readFile(localPath(dir), "utf8")) as {
      permissions: { allow: string[] };
      hooks: Record<string, Array<{ id?: string; hooks: Array<{ command: string }> }>>;
    };
    // unknown top-level key preserved
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    // host group preserved, mage group gone
    const ids = Object.values(settings.hooks ?? {})
      .flat()
      .map((g) => g.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("mage:"));
    expect(ids).toHaveLength(0);
    expect(settings.hooks.SessionStart.find((g) => g.hooks[0]?.command === "host-thing")).toBeTruthy();
  });

  it("disconnect on a missing file is a clean no-op", async () => {
    const dir = await freshDir();
    const r = await disconnect({ cwd: dir, yes: true });

    expect(r.removed).toBe(0);
    expect(r.backedUp).toBe(false);
    expect(r.scope).toBe("local");
    // no file created, no backup
    expect(await exists(localPath(dir))).toBe(false);
    expect(await exists(`${localPath(dir)}.bak`)).toBe(false);
  });

  it("malformed JSON -> disconnect throws and does NOT write", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(localPath(dir), "{ not json");

    await expect(disconnect({ cwd: dir, yes: true })).rejects.toThrow(/malformed JSON/i);
    expect(await readFile(localPath(dir), "utf8")).toBe("{ not json");
    expect(await exists(`${localPath(dir)}.bak`)).toBe(false);
  });

  it("disconnect with no mage groups present does not rewrite the file", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const pre = { permissions: { allow: ["Bash(ls)"] } };
    await writeFile(localPath(dir), `${JSON.stringify(pre, null, 2)}\n`);

    const r = await disconnect({ cwd: dir, yes: true });
    expect(r.removed).toBe(0);
    expect(r.backedUp).toBe(false);
    // no backup written when nothing changed
    expect(await exists(`${localPath(dir)}.bak`)).toBe(false);
  });

  // ─── Gate-2 redaction pre-commit hook (ADR-0018 §7) ─────────────────────────

  it("in a git repo, disconnect removes the mage-installed pre-commit hook", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    await connect({ cwd: dir, yes: true });
    const hooksDir = await resolveHooksDir(dir);
    const hookPath = join(hooksDir as string, "pre-commit");
    expect(await exists(hookPath)).toBe(true);

    const r = await disconnect({ cwd: dir, yes: true });
    expect(r.hook).toEqual({ removed: true });
    expect(await exists(hookPath)).toBe(false);
  });

  it("disconnect leaves a foreign pre-commit hook untouched", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    const hooksDir = await resolveHooksDir(dir);
    const hookPath = join(hooksDir as string, "pre-commit");
    const foreign = "#!/bin/sh\necho host-hook\n";
    await writeFile(hookPath, foreign);

    const r = await disconnect({ cwd: dir, yes: true });
    expect(r.hook).toEqual({ removed: false });
    // foreign hook preserved verbatim
    expect(await readFile(hookPath, "utf8")).toBe(foreign);
  });

  it("gitHook:false skips hook removal entirely", async () => {
    const dir = await freshDir();
    await gitInit(dir);

    await connect({ cwd: dir, yes: true });
    const hooksDir = await resolveHooksDir(dir);
    const hookPath = join(hooksDir as string, "pre-commit");

    const r = await disconnect({ cwd: dir, yes: true, gitHook: false });
    expect(r.hook).toBeUndefined();
    // hook left in place
    expect(await exists(hookPath)).toBe(true);
  });
});
