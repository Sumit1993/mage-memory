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
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
