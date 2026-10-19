// PreToolUse hook for the ladder eval. Usage: node ladder-hook.mjs <B|C>
// B: deny rules with rung "hook", inject context for rung "recall". C: inject every rule.
// A rule is injected at the earliest action in rule.inject, once per session (state file).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PATH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "Read"]);
const ISSUE_REF = /\(#\d+\)/;

export function relPath(filePath, cwd) {
  if (!filePath) return "";
  const abs = isAbsolute(filePath) ? filePath : join(cwd || process.cwd(), filePath);
  const rel = cwd ? relative(cwd, abs) : abs;
  return rel.split("\\").join("/");
}

export function matches(trigger, payload) {
  const tool = payload.tool_name;
  if (!trigger.tools.includes(tool)) return false;
  const input = payload.tool_input || {};
  if (trigger.path) {
    if (!PATH_TOOLS.has(tool)) return false;
    if (!new RegExp(trigger.path).test(relPath(input.file_path, payload.cwd))) return false;
  }
  if (trigger.command) {
    if (typeof input.command !== "string") return false;
    if (!new RegExp(trigger.command).test(input.command)) return false;
  }
  return true;
}

function deniedByHook(rule, payload) {
  if (rule.rung !== "hook") return false;
  if (!matches(rule.denyTrigger || rule.trigger, payload)) return false;
  if (rule.id === "R2") {
    const command = payload.tool_input.command;
    return !ISSUE_REF.test(command) && !/(^|\s)(-F|--file)(\s|=)/.test(command);
  }
  return true;
}

/** Returns { action, output, fired }. `seen` is a Set of rule ids already injected this session; it is updated. */
export function decide(arm, payload, rules, seen = new Set()) {
  if (arm === "B" || arm === "D") {
    const denied = rules.filter((r) => deniedByHook(r, payload));
    if (denied.length > 0) {
      const reason = denied.map((r) => `${r.id}: ${r.text}`).join("\n");
      return {
        action: "deny",
        fired: denied.map((r) => r.id),
        output: {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Blocked by project rule.\n${reason}`,
          },
        },
      };
    }
  }
  const injected = rules.filter(
    (r) =>
      (arm === "C" || r.rung === "recall") &&
      !seen.has(r.id) &&
      (r.inject || [r.trigger]).some((t) => matches(t, payload)),
  );
  for (const r of injected) seen.add(r.id);
  if (injected.length === 0) return { action: "none", fired: [], output: null };
  return {
    action: "context",
    fired: injected.map((r) => r.id),
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `Project rules that apply to this action:\n${injected.map((r) => `- ${r.id}: ${r.text}`).join("\n")}`,
      },
    },
  };
}

function loadRules() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "rules.json"), join(here, "..", "rules.json")]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return [];
}

async function main() {
  const arm = process.argv[2];
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return;
  }
  const statePath = process.env.LADDER_STATE;
  const seen = new Set();
  if (statePath && existsSync(statePath)) {
    try {
      for (const id of JSON.parse(readFileSync(statePath, "utf8"))) seen.add(id);
    } catch {
      // torn state file: start empty
    }
  }
  const result = decide(arm, payload, loadRules(), seen);
  if (statePath && result.action === "context") writeFileSync(statePath, JSON.stringify([...seen]));
  if (!result.output) return;
  if (process.env.LADDER_LOG) {
    appendFileSync(
      process.env.LADDER_LOG,
      `${JSON.stringify({ ts: Date.now(), arm, tool: payload.tool_name, action: result.action, rules: result.fired })}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
