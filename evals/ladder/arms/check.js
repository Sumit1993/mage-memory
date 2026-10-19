// Pre-commit check for R3 and R4: no console.log and no `new Error(` in staged src/ files.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.startsWith("src/") && f.endsWith(".js"));

const problems = [];
for (const file of staged) {
  const text = readFileSync(file, "utf8");
  if (/console\.log\s*\(/.test(text)) problems.push(`${file}: console.log is not allowed in src/ (R3); use logger from src/logger.js`);
  if (/new Error\s*\(/.test(text)) problems.push(`${file}: use new AppError( from src/errors.js, not new Error( (R4)`);
}
if (process.argv.includes("--changelog") && staged.length > 0) {
  const unreleased = (text) => {
    const m = text.match(/## Unreleased\s*\n([\s\S]*?)(?=\n## |\s*$)/);
    return (m ? m[1] : "").split("\n").map((l) => l.trim()).filter(Boolean);
  };
  const show = (ref) => {
    try {
      return execFileSync("git", ["show", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  const before = new Set(unreleased(show("HEAD:CHANGELOG.md")));
  if (!unreleased(show(":CHANGELOG.md")).some((l) => !before.has(l))) {
    problems.push("CHANGELOG.md: src/ changed but `## Unreleased` gained no line (R5); add one and stage CHANGELOG.md");
  }
}
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
