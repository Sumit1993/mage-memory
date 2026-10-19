import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LADDER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = join(LADDER_DIR, "fixture");
export const loadRules = () => JSON.parse(readFileSync(join(LADDER_DIR, "rules.json"), "utf8"));
export const loadTasks = () => JSON.parse(readFileSync(join(LADDER_DIR, "tasks.json"), "utf8"));

const HEADER = "# shopcart\n\nA tiny cart library. See README.md.\n";
const HOOK_CMD = (arm) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/ladder-hook.mjs" ${arm}`;

export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

export function claudeMdFor(arm, rules) {
  if (arm === "A") return `${HEADER}\n## Remembered\n${rules.map((r) => `- ${r.text}`).join("\n")}\n`;
  if (arm === "B") return `${HEADER}\n## Remembered\n${rules.filter((r) => r.rung === "note").map((r) => `- ${r.text}`).join("\n")}\n`;
  if (arm === "C") return HEADER;
  throw new Error(`unknown arm ${arm}`);
}

export function hookSettings(arm) {
  return {
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write|MultiEdit|Bash", hooks: [{ type: "command", command: HOOK_CMD(arm) }] },
      ],
    },
  };
}

/** Build one arm into destDir: fixture copy, arm files, git init and an initial commit. */
export function buildArm(arm, destDir, { rules = loadRules() } = {}) {
  cpSync(FIXTURE_DIR, destDir, { recursive: true });
  writeFileSync(join(destDir, "CLAUDE.md"), claudeMdFor(arm, rules));
  writeFileSync(join(destDir, ".gitignore"), ".claude/\n");

  if (arm === "B" || arm === "C") {
    const hooksDir = join(destDir, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    cpSync(join(LADDER_DIR, "hooks", "ladder-hook.mjs"), join(hooksDir, "ladder-hook.mjs"));
    cpSync(join(LADDER_DIR, "rules.json"), join(hooksDir, "rules.json"));
    writeFileSync(join(destDir, ".claude", "settings.json"), `${JSON.stringify(hookSettings(arm), null, 2)}\n`);
  }
  if (arm === "B") {
    cpSync(join(LADDER_DIR, "arms", "check.js"), join(destDir, "scripts", "check.js"));
  }

  git(destDir, "init", "-q", "-b", "main");
  git(destDir, "config", "user.name", "eval");
  git(destDir, "config", "user.email", "eval@example.invalid");
  git(destDir, "config", "core.autocrlf", "false");
  if (arm === "B") {
    const hook = join(destDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexec node scripts/check.js\n");
    chmodSync(hook, 0o755);
  }
  git(destDir, "add", "-A");
  git(destDir, "commit", "-q", "--no-verify", "-m", "chore: initial shopcart");
  return destDir;
}
