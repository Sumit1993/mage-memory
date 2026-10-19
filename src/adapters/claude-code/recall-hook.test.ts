import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../../test/fixtures/kb.js";
import { recallStatePath } from "../../paths.js";
import { readStdinSafe } from "./hook-io.js";
import { nudgeCmd } from "./nudge.js";
import { RECALL_LIMITS, explainRecall, recallContext, runRecallHook } from "./recall-hook.js";

vi.mock("./hook-io.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hook-io.js")>()),
  readStdinSafe: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const POINTER = `pointer: "[#282](https://github.com/Sumit1993/mage-memory/issues/282)"`;

function admitted(opts: { match?: string[]; when?: string; body?: string; title?: string } = {}): string {
  const { match = ["Bash(npx mage *)"], when = "running the mage binary", body = "Use the repo build.", title = "Which binary" } = opts;
  return [
    "---",
    "rung: note",
    "trigger:",
    `  when: "${when}"`,
    `  match: [${match.map((m) => JSON.stringify(m)).join(", ")}]`,
    POINTER,
    "---",
    `# ${title}`,
    "",
    body,
    "",
  ].join("\n");
}

async function put(root: string, rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
}

function bash(cwd: string, command: string, session: string | null = "s1"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    cwd,
    ...(session === null ? {} : { session_id: session }),
  };
}

describe("recallContext", () => {
  it("injects an admitted note whose match hits the call", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    const text = await recallContext(bash(kb.dir, "cd x && npx mage index"));
    expect(text).toBe(
      [
        "mage recall: 1 note(s) for this Bash call.",
        "",
        "## Which binary (notes/binary.md)\nwhen: running the mage binary\npointer: [#282](https://github.com/Sumit1993/mage-memory/issues/282)\n# Which binary\n\nUse the repo build.",
      ].join("\n"),
    );
  });

  it("gives nothing for a miss, an unadmitted note, a decision and a prose trigger", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/miss.md", admitted({ match: ["Bash(pnpm *)"] }));
    await put(
      kb.root,
      "notes/unadmitted.md",
      "---\nrung: note\ntrigger:\n  when: w\n  match: [\"Bash(npx mage *)\"]\n---\n# No pointer\n",
    );
    await put(kb.root, "decisions/0001-x.md", admitted());
    await put(kb.root, "notes/prose.md", `---\nrung: note\ntrigger: "npx mage"\n${POINTER}\n---\n# Prose\n`);
    expect(await recallContext(bash(kb.dir, "npx mage index"))).toBeNull();
  });

  it("recalls any admitted rung, not only notes", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/rule.md", admitted().replace("rung: note", "rung: rule"));
    expect(await recallContext(bash(kb.dir, "npx mage index"))).toContain("notes/rule.md");
  });

  it("skips a malformed note without failing the others", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/a-bad.md", "---\ntrigger: [unclosed\nmatch: x\n---\n# bad\n");
    await put(kb.root, "notes/b-good.md", admitted());
    const text = await recallContext(bash(kb.dir, "npx mage index"));
    expect(text).toContain("notes/b-good.md");
    expect(text).not.toContain("a-bad");
  });

  it("caps the count at maxNotes, ordered by path", async () => {
    const kb = await withKb();
    for (const n of ["e", "d", "c", "b", "a"]) await put(kb.root, `notes/${n}.md`, admitted({ title: `T${n}` }));
    const text = await recallContext(bash(kb.dir, "npx mage index"));
    expect(text).toContain(`${RECALL_LIMITS.maxNotes} note(s)`);
    expect(text).toContain("notes/a.md");
    expect(text).toContain("notes/c.md");
    expect(text).not.toContain("notes/d.md");
  });

  it("truncates a long body at a line boundary with a pointer", async () => {
    const kb = await withKb();
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i} ${"x".repeat(30)}`);
    await put(kb.root, "notes/long.md", admitted({ body: lines.join("\n") }));
    const text = (await recallContext(bash(kb.dir, "npx mage index"))) ?? "";
    expect(text).toContain("… (truncated; read notes/long.md)");
    expect(text).not.toContain("line 59");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(RECALL_LIMITS.maxBytes);
  });

  it("skips, and does not mark, a note that would exceed maxBytes", async () => {
    const kb = await withKb();
    const fat = Array.from({ length: 30 }, (_, i) => `line ${i} ${"y".repeat(40)}`).join("\n");
    for (const n of ["a", "b", "c"]) {
      await put(kb.root, `notes/${n}.md`, admitted({ body: fat, when: "w".repeat(400) }));
    }
    const first = (await recallContext(bash(kb.dir, "npx mage index"))) ?? "";
    expect(first).toContain("2 note(s)");
    expect(first).not.toContain("notes/c.md");
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(RECALL_LIMITS.maxBytes);
    const state = JSON.parse(await readFile(recallStatePath(kb.root, "s1"), "utf8")) as { injected: string[] };
    expect(state.injected).toEqual(["notes/a.md", "notes/b.md"]);
    expect(await recallContext(bash(kb.dir, "npx mage index"))).toContain("notes/c.md");
  });

  it("injects once per session and again for a new session", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    expect(await recallContext(bash(kb.dir, "npx mage index"))).not.toBeNull();
    expect(await recallContext(bash(kb.dir, "npx mage index"))).toBeNull();
    expect(await recallContext(bash(kb.dir, "npx mage index", "s2"))).not.toBeNull();
  });

  it("reads and writes no state without a usable session id", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    expect(await recallContext(bash(kb.dir, "npx mage index", null))).not.toBeNull();
    expect(await recallContext(bash(kb.dir, "npx mage index", null))).not.toBeNull();
    expect(await recallContext(bash(kb.dir, "npx mage index", "../evil"))).not.toBeNull();
    await expect(readdir(join(kb.root, ".mage", "recall"))).rejects.toThrow();
  });

  it("matches file tools by repo-relative path", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/pkg.md", admitted({ match: ["Edit(package.json)"] }));
    const payload = {
      tool_name: "MultiEdit",
      tool_input: { file_path: join(kb.dir, "package.json") },
      cwd: kb.dir,
      session_id: "s1",
    };
    expect(await recallContext(payload)).toContain("for this MultiEdit call");
  });

  it("matches Edit globs against the code repo in external mode, not the hub", async () => {
    const kb = await withKb({ kind: "external" });
    await put(kb.root, "notes/src.md", admitted({ match: ["Edit(src/**)"] }));
    const payload = {
      tool_name: "Edit",
      tool_input: { file_path: join(kb.dir, "src", "a.ts") },
      cwd: kb.dir,
      session_id: "s1",
    };
    expect(await recallContext(payload)).toContain("for this Edit call");
    const outside = { ...payload, tool_input: { file_path: join(kb.dir, "docs", "a.ts") }, session_id: "s2" };
    expect(await recallContext(outside)).toBeNull();
  });

  it("matches Edit globs against a separate code repo when the session sits in a hub", async () => {
    const kb = await withKb({ kind: "hub" });
    const codeRepo = await tmpDir();
    await mkdir(join(codeRepo, ".git"), { recursive: true });
    await put(kb.root, "notes/src.md", admitted({ match: ["Edit(src/**)"] }));
    const payload = {
      tool_name: "Edit",
      tool_input: { file_path: join(codeRepo, "src", "a.ts") },
      cwd: kb.dir,
      session_id: "s1",
    };
    expect(await recallContext(payload)).toContain("for this Edit call");
  });

  it("is silent without a knowledge base or for an uncovered tool", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    expect(await recallContext({ tool_name: "Read", tool_input: { file_path: "a" }, cwd: kb.dir })).toBeNull();
    expect(await recallContext(bash(join(kb.dir, ".."), "npx mage index"))).toBeNull();
  });

  it("forgets what it injected after a compaction", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    expect(await recallContext(bash(kb.dir, "npx mage index"))).not.toBeNull();
    expect(await recallContext(bash(kb.dir, "npx mage index"))).toBeNull();
    await nudgeCmd({ cwd: kb.dir, source: "compact", sessionId: "s1", hookEventName: "SessionStart" });
    expect(await recallContext(bash(kb.dir, "npx mage index"))).not.toBeNull();
  });
});

describe("explainRecall", () => {
  it("lists matched and skipped notes, counts notes without a match, and writes no state", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    await put(kb.root, "notes/changeset.md", admitted({ match: ["Edit(.changeset/**)"] }));
    await put(kb.root, "notes/prose.md", `---\nrung: note\ntrigger: "when"\n${POINTER}\n---\n# Prose\n`);
    const text = await explainRecall(bash(kb.dir, "npx mage index"));
    const lines = text.split("\n");
    expect(lines[0]).toBe('recall: Bash "npx mage index"');
    expect(lines).toContain("  match  notes/binary.md     Bash(npx mage *)");
    expect(lines).toContain("  skip   notes/changeset.md  Edit(.changeset/**)");
    expect(lines).toContain("  1 admitted note(s) have no trigger.match");
    expect(lines.at(-1)).toMatch(/^would inject 1 note\(s\), \d+ bytes$/);
    await expect(readdir(join(kb.root, ".mage"))).rejects.toThrow();
  });
});

