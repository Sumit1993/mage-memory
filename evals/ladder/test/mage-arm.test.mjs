import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildArm, git } from "../lib/arms.mjs";
import { MAGE_CLI } from "../lib/mage-arm.mjs";

const tmp = () => join(mkdtempSync(join(tmpdir(), "armm-")), "repo");
const skip = !existsSync(MAGE_CLI);

test("arm M: settings hold the recall hook pointed at this build, and the memory hook", { skip }, () => {
  const dir = buildArm("M", tmp(), { load: "heavy" });
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
  const groups = Object.values(settings.hooks).flat();
  assert.deepEqual(groups.map((g) => g.id).sort(), ["mage:memory:PreToolUse", "mage:recall:PreToolUse"]);
  const recall = groups.find((g) => g.id === "mage:recall:PreToolUse");
  assert.match(recall.hooks[0].command, /^node ".*cli\.js" recall-hook$/);
  assert.ok(recall.hooks[0].command.includes(MAGE_CLI));
  assert.equal(git(dir, "status", "--porcelain").trim(), "");
});

test("arm M: the R6 note is admitted by mage index and reaches recall; R6 is nowhere else", { skip }, () => {
  const dir = buildArm("M", tmp(), { load: "heavy" });
  const index = spawnSync("node", [MAGE_CLI, "index"], { cwd: dir, encoding: "utf8" });
  assert.match(index.stdout, /Roster: 1 of 1 notes admitted; 1 recalled at the action\./);
  const call = JSON.stringify({ hook_event_name: "PreToolUse", session_id: "t", tool_name: "Write", tool_input: { file_path: join(dir, "src", "new.js") }, cwd: dir });
  const explain = spawnSync("node", [MAGE_CLI, "recall-hook", "--explain"], { cwd: dir, input: call, encoding: "utf8" });
  assert.match(explain.stdout, /match\s+notes\/jsdoc-example-on-new-exports\.md/);
  assert.match(explain.stdout, /would inject 1 note\(s\)/);
  const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  assert.ok(!claudeMd.includes("@example"));
  assert.ok(claudeMd.includes("node --test"));
  const hookRules = readFileSync(join(dir, ".claude", "hooks", "rules.json"), "utf8");
  assert.equal(JSON.parse(hookRules).find((r) => r.id === "R6").rung, "mage-note");
  assert.match(readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8"), /--changelog/);
});

test("arm M0: arm M without the recall hook; roster, note, CLAUDE.md and rules are identical", { skip }, () => {
  const m = buildArm("M", tmp(), { load: "heavy" });
  const m0 = buildArm("M0", tmp(), { load: "heavy" });
  const settings = JSON.parse(readFileSync(join(m0, ".claude", "settings.local.json"), "utf8"));
  assert.deepEqual(Object.values(settings.hooks).flat().map((g) => g.id), ["mage:memory:PreToolUse"]);
  for (const f of ["mage/MEMORY.md", "mage/INDEX.md", "mage/notes/jsdoc-example-on-new-exports.md", "CLAUDE.md", ".claude/hooks/rules.json"]) {
    assert.equal(readFileSync(join(m0, f), "utf8"), readFileSync(join(m, f), "utf8"), f);
  }
  assert.match(readFileSync(join(m0, ".git", "hooks", "pre-commit"), "utf8"), /--changelog/);
  assert.equal(git(m0, "status", "--porcelain").trim(), "");
});
