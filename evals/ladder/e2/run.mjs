import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { git } from "../lib/arms.mjs";
import { FIXTURE_DIR } from "../lib/arms.mjs";
import { claudeEnv, DEFAULT_MODEL, makeRunDir, runClaude } from "../lib/claude.mjs";
import { gradeE2 } from "./grade.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAGE_CLI = join(HERE, "..", "..", "..", "dist", "cli.js");

const runMage = (cwd, ...args) => {
  const r = spawnSync("node", [MAGE_CLI, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`mage ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
};

/**
 * Both E2 arms get the same mage setup; only E2-mage keeps the memory hook groups. Registered the way `mage connect` does: run the real `mage init --in-repo`
 * and `mage connect` in the copy, then keep only the mage:memory:* hook groups (the unit under
 * test) and point their command at this worktree's built CLI instead of a `mage` on PATH.
 * Returns the settings object written to .claude/settings.local.json.
 */
export function registerMageSetup(dir, { withHook }) {
  runMage(dir, "init", "--in-repo", "--yes", "--no-connect");
  runMage(dir, "connect", "--yes", "--no-git-hook");
  const path = join(dir, ".claude", "settings.local.json");
  const settings = JSON.parse(readFileSync(path, "utf8"));
  const kept = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const memory = groups
      .filter((g) => g.id?.startsWith("mage:memory:"))
      .map((g) => ({
        ...g,
        hooks: g.hooks.map((h) => ({ ...h, command: h.command.replace(/^mage /, `node "${MAGE_CLI}" `) })),
      }));
    if (withHook && memory.length > 0) kept[event] = memory;
  }
  if (withHook) settings.hooks = kept;
  else delete settings.hooks;
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

export function buildE2(arm, dir) {
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), "# shopcart\n\nA tiny cart library. See README.md.\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "eval");
  git(dir, "config", "user.email", "eval@example.invalid");
  git(dir, "config", "core.autocrlf", "false");
  let registered = null;
  registered = registerMageSetup(dir, { withHook: arm === "E2-mage" });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--no-verify", "-m", "chore: initial shopcart");
  return { base: git(dir, "rev-parse", "HEAD").trim(), registered };
}

export async function runE2({ arm, rep = 1, model = DEFAULT_MODEL, runId, timeoutMs }) {
  const runDir = makeRunDir(runId, `${arm}-${rep}`);
  const repo = join(runDir, "repo");
  const configDir = join(runDir, "config");
  const { base, registered } = buildE2(arm, repo);
  if (registered) writeFileSync(join(runDir, "registered-settings.json"), `${JSON.stringify(registered, null, 2)}\n`);
  const run = await runClaude({
    prompt: readFileSync(join(HERE, "prompt.md"), "utf8"),
    cwd: repo,
    env: claudeEnv({ model, configDir }),
    transcriptPath: join(runDir, "transcript.jsonl"),
    stderrPath: join(runDir, "stderr.log"),
    timeoutMs,
  });
  const result = { arm, rep, model, exit_code: run.exitCode, timed_out: run.timedOut, ...gradeE2({ dir: repo, base, configDir }) };
  writeFileSync(join(runDir, "grade.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  const runId = o.runid || `e2-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const arms = (o.arms || "E2-plain,E2-mage").split(",");
  const reps = Number(o.reps || 1);
  const results = [];
  for (const arm of arms) for (let rep = 1; rep <= reps; rep++) results.push(await runE2({ arm, rep, model: o.model || DEFAULT_MODEL, runId }));
  process.stdout.write(`${JSON.stringify(results.map((r) => ({ arm: r.arm, rep: r.rep, score: `${r.score}/${r.of}`, landed: Object.fromEntries(r.corrections.map((c) => [c.id, c.landed])) })), null, 2)}\n`);
}
