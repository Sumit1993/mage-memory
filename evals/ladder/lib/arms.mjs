import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerMageArm } from "./mage-arm.mjs";

export const LADDER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = join(LADDER_DIR, "fixture");
export const loadRules = () => JSON.parse(readFileSync(join(LADDER_DIR, "rules.json"), "utf8"));
export const loadTasks = () => JSON.parse(readFileSync(join(LADDER_DIR, "tasks.json"), "utf8"));

const HEADER = "# shopcart\n\nA tiny cart library. See README.md.\n";
const HOOK_CMD = (arm) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/ladder-hook.mjs" ${arm}`;

export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

export const loadNoise = () =>
  readFileSync(join(LADDER_DIR, "fixture-noise", "rules-heavy.md"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- "));

/** Heavy load: the same distractors in every arm; this arm's target rules slot in between them, never first or last. */
function heavyClaudeMd(arm, rules) {
  const noise = loadNoise();
  const targets = rules.filter((r) => arm === "A" || (arm === "B" && r.rung === "note"));
  const slots = rules.map((_, i) => Math.round(((i + 1) * noise.length) / (rules.length + 1)));
  const lines = [];
  noise.forEach((line, i) => {
    lines.push(line);
    rules.forEach((r, j) => {
      if (slots[j] === i + 1 && targets.includes(r)) lines.push(`- ${r.text}`);
    });
  });
  return [HEADER, "## Project rules", ...lines, ""].join("\n");
}

/** Arm D is arm B with R5 moved from recall to the pre-commit check. */
/** Arm M is arm D with R6 delivered as a mage note through `mage recall-hook`, so the prototype hook and CLAUDE.md never carry it. */
/** Arm M0 is arm M without the recall hook: same roster, same note, same fixture (the OBJ-002 control, #282). */
const isMageArm = (arm) => arm === "M" || arm === "M0";
export const rulesFor = (arm, rules) =>
  arm === "D" || isMageArm(arm)
    ? rules.map((r) => (r.id === "R5" ? { ...r, rung: "check" } : r.id === "R6" && isMageArm(arm) ? { ...r, rung: "mage-note" } : r))
    : rules;
const baseArm = (arm) => (arm === "D" || isMageArm(arm) ? "B" : arm);

export function claudeMdFor(armName, allRules, load = "light") {
  const arm = baseArm(armName);
  const rules = rulesFor(armName, allRules);
  if (!["A", "B", "C"].includes(arm)) throw new Error(`unknown arm ${arm}`);
  if (load === "heavy") return heavyClaudeMd(arm, rules);
  if (load !== "light") throw new Error(`unknown load ${load}`);
  if (arm === "A") return `${HEADER}\n## Remembered\n${rules.map((r) => `- ${r.text}`).join("\n")}\n`;
  if (arm === "B") return `${HEADER}\n## Remembered\n${rules.filter((r) => r.rung === "note").map((r) => `- ${r.text}`).join("\n")}\n`;
  if (arm === "C") return HEADER;
  throw new Error(`unknown arm ${arm}`);
}

export function hookSettings(arm) {
  return {
    hooks: {
      PreToolUse: [
        { matcher: "Read|Edit|Write|MultiEdit|Bash", hooks: [{ type: "command", command: HOOK_CMD(arm) }] },
      ],
    },
  };
}

/** Build one arm into destDir: fixture copy, arm files, git init and an initial commit. */
export function buildArm(armName, destDir, { rules: allRules = loadRules(), load = "light" } = {}) {
  const arm = baseArm(armName);
  const rules = rulesFor(armName, allRules);
  cpSync(FIXTURE_DIR, destDir, { recursive: true });
  writeFileSync(join(destDir, "CLAUDE.md"), claudeMdFor(armName, allRules, load));
  writeFileSync(join(destDir, ".gitignore"), ".claude/\n");

  if (arm === "B" || arm === "C") {
    const hooksDir = join(destDir, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    cpSync(join(LADDER_DIR, "hooks", "ladder-hook.mjs"), join(hooksDir, "ladder-hook.mjs"));
    writeFileSync(join(hooksDir, "rules.json"), JSON.stringify(rules, null, 2));
    writeFileSync(join(destDir, ".claude", "settings.json"), `${JSON.stringify(hookSettings(isMageArm(armName) ? "M" : armName), null, 2)}\n`);
  }
  if (arm === "B") {
    cpSync(join(LADDER_DIR, "arms", "check.js"), join(destDir, "scripts", "check.js"));
  }

  git(destDir, "init", "-q", "-b", "main");
  git(destDir, "config", "user.name", "eval");
  git(destDir, "config", "user.email", "eval@example.invalid");
  git(destDir, "config", "core.autocrlf", "false");
  if (isMageArm(armName)) registerMageArm(destDir, { recall: armName === "M" });
  if (arm === "B") {
    const hook = join(destDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, `#!/bin/sh\nexec node scripts/check.js${armName === "D" || isMageArm(armName) ? " --changelog" : ""}\n`);
    chmodSync(hook, 0o755);
  }
  git(destDir, "add", "-A");
  git(destDir, "commit", "-q", "--no-verify", "-m", "chore: initial shopcart");
  return destDir;
}
