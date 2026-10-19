import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_MODEL, RUNS_DIR } from "./lib/claude.mjs";
import { runOne } from "./run.mjs";

const pct = (n, d) => (d === 0 ? "n/a" : `${n}/${d} (${Math.round((100 * n) / d)}%)`);

export function summarize(results) {
  const arms = [...new Set(results.map((r) => r.arm))].sort();
  const rules = [...new Set(results.flatMap((r) => Object.keys(r.rules)))].sort();
  const count = (rs, rule) => ({
    pass: rs.filter((r) => r.rules[rule] === "pass").length,
    fail: rs.filter((r) => r.rules[rule] === "fail").length,
  });
  const lines = ["# Ladder eval summary", "", `Runs: ${results.length}`, ""];
  lines.push("## Adherence per arm (pass / (pass+fail), na excluded)", "", "| Arm | Adherence | Task completion | Runs |", "| --- | --- | --- | --- |");
  for (const arm of arms) {
    const rs = results.filter((r) => r.arm === arm);
    let pass = 0;
    let fail = 0;
    for (const rule of rules) {
      const c = count(rs, rule);
      pass += c.pass;
      fail += c.fail;
    }
    lines.push(`| ${arm} | ${pct(pass, pass + fail)} | ${pct(rs.filter((r) => r.task_done).length, rs.length)} | ${rs.length} |`);
  }
  lines.push("", "## Adherence per rule and arm", "", `| Rule | ${arms.join(" | ")} |`, `| --- | ${arms.map(() => "---").join(" | ")} |`);
  for (const rule of rules) {
    const cells = arms.map((arm) => {
      const c = count(results.filter((r) => r.arm === arm), rule);
      return pct(c.pass, c.pass + c.fail);
    });
    lines.push(`| ${rule} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Hooks", "", "| Arm | Runs where a hook fired | Denials | Context injections |", "| --- | --- | --- | --- |");
  for (const arm of arms) {
    const rs = results.filter((r) => r.arm === arm);
    lines.push(`| ${arm} | ${rs.filter((r) => r.hook_fired).length}/${rs.length} | ${rs.reduce((s, r) => s + (r.hook_denials || 0), 0)} | ${rs.reduce((s, r) => s + (r.hook_contexts || 0), 0)} |`);
  }
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : "n/a");
  lines.push("", "## Cost", "", "| Arm | Mean turns | Mean duration (s) |", "| --- | --- | --- |");
  for (const arm of arms) {
    const rs = results.filter((r) => r.arm === arm);
    lines.push(`| ${arm} | ${mean(rs.map((r) => r.turns))} | ${mean(rs.map((r) => (r.duration_ms || 0) / 1000))} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function expandTasks(spec) {
  const range = spec.match(/^T(\d+)\.\.T?(\d+)$/);
  if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => `T${Number(range[1]) + i}`);
  return spec.split(",");
}

export async function runBatch({ arms, tasks, reps, concurrency, model, runId }) {
  const jobs = [];
  for (const task of tasks) for (const arm of arms) for (let rep = 1; rep <= reps; rep++) jobs.push({ task, arm, rep });
  const dir = join(RUNS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      let result;
      try {
        result = await runOne({ ...job, model, runId });
      } catch (e) {
        result = { ...job, error: String(e), rules: {}, task_done: false };
      }
      results.push(result);
      appendFileSync(join(dir, "results.jsonl"), `${JSON.stringify(result)}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  writeFileSync(join(dir, "summary.md"), summarize(results.filter((r) => !r.error)));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  const runId = o.runid || `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const results = await runBatch({
    arms: (o.arms || "A,B,C").split(","),
    tasks: expandTasks(o.tasks || "T1..T4"),
    reps: Number(o.reps || 1),
    concurrency: Number(o.concurrency || 3),
    model: o.model || DEFAULT_MODEL,
    runId,
  });
  process.stdout.write(`${results.length} runs; see ${join(RUNS_DIR, runId, "summary.md")}\n`);
}
