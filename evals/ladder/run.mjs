import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildArm, loadTasks } from "./lib/arms.mjs";
import { claudeEnv, DEFAULT_MODEL, makeRunDir, runClaude } from "./lib/claude.mjs";
import { grade } from "./grade.mjs";

/** Arm M: the notes mage's recall hook injected, read from the KB's per-session state under mage/.mage/recall/. */
export function recallStats(repo, runDir) {
  const dir = join(repo, "mage", ".mage", "recall");
  if (!existsSync(dir)) return {};
  cpSync(dir, join(runDir, "recall-state"), { recursive: true });
  const injected = readdirSync(dir).flatMap((f) => {
    try {
      return JSON.parse(readFileSync(join(dir, f), "utf8")).injected ?? [];
    } catch {
      return [];
    }
  });
  return { recall_injected: injected };
}

export async function runOne({ task, arm, rep = 1, load = "light", model = DEFAULT_MODEL, runId, timeoutMs }) {
  const prompt = loadTasks()[task];
  if (!prompt) throw new Error(`unknown task ${task}`);
  const name = `${task}-${arm}-${rep}`;
  const runDir = makeRunDir(runId, name);
  const repo = join(runDir, "repo");
  buildArm(arm, repo, { load });
  const hookLog = join(runDir, "hook-fired.jsonl");
  const transcript = join(runDir, "transcript.jsonl");
  const run = await runClaude({
    prompt,
    cwd: repo,
    env: claudeEnv({ model, configDir: join(runDir, "config"), hookLog, hookState: join(runDir, "hook-state.json") }),
    transcriptPath: transcript,
    stderrPath: join(runDir, "stderr.log"),
    timeoutMs,
  });
  const graded = grade({ dir: repo, transcript, hookLog, durationMs: run.durationMs });
  const result = { task, arm, rep, load, model, runId, exit_code: run.exitCode, timed_out: run.timedOut, ...graded, ...recallStats(repo, runDir) };
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
    load: a.load || "light",
    model: a.model || DEFAULT_MODEL,
    runId: a.runid || `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
