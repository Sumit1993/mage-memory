import { describe, expect, it } from "vitest";
import { firstHit, matchesTarget, parseTrigger, toolTarget } from "./trigger.js";

const ctx = { cwd: "/work/repo", repo: "/work/repo" };

function hits(match: string, toolName: string, input: Record<string, unknown>): boolean {
  const trigger = parseTrigger({ when: "w", match });
  const target = toolTarget(toolName, input, ctx);
  if (!trigger || !target) throw new Error("fixture did not parse");
  return firstHit(trigger, target) !== undefined;
}

describe("parseTrigger", () => {
  it("reads the prose form as roster-only", () => {
    expect(parseTrigger("  deciding which binary runs  ")).toEqual({
      when: "deciding which binary runs",
      matchers: [],
      invalid: [],
    });
  });

  it("reads match as a string", () => {
    const t = parseTrigger({ when: "w", match: "Bash(npx mage *)" });
    expect(t?.matchers).toEqual([{ tool: "Bash", pattern: "npx mage *", raw: "Bash(npx mage *)" }]);
    expect(t?.invalid).toEqual([]);
  });

  it("reads match as a list and aliases Write to Edit", () => {
    const t = parseTrigger({ when: "w", match: ["Bash(npx mage *)", "Write(package.json)"] });
    expect(t?.matchers.map((m) => [m.tool, m.pattern])).toEqual([
      ["Bash", "npx mage *"],
      ["Edit", "package.json"],
    ]);
  });

  it("allows a mapping without match", () => {
    expect(parseTrigger({ when: "w" })).toEqual({ when: "w", matchers: [], invalid: [] });
  });

  it("reports an invalid matcher and keeps the valid ones", () => {
    const t = parseTrigger({ when: "w", match: ["Read(x)", "Bash()", "Bash( )", "npx *", 3, "Edit(a)"] });
    expect(t?.matchers).toHaveLength(1);
    expect(t?.invalid).toEqual(["Read(x)", "Bash()", "Bash( )", "npx *", "3"]);
  });

  it("rejects a missing or empty when, and non-trigger shapes", () => {
    expect(parseTrigger({ match: ["Bash(x)"] })).toBeNull();
    expect(parseTrigger({ when: "  " })).toBeNull();
    expect(parseTrigger("   ")).toBeNull();
    expect(parseTrigger(undefined)).toBeNull();
    expect(parseTrigger(["a"])).toBeNull();
    expect(parseTrigger(4)).toBeNull();
  });
});

describe("Bash matching", () => {
  it("hits a command inside a chain, misses a mention", () => {
    expect(hits("Bash(npx mage *)", "Bash", { command: "cd x && npx mage index" })).toBe(true);
    expect(hits("Bash(npx mage *)", "Bash", { command: "echo npx mage" })).toBe(false);
  });

  it("splits on ||, ;, | and newlines", () => {
    for (const command of ["false || npx mage index", "ls; npx mage index", "ls | npx mage index", "ls\nnpx mage index"]) {
      expect(hits("Bash(npx mage *)", "Bash", { command })).toBe(true);
    }
  });

  it("matches a pattern holding a space and a slash", () => {
    expect(hits("Bash(git push *)", "Bash", { command: "git push origin feat/x" })).toBe(true);
    expect(hits("Bash(git -C a/b commit*)", "Bash", { command: "git -C a/b commit -m x" })).toBe(true);
  });

  it("covers only Bash for a Bash matcher", () => {
    expect(hits("Bash(npx mage *)", "Edit", { file_path: "npx mage index" })).toBe(false);
  });
});

describe("Edit matching", () => {
  it("matches a basename glob at any depth", () => {
    expect(hits("Edit(*.md)", "Edit", { file_path: "/work/repo/docs/a.md" })).toBe(true);
    expect(hits("Edit(package.json)", "Write", { file_path: "packages/x/package.json" })).toBe(true);
  });

  it("applies a path glob from the repo root to all four file tools", () => {
    for (const [tool, key] of [
      ["Write", "file_path"],
      ["Edit", "file_path"],
      ["MultiEdit", "file_path"],
      ["NotebookEdit", "notebook_path"],
    ] as const) {
      expect(hits("Edit(src/**)", tool, { [key]: "/work/repo/src/a/b.ts" })).toBe(true);
      expect(hits("Edit(src/**)", tool, { [key]: "/work/repo/lib/b.ts" })).toBe(false);
    }
  });

  it("normalises a backslash path", () => {
    expect(hits("Edit(src/**)", "Edit", { file_path: "src\\a\\b.ts" })).toBe(true);
    expect(hits("Edit(src/**)", "Edit", { file_path: "C:\\work\\repo\\src\\b.ts" })).toBe(false);
  });

  it("resolves a relative path against cwd", () => {
    const target = toolTarget("Edit", { file_path: "b.ts" }, { cwd: "/work/repo/src", repo: "/work/repo" });
    expect(target).toEqual({ kind: "Edit", text: "src/b.ts" });
  });

  it("falls back to the absolute path outside the repo", () => {
    expect(toolTarget("Write", { file_path: "../other/x.md" }, ctx)).toEqual({
      kind: "Edit",
      text: "/work/other/x.md",
    });
    expect(hits("Edit(/work/other/**)", "Write", { file_path: "../other/x.md" })).toBe(true);
  });

  it("returns null for a tool recall does not cover", () => {
    expect(toolTarget("Read", { file_path: "a.md" }, ctx)).toBeNull();
    expect(toolTarget("Bash", { command: "  " }, ctx)).toBeNull();
    expect(toolTarget("Edit", {}, ctx)).toBeNull();
  });

  it("does not match across tools", () => {
    const t = parseTrigger({ when: "w", match: "Edit(a.md)" });
    expect(t && matchesTarget(t.matchers[0]!, { kind: "Bash", text: "a.md" })).toBe(false);
  });
});
