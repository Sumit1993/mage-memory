import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArm, git, loadNoise, loadRules } from "../lib/arms.mjs";
import { decide } from "../hooks/ladder-hook.mjs";
import { grade } from "../grade.mjs";
import { expandTasks, summarize } from "../batch.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ladder-test-"));
const rules = loadRules();

const bashEvent = (command) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
});
const writeTranscript = (dir, events) => {
  const p = join(dir, "..", `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n"));
  return p;
};
const write = (dir, rel, text) => writeFileSync(join(dir, rel), text);
const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");
const commit = (dir, msg) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--no-verify", "-m", msg);
};

function goodState() {
  const dir = join(tmp(), "repo");
  buildArm("A", dir);
  const schema = JSON.parse(read(dir, "schema/source.json"));
  schema.Item.currency = "string";
  write(dir, "schema/source.json", JSON.stringify(schema, null, 2));
  execFileSync("node", ["scripts/gen.js"], { cwd: dir });
  write(
    dir,
    "src/cart.js",
    `${read(dir, "src/cart.js")}
/**
 * Count the items.
 * @example
 * count(createCart()); // 0
 */
export function count(cart) {
  return cart.items.length;
}
`,
  );
  write(dir, "CHANGELOG.md", read(dir, "CHANGELOG.md").replace("## Unreleased\n", "## Unreleased\n- Add count().\n"));
  commit(dir, "feat: add count (#12)");
  const transcript = writeTranscript(dir, [bashEvent("node scripts/gen.js"), bashEvent("node --test")]);
  return { dir, transcript };
}

function badState() {
  const dir = join(tmp(), "repo");
  buildArm("A", dir);
  write(dir, "generated/schema.js", `${read(dir, "generated/schema.js")}export const HAND = 1;\n`);
  write(
    dir,
    "src/cart.js",
    `${read(dir, "src/cart.js")}
export function count(cart) {
  console.log("counting");
  if (!cart) throw new Error("no cart");
  return cart.items.length;
}
`,
  );
  commit(dir, "add count");
  const transcript = writeTranscript(dir, [bashEvent("npm test")]);
  return { dir, transcript };
}

test("grade: passing golden state passes every rule", () => {
  const { dir, transcript } = goodState();
  const g = grade({ dir, transcript });
  assert.deepEqual(g.rules, { R1: "pass", R2: "pass", R3: "pass", R4: "pass", R5: "pass", R6: "pass", R7: "pass" });
  assert.equal(g.task_done, true);
  assert.equal(g.commits, 1);
});

test("grade: violating golden state fails every rule", () => {
  const { dir, transcript } = badState();
  const g = grade({ dir, transcript });
  assert.deepEqual(g.rules, { R1: "fail", R2: "fail", R3: "fail", R4: "fail", R5: "fail", R6: "fail", R7: "fail" });
  assert.equal(g.task_done, true);
});

test("grade: untouched repo is na where nothing applies and task is not done", () => {
  const dir = join(tmp(), "repo");
  buildArm("A", dir);
  const g = grade({ dir, transcript: null });
  assert.equal(g.rules.R1, "na");
  assert.equal(g.rules.R2, "na");
  assert.equal(g.rules.R3, "na");
  assert.equal(g.rules.R6, "na");
  assert.equal(g.rules.R7, "na");
  assert.equal(g.task_done, false);
});

test("grade: hand-editing generated to match gen output still fails R1 without running gen", () => {
  const dir = join(tmp(), "repo");
  buildArm("A", dir);
  const schema = JSON.parse(read(dir, "schema/source.json"));
  schema.Item.currency = "string";
  write(dir, "schema/source.json", JSON.stringify(schema, null, 2));
  const out = execFileSync("node", [join(dir, "scripts", "gen.js"), "--stdout"], { cwd: dir, encoding: "utf8" });
  write(dir, "generated/schema.js", out);
  commit(dir, "feat: y (#1)");
  assert.equal(grade({ dir, transcript: null }).rules.R1, "fail");
});

test("grade: hook log is summarised", () => {
  const dir = join(tmp(), "repo");
  buildArm("A", dir);
  const log = join(tmp(), "hook.jsonl");
  appendFileSync(log, `${JSON.stringify({ action: "deny" })}\n${JSON.stringify({ action: "context" })}\n`);
  const g = grade({ dir, transcript: null, hookLog: log });
  assert.equal(g.hook_fired, true);
  assert.equal(g.hook_denials, 1);
  assert.equal(g.hook_contexts, 1);
});

test("arms: A, B and C differ as specified", () => {
  const dirs = Object.fromEntries(["A", "B", "C"].map((a) => [a, buildArm(a, join(tmp(), "repo"))]));
  const claude = Object.fromEntries(Object.entries(dirs).map(([a, d]) => [a, read(d, "CLAUDE.md")]));
  for (const r of rules) assert.ok(claude.A.includes(r.text), `A has ${r.id}`);
  assert.ok(claude.B.includes(rules.find((r) => r.id === "R7").text));
  assert.ok(!claude.B.includes(rules.find((r) => r.id === "R1").text));
  assert.ok(!claude.C.includes("Remembered"));
  assert.ok(!existsSync(join(dirs.A, ".claude", "settings.json")));
  assert.ok(existsSync(join(dirs.B, ".claude", "settings.json")));
  assert.ok(existsSync(join(dirs.B, ".git", "hooks", "pre-commit")));
  assert.ok(existsSync(join(dirs.B, "scripts", "check.js")));
  assert.ok(!existsSync(join(dirs.C, ".git", "hooks", "pre-commit")));
  assert.match(read(dirs.B, ".claude/settings.json"), /ladder-hook\.mjs\\" B/);
  assert.match(read(dirs.C, ".claude/settings.json"), /ladder-hook\.mjs\\" C/);
  assert.equal(git(dirs.A, "log", "--format=%s").trim(), "chore: initial shopcart");
});

test("arm B: pre-commit check blocks console.log and new Error, allows clean code", () => {
  const dir = buildArm("B", join(tmp(), "repo"));
  write(dir, "src/x.js", 'export const x = () => console.log("hi");\n');
  git(dir, "add", "-A");
  let res = spawnSync("git", ["commit", "-q", "-m", "x (#1)"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /R3/);
  write(dir, "src/x.js", 'export const x = () => { throw new Error("no"); };\n');
  git(dir, "add", "-A");
  res = spawnSync("git", ["commit", "-q", "-m", "x (#1)"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /R4/);
  write(dir, "src/x.js", "export const x = () => 1;\n");
  git(dir, "add", "-A");
  res = spawnSync("git", ["commit", "-q", "-m", "x (#1)"], { cwd: dir, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
});

const cwd = "/work/repo";
const edit = (file_path, tool_name = "Edit") => ({ tool_name, cwd, tool_input: { file_path } });
const bash = (command) => ({ tool_name: "Bash", cwd, tool_input: { command } });

test("arm B hooks: deny generated edits, deny commits without (#N), pass the rest", () => {
  const d = (p) => decide("B", p, rules);
  assert.equal(d(edit("/work/repo/generated/schema.js")).action, "deny");
  assert.equal(d(edit("generated/schema.js", "Write")).output.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(d(edit("/work/repo/schema/source.json")).action, "none");
  assert.equal(d(bash('git commit -m "feat: x"')).action, "deny");
  assert.equal(d(bash('git add -A && git commit -m "feat: x"')).action, "deny");
  assert.equal(d(bash('git commit -m "feat: x (#12)"')).action, "none");
  assert.equal(d(bash("git status")).action, "none");
  assert.equal(d(bash("node --test")).action, "none");
});

test("arm B hooks: recall R5/R6 on src edits only, as context not deny", () => {
  const r = decide("B", edit("/work/repo/src/cart.js"), rules);
  assert.equal(r.action, "context");
  assert.deepEqual(r.fired, ["R5", "R6"]);
  assert.match(r.output.hookSpecificOutput.additionalContext, /Unreleased/);
  assert.equal(r.output.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(decide("B", edit("/work/repo/test/cart.test.js"), rules).action, "none");
  assert.equal(decide("B", edit("/work/repo/src/cart.js"), rules, new Set(["R5", "R6"])).action, "none");
});

test("arm C injector: context only for matching inputs, never a deny", () => {
  const ctx = (p) => decide("C", p, rules);
  assert.deepEqual(ctx(edit("/work/repo/generated/schema.js")).fired, ["R1", "R2", "R7"]);
  assert.deepEqual(ctx(edit("/work/repo/schema/source.json", "Write")).fired, ["R1", "R2", "R7"]);
  assert.deepEqual(ctx(edit("/work/repo/src/cart.js")).fired, ["R2", "R3", "R4", "R5", "R6", "R7"]);
  assert.deepEqual(ctx({ tool_name: "Read", cwd, tool_input: { file_path: "/work/repo/schema/source.json" } }).fired, ["R1"]);
  assert.deepEqual(ctx(bash('git commit -m "x"')).fired, ["R2"]);
  assert.deepEqual(ctx(bash("git add -A")).fired, ["R2"]);
  assert.equal(ctx(bash("node --test")).action, "none");
  assert.equal(ctx(bash("npm test")).action, "none");
  assert.equal(ctx(bash("ls")).action, "none");
  assert.deepEqual(ctx(edit("/work/repo/README.md")).fired, ["R2", "R7"]);
  assert.equal(ctx({ tool_name: "Read", cwd, tool_input: { file_path: "/work/repo/src/cart.js" } }).action, "none");
  for (const p of [edit("/work/repo/generated/schema.js"), bash('git commit -m "x"')]) {
    assert.equal(ctx(p).output.hookSpecificOutput.permissionDecision, undefined);
  }
});

test("arm C timing: R2 and R7 fire on the first edit anywhere, before the governed command", () => {
  const seen = new Set();
  const first = decide("C", edit("/work/repo/README.md"), rules, seen);
  assert.deepEqual(first.fired, ["R2", "R7"]);
  assert.match(first.output.hookSpecificOutput.additionalContext, /\(#N\)/);
  assert.match(first.output.hookSpecificOutput.additionalContext, /node --test/);
  assert.equal(decide("C", bash("git add -A"), rules, seen).action, "none");
  assert.equal(decide("C", bash('git commit -m "x"'), rules, seen).action, "none");
  const fresh = new Set();
  assert.deepEqual(decide("C", bash("git add -A"), rules, fresh).fired, ["R2"]);
  assert.deepEqual(decide("C", edit("/work/repo/test/cart.test.js"), rules, fresh).fired, ["R7"]);
});

test("arm C dedupe: each rule injected once per session, then only new rules", () => {
  const seen = new Set();
  assert.deepEqual(decide("C", edit("/work/repo/src/cart.js"), rules, seen).fired, ["R2", "R3", "R4", "R5", "R6", "R7"]);
  assert.equal(decide("C", edit("/work/repo/src/cart.js"), rules, seen).action, "none");
  assert.deepEqual(decide("C", edit("/work/repo/generated/schema.js"), rules, seen).fired, ["R1"]);
  assert.equal(decide("C", edit("/work/repo/generated/schema.js"), rules, seen).action, "none");
});

test("hook script: state file dedupes across processes", () => {
  const dir = buildArm("C", join(tmp(), "repo"));
  const state = join(tmp(), "state.json");
  const run = (payload) =>
    spawnSync("node", [join(dir, ".claude", "hooks", "ladder-hook.mjs"), "C"], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, LADDER_STATE: state },
    });
  const first = run({ tool_name: "Write", cwd: dir, tool_input: { file_path: join(dir, "README.md"), content: "x" } });
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /R2/);
  assert.equal(run({ tool_name: "Write", cwd: dir, tool_input: { file_path: join(dir, "README.md"), content: "y" } }).stdout, "");
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), ["R2", "R7"]);
});

test("heavy load: all 50 distractors in every arm, targets only in A (R7 also in B), none at the edges", () => {
  const noise = loadNoise();
  assert.equal(noise.length, 50);
  const md = Object.fromEntries(["A", "B", "C"].map((a) => [a, read(buildArm(a, join(tmp(), "repo"), { load: "heavy" }), "CLAUDE.md")]));
  for (const a of ["A", "B", "C"]) for (const n of noise) assert.ok(md[a].includes(n + "\n"), `${a} has distractor`);
  for (const r of rules) {
    assert.ok(md.A.includes(r.text), `A has ${r.id}`);
    assert.equal(md.B.includes(r.text), r.rung === "note", `B ${r.id}`);
    assert.ok(!md.C.includes(r.text), `C lacks ${r.id}`);
  }
  const bullets = md.A.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 57);
  for (const r of rules) {
    const i = bullets.indexOf(`- ${r.text}`);
    assert.ok(i > 0 && i < bullets.length - 1, `${r.id} not at an edge`);
  }
  for (const a of ["A", "B", "C"]) assert.deepEqual(md[a].split("\n").filter((l) => noise.includes(l)), noise);
  assert.deepEqual(md.C.split("\n").filter((l) => l.startsWith("- ")), noise);
});

test("hook script: stdin JSON in, hook JSON out, with a fired log", () => {
  const dir = buildArm("B", join(tmp(), "repo"));
  const log = join(tmp(), "fired.jsonl");
  const run = (payload) =>
    spawnSync("node", [join(dir, ".claude", "hooks", "ladder-hook.mjs"), "B"], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, LADDER_LOG: log },
    });
  const denied = run({ tool_name: "Write", cwd: dir, tool_input: { file_path: join(dir, "generated", "schema.js"), content: "x" } });
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run(bash("ls")).stdout, "");
  assert.equal(run({ tool_name: "Bash", cwd: dir, tool_input: { command: "ls" } }).stdout, "");
  assert.match(readFileSync(log, "utf8"), /"action":"deny"/);
});

test("batch: task range and summary counts", () => {
  assert.deepEqual(expandTasks("T1..T4"), ["T1", "T2", "T3", "T4"]);
  assert.deepEqual(expandTasks("T2,T4"), ["T2", "T4"]);
  const md = summarize([
    { arm: "A", load: "light", rules: { R1: "pass", R2: "fail" }, task_done: true, turns: 4, duration_ms: 2000 },
    { arm: "A", load: "light", rules: { R1: "na", R2: "fail" }, task_done: false, turns: 6, duration_ms: 4000 },
    { arm: "A", load: "heavy", rules: { R1: "fail", R2: "fail" }, task_done: true, turns: 6, duration_ms: 4000 },
    { arm: "B", load: "light", rules: { R1: "pass", R2: "pass" }, task_done: true, hook_fired: true, hook_denials: 1, turns: 5, duration_ms: 1000 },
  ]);
  assert.match(md, /\| light \/ A \| 1\/3 \(33%\) \| 1\/2 \(50%\) \| 2 \|/);
  assert.match(md, /\| light \/ B \| 2\/2 \(100%\) \| 1\/1 \(100%\) \| 1 \|/);
  assert.match(md, /\| R2 \| 0\/1 \(0%\) \| 0\/2 \(0%\) \| 1\/1 \(100%\) \|/);
});

test("arm D: R5 is a pre-commit check, not recall; B is unchanged", () => {
  const d = buildArm("D", join(tmp(), "repo"));
  assert.match(read(d, ".git/hooks/pre-commit"), /check\.js --changelog/);
  const dRules = JSON.parse(read(d, ".claude/hooks/rules.json"));
  assert.equal(dRules.find((r) => r.id === "R5").rung, "check");
  assert.equal(decide("D", edit("/work/repo/src/cart.js"), dRules).fired.includes("R5"), false);
  assert.deepEqual(decide("D", edit("/work/repo/src/cart.js"), dRules).fired, ["R6"]);
  assert.equal(decide("D", edit("/work/repo/generated/x.js"), dRules).action, "deny");
  const b = buildArm("B", join(tmp(), "repo"));
  assert.doesNotMatch(read(b, ".git/hooks/pre-commit"), /--changelog/);
});

test("arm D check: commit with src change fails without a changelog line, passes with one", () => {
  const dir = buildArm("D", join(tmp(), "repo"));
  const tryCommit = () => {
    git(dir, "add", "-A");
    return spawnSync("git", ["commit", "-q", "-m", "x (#1)"], { cwd: dir, encoding: "utf8" });
  };
  write(dir, "src/x.js", "export const x = () => 1;\n");
  let res = tryCommit();
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /R5/);
  write(dir, "CHANGELOG.md", read(dir, "CHANGELOG.md").replace("## Unreleased\n", "## Unreleased\n- Add x.\n"));
  res = tryCommit();
  assert.equal(res.status, 0, res.stderr);
  write(dir, "README.md", `${read(dir, "README.md")}more\n`);
  assert.equal(tryCommit().status, 0);
});
