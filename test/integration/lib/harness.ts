// Shared harness for the integration / real-test suite.
//
// Two tiers, gated so the default `npm test` never touches either:
//   - DETERMINISTIC: drive the built `dist/cli.js` against a real temp KB (git +
//     `mage init`). No external tools, no billing. Always runs under
//     `npm run test:integration`.
//   - LIVE: drive an EXTERNAL tool (`claude -p`) end-to-end. Billed. Runs only when
//     MAGE_LIVE is set AND the `claude` binary is present (else each live test skips
//     itself, so the file is safe to keep in the default integration run).
//
// Env knobs:
//   MAGE_LIVE=1            opt into the billed live tests.
//   MAGE_CLAUDE_BIN=path   the Claude Code CLI to drive (default: `claude`).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type TestContext, onTestFinished } from "vitest";

const execFileP = promisify(execFile);

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** Repo root (…/test/integration/lib → …). */
export const REPO_ROOT = resolve(HERE, "../../..");
/** The built CLI the integration tests exercise. `npm run test:integration` builds it first. */
export const MAGE_BIN = join(REPO_ROOT, "dist", "cli.js");

/** Throw a clear, actionable error if the CLI hasn't been built. */
export function assertBuilt(): void {
  if (!existsSync(MAGE_BIN)) {
    throw new Error(
      `mage CLI not built at ${MAGE_BIN}. Run \`npm run build\` first ` +
        "(the `test:integration` npm script does this for you).",
    );
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run the built `mage <args>` in `cwd`. Never throws on a non-zero exit — returns the code. */
export async function runMage(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd: REPO_ROOT },
): Promise<RunResult> {
  assertBuilt();
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [MAGE_BIN, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}

/** A temp dir removed when the current test finishes (no afterEach bookkeeping needed). */
export async function tmpKbDir(prefix = "mage-it-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

/** A built in-repo KB (git repo + `mage init --in-repo`). Returns the code repo dir + docs root. */
export async function initKb(): Promise<{ dir: string; root: string }> {
  const dir = await tmpKbDir();
  await execFileP("git", ["init", "-q"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "it@example.com"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "mage-it"], { cwd: dir });
  const r = await runMage(["init", "--in-repo", "--yes", "--no-connect"], { cwd: dir });
  if (r.code !== 0) throw new Error(`mage init failed: ${r.stderr || r.stdout}`);
  return { dir, root: join(dir, "mage") };
}

/**
 * Hand-wire the commandeer tier into `<dir>/.claude/settings.local.json`, pointing the
 * Gate-0 hooks at the BUILT CLI (`node dist/cli.js memory-hook`) rather than a global
 * `mage` on PATH — so the live test is self-contained. Mirrors what `mage connect`
 * writes (a global install would wire `mage memory-hook`). Returns the settings path.
 */
export async function wireCommandeer(dir: string, root: string): Promise<string> {
  const claudeDir = join(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  const cmd = `${process.execPath} ${MAGE_BIN} memory-hook`;
  const settings = {
    autoMemoryEnabled: true,
    autoMemoryDirectory: root,
    hooks: {
      PreToolUse: [
        { id: "mage:memory:PreToolUse", matcher: "Write|Edit", hooks: [{ type: "command", command: cmd }] },
      ],
      PostToolUse: [
        { id: "mage:memory:PostToolUse", matcher: "Write|Edit", hooks: [{ type: "command", command: cmd }] },
      ],
    },
  };
  const path = join(claudeDir, "settings.local.json");
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

// ─── live (external-tool) gating ────────────────────────────────────────────────

/** The Claude Code CLI the live tests drive. */
export const CLAUDE_BIN = process.env.MAGE_CLAUDE_BIN ?? "claude";

/** True iff the user opted into the billed live tests. */
export function liveEnabled(): boolean {
  return Boolean(process.env.MAGE_LIVE);
}

/** True iff the `claude` CLI is invocable on this machine. */
export async function claudePresent(): Promise<boolean> {
  try {
    await execFileP(CLAUDE_BIN, ["--version"], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard the body of a live test: skip (never fail) unless MAGE_LIVE is set AND the
 * `claude` CLI is present. Call at the top of each `it` that drives an external tool.
 */
export async function requireLive(ctx: TestContext): Promise<boolean> {
  if (!liveEnabled()) {
    ctx.skip();
    return false;
  }
  if (!(await claudePresent())) {
    ctx.skip();
    return false;
  }
  return true;
}

/**
 * Run `claude -p <prompt>` headless in `cwd` (which must contain the
 * `.claude/settings.local.json` wiring the hooks). `--dangerously-skip-permissions`
 * so hooks + autoMemoryDirectory activate without an interactive trust prompt.
 */
export async function runClaude(
  prompt: string,
  opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileP(
      CLAUDE_BIN,
      ["-p", prompt, "--dangerously-skip-permissions"],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 180_000,
        env: { ...process.env, ...opts.env },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}
