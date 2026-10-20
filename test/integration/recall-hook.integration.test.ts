// DETERMINISTIC integration test: the PreToolUse recall hook and the memory-hook ladder deny
// over the BUILT CLI and a real KB (#282). No external tools, no billing.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MAGE_BIN, assertBuilt, initKb } from "./lib/harness.js";

function hook(command: string, input: string, cwd: string, args: string[] = []) {
  const r = spawnSync(process.execPath, [MAGE_BIN, command, ...args], { input, cwd, encoding: "utf8" });
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

  const rungless = (root: string, dir: string): string =>
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_name: "Write",
      tool_input: {
        file_path: join(root, "feedback_commit_style.md"),
        content: ["---", "name: commit-style", "description: No em dashes.", "metadata:", "  type: feedback", "---", "No em dashes."].join("\n"),
      },
      cwd: dir,
    });

  it("gate=deny-once (the default): two rung-less root writes in one session give one deny that keeps a copy, then a non-deny", async () => {
    const { dir, root } = await initKb();
    const write = rungless(root, dir);

    const first = JSON.parse(hook("memory-hook", write, dir).stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(first.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(first.hookSpecificOutput.permissionDecisionReason).toContain("Not saved yet");
    const held = join(root, "notes", ".held", "s1-feedback_commit_style.md");
    expect(first.hookSpecificOutput.permissionDecisionReason).toContain(held);
    expect(await readFile(held, "utf8")).toContain("No em dashes.");

    const stop = JSON.parse(
      hook("nudge", JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: dir }), dir).stdout,
    ) as { systemMessage: string };
    expect(stop.systemMessage).toContain("1 lesson(s) held, not filed");

    const second = hook("memory-hook", write, dir);
    expect(second.code).toBe(0);
    const decision = second.stdout
      ? (JSON.parse(second.stdout) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput
          .permissionDecision
      : "pass";
    expect(decision).not.toBe("deny");
  });

  it("gate=ask (opt-in): the first rung-less write is allowed with the ladder as context, once, and nothing is held", async () => {
    const { dir, root } = await initKb();
    const metaPath = join(root, "metadata.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
    await writeFile(metaPath, JSON.stringify({ ...meta, ladder: { gate: "ask" } }, null, 2));
    const write = rungless(root, dir);

    const first = JSON.parse(hook("memory-hook", write, dir).stdout) as {
      hookSpecificOutput: { permissionDecision?: string; additionalContext?: string };
    };
    expect(first.hookSpecificOutput.permissionDecision).not.toBe("deny");
    expect(first.hookSpecificOutput.additionalContext).toContain("Saved. Before more memory writes this session");

    const second = hook("memory-hook", write, dir);
    const again = second.stdout
      ? (JSON.parse(second.stdout) as { hookSpecificOutput: { additionalContext?: string } }).hookSpecificOutput
      : {};
    expect(again.additionalContext).toBeUndefined();
    expect(await readdir(join(root, "notes")).then((n) => n.includes(".held"))).toBe(false);
  });
});

describe("integration: Stop hook indexes a note saved mid-session (deterministic)", () => {
  beforeAll(() => assertBuilt());

  it("a note written then `index --hook` is listed in MEMORY.md; a second run changes nothing", async () => {
    const { dir, root } = await initKb();
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "saved.md"), "---\ntype: note\n---\n# Saved mid session\n");

    const first = hook("index", "", dir, ["--hook"]);
    expect(first).toEqual({ stdout: "", code: 0 });
    expect(await readFile(join(root, "MEMORY.md"), "utf8")).toContain("[Saved mid session](notes/saved.md)");
    expect(await readFile(join(root, "INDEX.md"), "utf8")).toContain("Saved mid session");

    const before = (await stat(join(root, "INDEX.md"))).mtimeMs;
    expect(hook("index", "", dir, ["--hook"])).toEqual({ stdout: "", code: 0 });
    expect((await stat(join(root, "INDEX.md"))).mtimeMs).toBe(before);
  });

  it("exits 0 and prints nothing outside a knowledge base", async () => {
    const bare = await mkdtemp(join(tmpdir(), "mage-it-bare-"));
    expect(hook("index", "", bare, ["--hook"])).toEqual({ stdout: "", code: 0 });
  });
});
