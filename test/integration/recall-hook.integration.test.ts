// DETERMINISTIC integration test: the PreToolUse recall hook and the memory-hook ladder deny
// over the BUILT CLI and a real KB (#282). No external tools, no billing.

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MAGE_BIN, assertBuilt, initKb } from "./lib/harness.js";

function hook(command: string, input: string, cwd: string) {
  const r = spawnSync(process.execPath, [MAGE_BIN, command], { input, cwd, encoding: "utf8" });
  return { stdout: r.stdout, code: r.status };
}

const NOTE = [
  "---",
  "rung: note",
  "trigger:",
  '  when: "deciding which mage binary a verify command runs"',
  '  match: ["Bash(npx mage *)"]',
  'pointer: "[#282](https://github.com/Sumit1993/mage-memory/issues/282)"',
  "---",
  "# Which mage binary",
  "",
  "Run the repo build, not the published release.",
  "",
].join("\n");

describe("integration: recall hook (deterministic)", () => {
  beforeAll(() => assertBuilt());

  it("injects once per session, then stays silent, and ignores a miss and bad JSON", async () => {
    const { dir, root } = await initKb();
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "binary.md"), NOTE);

    const call = (command: string, session: string) =>
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: session,
        tool_name: "Bash",
        tool_input: { command },
        tool_use_id: "t1",
        cwd: dir,
      });

    const first = hook("recall-hook", call("npx mage index", "s1"), dir);
    expect(first.code).toBe(0);
    const out = JSON.parse(first.stdout) as { hookSpecificOutput: Record<string, string> };
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("## Which mage binary (notes/binary.md)");
    expect(first.stdout).not.toContain("permissionDecision");

    const repeat = hook("recall-hook", call("npx mage index", "s1"), dir);
    expect(repeat).toEqual({ stdout: "", code: 0 });

    const miss = hook("recall-hook", call("ls -la", "s2"), dir);
    expect(miss).toEqual({ stdout: "", code: 0 });

    const bad = hook("recall-hook", "{", dir);
    expect(bad).toEqual({ stdout: "", code: 0 });
  });
});

describe("integration: memory-hook asks the ladder once (deterministic)", () => {
  beforeAll(() => assertBuilt());

  it("two rung-less root writes in one session give one deny, then a non-deny", async () => {
    const { dir, root } = await initKb();
    const write = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_name: "Write",
      tool_input: {
        file_path: join(root, "feedback_commit_style.md"),
        content: "---\nname: commit-style\ndescription: No em dashes.\nmetadata:\n  type: feedback\n---\nNo em dashes.\n",
      },
      cwd: dir,
    });

    const first = JSON.parse(hook("memory-hook", write, dir).stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(first.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(first.hookSpecificOutput.permissionDecisionReason).toContain("Not saved yet");

    const second = hook("memory-hook", write, dir);
    expect(second.code).toBe(0);
    const decision = second.stdout
      ? (JSON.parse(second.stdout) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput
          .permissionDecision
      : "pass";
    expect(decision).not.toBe("deny");
  });
});
