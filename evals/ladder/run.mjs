import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildArm, loadTasks } from "./lib/arms.mjs";
import { claudeEnv, DEFAULT_MODEL, makeRunDir, runClaude } from "./lib/claude.mjs";
import { grade } from "./grade.mjs";

export async function runOne({ task, arm, rep = 1, model = DEFAULT_MODEL, runId, timeoutMs }) {
  const prompt = loadTasks()[task];
  if (!prompt) throw new Error(`unknown task ${task}`);
  const name = `${task}-${arm}-${rep}`;
  const runDir = makeRunDir(runId, name);
  const repo = join(runDir, "repo");
  buildArm(arm, repo);
  const hookLog = join(runDir, "hook-fired.jsonl");
  const transcript = join(runDir, "transcript.jsonl");
  const run = await runClaude({
    prompt,
    cwd: repo,
    env: claudeEnv({ model, configDir: join(runDir, "config"), hookLog }),
    transcriptPath: transcript,
    stderrPath: join(runDir, "stderr.log"),
    timeoutMs,
  });
  const graded = grade({ dir: repo, transcript, hookLog, durationMs: run.durationMs });
  const result = { task, arm, rep, model, runId, exit_code: run.exitCode, timed_out: run.timedOut, ...graded };
  writeFileSync(join(runDir, "grade.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const result = await runOne({
    task: a.task,
    arm: a.arm,
    rep: Number(a.rep || 1),
    model: a.model || DEFAULT_MODEL,
    runId: a.runid || `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
