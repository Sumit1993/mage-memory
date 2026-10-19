import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_MODEL, RUNS_DIR } from "../lib/claude.mjs";
import { CORRECTION_SETS } from "./grade.mjs";
import { runE2 } from "./run.mjs";

export function summarizeE2(results, prompt = results[0]?.prompt ?? "default") {
  const corrections = CORRECTION_SETS[prompt] ?? CORRECTION_SETS.default;
  const arms = [...new Set(results.map((r) => r.arm))].sort();
  const lines = [`# E2 summary (${prompt} prompt)`, "", `Runs: ${results.length}`, ""];
  lines.push("## Score (corrections landed at or above the expected rung)", "", "| Arm | Runs | Scores | Mean |", "| --- | --- | --- | --- |");
  for (const arm of arms) {
    const rs = results.filter((r) => r.arm === arm);
    const mean = (rs.reduce((s, r) => s + r.score, 0) / rs.length).toFixed(2);
    lines.push(`| ${arm} | ${rs.length} | ${rs.map((r) => `${r.score}/${r.of}`).join(", ")} | ${mean}/${rs[0].of} |`);
  }
  lines.push("", "## Rung landed per correction (counts across reps; ok = at or above expected)", "");
  lines.push(`| Correction | Expected | ${arms.join(" | ")} |`, `| --- | --- | ${arms.map(() => "---").join(" | ")} |`);
  for (const c of corrections) {
    const cells = arms.map((arm) => {
      const rs = results.filter((r) => r.arm === arm);
      const counts = {};
      let ok = 0;
      for (const r of rs) {
        const hit = r.corrections.find((x) => x.id === c.id);
        counts[hit.landed] = (counts[hit.landed] || 0) + 1;
        if (hit.ok) ok++;
      }
      const dist = Object.entries(counts).map(([k, v]) => `${k} x${v}`).join(", ");
      return `${dist} (ok ${ok}/${rs.length})`;
    });
    lines.push(`| ${c.id} ${c.name} | ${c.expected} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Where each run wrote (new or changed files vs the initial commit)", "");
  for (const r of [...results].sort((a, b) => `${a.arm}${a.rep}`.localeCompare(`${b.arm}${b.rep}`))) {
    lines.push(`- ${r.arm} rep ${r.rep}: ${r.written?.length ? r.written.join(", ") : "(nothing written)"}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runE2Batch({ arms, reps, concurrency, model, runId, prompt = "default" }) {
  const jobs = [];
  for (let rep = 1; rep <= reps; rep++) for (const arm of arms) jobs.push({ arm, rep });
  const dir = join(RUNS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      let result;
      try {
        result = await runE2({ ...job, model, runId, prompt });
      } catch (e) {
        result = { ...job, error: String(e) };
      }
      results.push(result);
      appendFileSync(join(dir, "results.jsonl"), `${JSON.stringify(result)}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  writeFileSync(join(dir, "summary.md"), summarizeE2(results.filter((r) => !r.error), prompt));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  const runId = o.runid || `e2-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const results = await runE2Batch({
    arms: (o.arms || "E2-plain,E2-mage").split(","),
    reps: Number(o.reps || 3),
    concurrency: Number(o.concurrency || 2),
    model: o.model || DEFAULT_MODEL,
    runId,
    prompt: o.prompt || "default",
  });
  process.stdout.write(`${results.length} runs; see ${join(RUNS_DIR, runId, "summary.md")}\n`);
}
