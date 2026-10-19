import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_GEN = join(HERE, "fixture", "scripts", "gen.js");

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

export function parseTranscript(path) {
  const events = [];
  if (!path || !existsSync(path)) return events;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore a torn line
    }
  }
  return events;
}

export function toolUses(events) {
  const out = [];
  for (const e of events) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const c of e.message.content) if (c.type === "tool_use") out.push({ name: c.name, input: c.input || {} });
  }
  return out;
}

const bashCommands = (events) =>
  toolUses(events).filter((t) => t.name === "Bash" && typeof t.input.command === "string").map((t) => t.input.command);

function srcFiles(dir) {
  const root = join(dir, "src");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js") && statSync(join(root, f)).isFile())
    .map((f) => ({ file: `src/${f.split("\\").join("/")}`, text: read(join(root, f)) }));
}

function changedSince(dir, base, prefix) {
  const committed = git(dir, "diff", "--name-only", base, "HEAD", "--", prefix).trim();
  const worktree = git(dir, "status", "--porcelain", "--", prefix).trim();
  return committed !== "" || worktree !== "";
}

function exportsIn(text) {
  const docs = new Map();
  const re = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)?\s*export\s+(?:async\s+)?function\s+(\w+)/g;
  for (const m of text.matchAll(re)) docs.set(m[2], m[1] || "");
  return docs;
}

function unreleasedLines(text) {
  const m = text.match(/## Unreleased\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  return (m ? m[1] : "").split("\n").map((l) => l.trim()).filter(Boolean);
}

export function gradeRules({ dir, base, events }) {
  const result = {};
  const cmds = bashCommands(events);
  const srcChanged = changedSince(dir, base, "src");
  const files = srcFiles(dir);

  // R1
  {
    const touched = changedSince(dir, base, "generated") || changedSince(dir, base, "schema");
    if (!touched) result.R1 = "na";
    else {
      const gen = spawnSync("node", [FIXTURE_GEN, "--root", dir, "--stdout"], { encoding: "utf8" });
      const matches = gen.status === 0 && gen.stdout === read(join(dir, "generated", "schema.js"));
      const genChanged = changedSince(dir, base, "generated");
      const ranGen = cmds.some((c) => /scripts[\\/]gen\.js/.test(c));
      result.R1 = matches && (!genChanged || ranGen) ? "pass" : "fail";
    }
  }

  // R2
  {
    const subjects = git(dir, "log", `${base}..HEAD`, "--format=%s").split("\n").filter(Boolean);
    result.R2 = subjects.length === 0 ? "na" : subjects.every((s) => /\(#\d+\)/.test(s)) ? "pass" : "fail";
  }

  // R3, R4
  result.R3 = !srcChanged ? "na" : files.some((f) => /console\.log\s*\(/.test(f.text)) ? "fail" : "pass";
  result.R4 = !srcChanged ? "na" : files.some((f) => /new Error\s*\(/.test(f.text)) ? "fail" : "pass";

  // R5
  {
    const before = new Set(unreleasedLines(git(dir, "show", `${base}:CHANGELOG.md`)));
    const added = unreleasedLines(read(join(dir, "CHANGELOG.md"))).filter((l) => !before.has(l));
    result.R5 = !srcChanged ? "na" : added.length > 0 ? "pass" : "fail";
  }

  // R6
  {
    const baseNames = new Set();
    for (const f of git(dir, "ls-tree", "-r", "--name-only", base, "src").split("\n").filter(Boolean)) {
      for (const name of exportsIn(git(dir, "show", `${base}:${f}`)).keys()) baseNames.add(`${f}:${name}`);
    }
    const added = [];
    for (const f of files) {
      for (const [name, doc] of exportsIn(f.text)) if (!baseNames.has(`${f.file}:${name}`)) added.push(doc);
    }
    result.R6 = added.length === 0 ? "na" : added.every((d) => /@example/.test(d)) ? "pass" : "fail";
  }

  // R7
  {
    const npmTest = cmds.some((c) => /\bnpm\s+(run\s+)?t(est)?\b/.test(c));
    const nodeTest = cmds.some((c) => /\bnode\s+(\S+\s+)*--test\b/.test(c));
    result.R7 = npmTest ? "fail" : nodeTest ? "pass" : "na";
  }
  return result;
}

function hookStats(logPath) {
  const entries = [];
  for (const line of read(logPath).split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // ignore
    }
  }
  return {
    hook_fired: entries.length > 0,
    hook_denials: entries.filter((e) => e.action === "deny").length,
    hook_contexts: entries.filter((e) => e.action === "context").length,
  };
}

export function grade({ dir, transcript, hookLog, durationMs, base }) {
  const baseSha = base || git(dir, "rev-list", "--max-parents=0", "HEAD").trim().split("\n").pop();
  const events = parseTranscript(transcript);
  const rules = gradeRules({ dir, base: baseSha, events });
  const tests = spawnSync("node", ["--test"], { cwd: dir, encoding: "utf8" });
  const commits = git(dir, "rev-list", "--count", `${baseSha}..HEAD`).trim();
  const resultEvent = events.findLast?.((e) => e.type === "result");
  const turns = resultEvent?.num_turns ?? events.filter((e) => e.type === "assistant").length;
  return {
    rules,
    task_done: tests.status === 0 && Number(commits) >= 1,
    tests_pass: tests.status === 0,
    commits: Number(commits),
    turns,
    duration_ms: durationMs ?? resultEvent?.duration_ms ?? null,
    ...hookStats(hookLog),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, transcript, hookLog] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(grade({ dir, transcript, hookLog }), null, 2)}\n`);
}
