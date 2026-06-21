import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import { gitInit } from "./git.js";
import {
  REDACT_HOOK_BODY,
  REDACT_HOOK_MARKER,
  installRedactHook,
  removeRedactHook,
  resolveHooksDir,
} from "./git-hooks.js";

/** A plain (non-git) temp dir. */
const freshDir = (): Promise<string> => tmpDir("mage-githooks-");

/** A temp dir that is an initialized git repo. */
async function freshRepo(): Promise<string> {
  const dir = await freshDir();
  await gitInit(dir);
  return dir;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("REDACT_HOOK_BODY", () => {
  it("is a POSIX sh script carrying the marker and the staged-redact check", () => {
    expect(REDACT_HOOK_BODY.startsWith("#!/bin/sh")).toBe(true);
    expect(REDACT_HOOK_BODY).toContain(REDACT_HOOK_MARKER);
    expect(REDACT_HOOK_BODY).toContain("mage redact --check --staged");
    expect(REDACT_HOOK_BODY).toContain("--no-verify");
    expect(REDACT_HOOK_BODY).toContain("exit 1");
  });

  it("fails open (exit 0) when mage is not on PATH instead of false-blocking the commit", () => {
    // The guard must precede the redact check and skip rather than block on 127.
    expect(REDACT_HOOK_BODY).toContain("command -v mage");
    const guardIdx = REDACT_HOOK_BODY.indexOf("command -v mage");
    const checkIdx = REDACT_HOOK_BODY.indexOf("mage redact --check --staged");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(checkIdx); // guard runs first.
    expect(REDACT_HOOK_BODY).toContain("exit 0"); // skip, not block, on missing mage.
  });
});

describe("resolveHooksDir", () => {
  it("returns an absolute hooks dir for a real repo", async () => {
    const repo = await freshRepo();
    const dir = await resolveHooksDir(repo);
    expect(dir).not.toBeNull();
    expect(dir?.startsWith("/")).toBe(true);
    // git keeps hooks under .git/hooks by default
    expect(dir).toContain(join(".git", "hooks"));
  });

  it("returns null for a non-repo dir (fail-open, never throws)", async () => {
    const dir = await freshDir();
    await expect(resolveHooksDir(dir)).resolves.toBeNull();
  });
});

describe("installRedactHook", () => {
  it("not-a-repo -> {installed:false, reason:'not-a-repo'} and writes nothing", async () => {
    const dir = await freshDir();
    const r = await installRedactHook(dir);
    expect(r.installed).toBe(false);
    expect(r.reason).toBe("not-a-repo");
    expect(r.backedUp).toBe(false);
  });

  it("fresh repo -> writes an executable pre-commit hook containing the marker", async () => {
    const repo = await freshRepo();
    const r = await installRedactHook(repo);
    expect(r.installed).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.path).toContain(join(".git", "hooks", "pre-commit"));

    const body = await readFile(r.path, "utf8");
    expect(body).toBe(REDACT_HOOK_BODY);
    expect(body).toContain(REDACT_HOOK_MARKER);

    // owner-executable (0o755 & 0o100 set)
    const st = await stat(r.path);
    expect(st.mode & 0o100).toBe(0o100);
  });

  it("re-install over our own hook -> {installed:false, reason:'already'}", async () => {
    const repo = await freshRepo();
    await installRedactHook(repo);
    const r2 = await installRedactHook(repo);
    expect(r2.installed).toBe(false);
    expect(r2.reason).toBe("already");
  });

  it("foreign pre-commit hook -> 'exists-foreign' and the foreign file is left untouched", async () => {
    const repo = await freshRepo();
    const hooksDir = await resolveHooksDir(repo);
    expect(hooksDir).not.toBeNull();
    const hookPath = join(hooksDir as string, "pre-commit");
    const foreign = "#!/bin/sh\n# someone-elses-hook\necho hi\n";
    await writeFile(hookPath, foreign);

    const r = await installRedactHook(repo);
    expect(r.installed).toBe(false);
    expect(r.reason).toBe("exists-foreign");
    // foreign content preserved verbatim
    expect(await readFile(hookPath, "utf8")).toBe(foreign);
  });
});

describe("removeRedactHook", () => {
  it("removes only our own marked hook", async () => {
    const repo = await freshRepo();
    const install = await installRedactHook(repo);
    expect(install.installed).toBe(true);

    const r = await removeRedactHook(repo);
    expect(r.removed).toBe(true);
    expect(await exists(install.path)).toBe(false);
  });

  it("leaves a foreign hook untouched -> {removed:false}", async () => {
    const repo = await freshRepo();
    const hooksDir = await resolveHooksDir(repo);
    const hookPath = join(hooksDir as string, "pre-commit");
    const foreign = "#!/bin/sh\necho keep-me\n";
    await writeFile(hookPath, foreign);

    const r = await removeRedactHook(repo);
    expect(r.removed).toBe(false);
    expect(await readFile(hookPath, "utf8")).toBe(foreign);
  });

  it("absent hook -> {removed:false}", async () => {
    const repo = await freshRepo();
    const r = await removeRedactHook(repo);
    expect(r.removed).toBe(false);
  });

  it("not-a-repo -> {removed:false} (fail-open)", async () => {
    const dir = await freshDir();
    const r = await removeRedactHook(dir);
    expect(r.removed).toBe(false);
  });
});