describe("runRecallHook", () => {
  async function run(payload: unknown, argv: string[] = []): Promise<string> {
    vi.mocked(readStdinSafe).mockResolvedValue(typeof payload === "string" ? payload : JSON.stringify(payload));
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
      chunks.push(String(c));
      return true;
    });
    await runRecallHook(argv);
    return chunks.join("");
  }

  it("emits exactly the additionalContext JSON and never a permissionDecision", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    const out = await run(bash(kb.dir, "npx mage index"));
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out) as { hookSpecificOutput: Record<string, unknown> };
    expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
    expect(Object.keys(parsed.hookSpecificOutput)).toEqual(["hookEventName", "additionalContext"]);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out).not.toContain("permissionDecision");
  });

  it("prints nothing for a miss, bad JSON, empty stdin, or an array", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    expect(await run(bash(kb.dir, "ls"))).toBe("");
    expect(await run("{")).toBe("");
    expect(await run("")).toBe("");
    expect(await run("[]")).toBe("");
  });

  it("prints the explain report with --explain", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    const out = await run(bash(kb.dir, "npx mage index"), ["--explain"]);
    expect(out).toContain('recall: Bash "npx mage index"');
    expect(out).toContain("would inject 1 note(s)");
  });

  it("honours --cwd over the payload cwd", async () => {
    const kb = await withKb();
    await put(kb.root, "notes/binary.md", admitted());
    const out = await run({ ...bash("/nonexistent", "npx mage index") }, ["--cwd", kb.dir]);
    expect(out).toContain("additionalContext");
  });
});
