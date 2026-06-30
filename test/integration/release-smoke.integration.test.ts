// DETERMINISTIC release-smoke test (no external tools, no billing): the hermetic,
// machine-independent probes from the pre-publish dogfood harness
// (~/ai-context/mage-dogfood-0.0.10.sh), run against the BUILT CLI + throwaway KBs.
// The live-KB read-only probes from that script (doctor over the user's real repos)
// are intentionally NOT ported — they depend on machine state.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, assertBuilt, initKb, runMage, runMageStdin } from "./lib/harness.js";

/** No JS stack trace / thrown-error noise leaked into CLI output. */
function clean(s: string): boolean {
  return !/\bat (Object|async|process|node:internal)|TypeError:|ReferenceError:|Cannot read prop/.test(s);
}

describe("integration: release smoke (deterministic)", () => {
  it("prints a version and exits clean", async () => {
    assertBuilt();
    const r = await runMage(["--version"], { cwd: REPO_ROOT });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  it("--help hides the plumbing verbs and shows the human verbs", async () => {
    const { stdout } = await runMage(["--help"], { cwd: REPO_ROOT });
    const verbLine = (v: string) => new RegExp(`^\\s+${v}\\b`, "m").test(stdout);
    for (const hidden of ["observe", "index", "distill", "promote"]) {
      expect(verbLine(hidden), `plumbing verb '${hidden}' should be hidden from --help`).toBe(false);
    }
    for (const human of ["init", "connect", "doctor", "skills"]) {
      expect(verbLine(human), `human verb '${human}' should be visible in --help`).toBe(true);
    }
  });

  it("ships exactly the expected auto-loaded skills", async () => {
    const skills = (await readdir(join(REPO_ROOT, "skills"))).filter((n) => !n.startsWith(".")).sort();
    expect(skills).toEqual(["graduate", "groom", "guide", "learn", "optimize"]);
  });

  it("distill --json emits valid JSON on a fresh KB", async () => {
    const { dir } = await initKb();
    const { stdout, code } = await runMage(["distill", "--json"], { cwd: dir });
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("the Gate-0 hook command fails OPEN on malformed stdin (never crashes the host)", async () => {
    const { dir } = await initKb();
    const r = await runMageStdin(["memory-hook"], "{ this is not valid json", { cwd: dir });
    expect(r.code).toBe(0); // fail-open: a broken payload must not break the agent's tool call
    expect(clean(r.stderr + r.stdout)).toBe(true);
  });

  it("doctor runs clean on a fresh KB (no crash, no stack trace)", async () => {
    const { dir } = await initKb();
    const r = await runMage(["doctor"], { cwd: dir });
    expect(clean(r.stdout + r.stderr)).toBe(true);
  });

  it("Gate-2 blocks a staged live secret (the pre-commit net)", async () => {
    const { dir, root } = await initKb();
    await mkdir(join(root, "notes"), { recursive: true });
    // The canonical AWS example key — a `secret`-severity finding that must BLOCK.
    await writeFile(
      join(root, "notes", "leak.md"),
      "---\ntype: gotcha\n---\n# Leak\naws key AKIAIOSFODNN7EXAMPLE in here\n",
    );
    await runMage(["index"], { cwd: dir });
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("git", ["add", "-A"], { cwd: dir });

    const r = await runMage(["redact", "--check", "--staged"], { cwd: dir });
    expect(r.code, "redact --check --staged must exit non-zero on a live secret").not.toBe(0);
  });
});
