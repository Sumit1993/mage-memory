// Prototype ladder gate: deny the first memory write under mage/ in a session, then let later ones pass.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REASON =
  "mage ladder: before saving this as a memory, put each lesson on the highest rung that can carry it. " +
  "1 impossible: a deny rule in .claude/settings.json permissions. " +
  "2 check: a lint/test/pre-commit script. " +
  "3 hook: a .claude/settings.json hook that blocks the action with a reason. " +
  "4 rule: one line in AGENTS.md. " +
  "5 note: only what none of those can carry (facts, preferences, environment). " +
  "Build the higher rungs now, then save only the rung-5 lessons here.";

const GENERATED = /^(MEMORY|INDEX|_index\..+)\.md$/;

export function isMemoryPath(filePath, cwd) {
  if (!filePath) return false;
  const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const rel = relative(join(cwd, "mage"), abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  return !GENERATED.test(basename(abs));
}

/** Returns hook output for a denial, or null. Creates the marker on the first denial. */
export function decide(payload, markerDir, mode = "deny") {
  if (payload.tool_name !== "Write" && payload.tool_name !== "Edit") return null;
  const cwd = payload.cwd || process.cwd();
  if (!isMemoryPath(payload.tool_input?.file_path, cwd)) return null;
  const marker = join(markerDir, `ladder-marker-${String(payload.session_id || "session").replace(/[^\w-]/g, "_")}`);
  if (existsSync(marker)) return null;
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(marker, "denied once\n");
  if (mode === "attach") return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: REASON } };
  return {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON },
  };
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return;
  }
  const out = decide(payload, join(payload.cwd || process.cwd(), ".claude"), process.argv[2] === "attach" ? "attach" : "deny");
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
