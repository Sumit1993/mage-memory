import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../../test/fixtures/kb.js";
import {
  type MemoryDecision,
  buildMemoryHookCommand,
  emitPostToolUseContext,
  emitPreToolUse,
  memoryPostToolUse,
  memoryPreToolUse,
} from "./memory-hook.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function preWrite(cwd: string, filePath: string, content: string): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    cwd,
    tool_input: { file_path: filePath, content },
  };
}

const CC_NOTE = [
  "---",
  "name: my-lesson",
  "description: Rancher needs the moby engine.",
  "metadata:",
  "  node_type: memory",
  "  type: reference",
  "---",
  "**Symptom:** pods pending.",
  "",
].join("\n");

describe("memoryPreToolUse", () => {
  it("passes a non-Write/Edit tool untouched", async () => {
    const kb = await withKb();
    const d = await memoryPreToolUse({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: kb.dir,
      tool_input: { command: "ls" },
    });
    expect(d.kind).toBe("pass");
  });

  it("DENIES a write to a generated index (MEMORY.md / INDEX.md / _index.*.md)", async () => {
    const kb = await withKb();
    for (const name of ["MEMORY.md", "INDEX.md", "_index.mage.md"]) {
      const d = await memoryPreToolUse(preWrite(kb.dir, join(kb.root, name), "# hijack\n"));
      expect(d.kind).toBe("deny");
      if (d.kind === "deny") expect(d.reason).toContain("mage owns");
    }
  });

  it("REWRITES a flat topic-note write: scrubs + schema-maps in-flight", async () => {
    const kb = await withKb();
    const d = await memoryPreToolUse(preWrite(kb.dir, join(kb.root, "my-lesson.md"), CC_NOTE));
    expect(d.kind).toBe("rewrite");
    if (d.kind !== "rewrite") return;
    expect(d.slug).toBe("my-lesson");
    const content = d.updatedInput.content as string;
    // schema-mapped: native metadata.type "reference" → mage type "pointer", H1 from name,
    // description folded into the body, node_type discriminator dropped.
    expect(content).toContain("type: pointer");
    expect(content).toContain("# My lesson");
    expect(content).toContain("Rancher needs the moby engine");
    expect(content).not.toContain("node_type");
    // updatedInput echoes the original keys (CC replaces the whole tool_input).
    expect(d.updatedInput.file_path).toBe(join(kb.root, "my-lesson.md"));
  });

  it("scrubs secrets/PII in-flight (Gate-0: never reaches disk)", async () => {
    const kb = await withKb();
    const note = `---\nname: leak\n---\nping admin@example.com about it\n`;
    const d = await memoryPreToolUse(preWrite(kb.dir, join(kb.root, "leak.md"), note));
    expect(d.kind).toBe("rewrite");
    if (d.kind !== "rewrite") return;
    expect(d.masked).toBeGreaterThan(0);
    expect(d.updatedInput.content as string).toContain("[REDACTED:email]");
    expect(d.updatedInput.content as string).not.toContain("admin@example.com");
  });

  it("still scrubs when the frontmatter is malformed YAML (never falls through unscrubbed)", async () => {
    // Malformed frontmatter makes parseNote throw; Gate-0 must NOT let that escape to
    // the fail-open sink (which would write the ORIGINAL content) — it scrubs the raw
    // bytes instead, so the embedded secret never reaches disk.
    const kb = await withKb();
    const broken = `---\nname: "unterminated\nmetadata: [oops\n---\ntoken AKIA1234567890ABCD56 leaked here\n`;
    const d = await memoryPreToolUse(preWrite(kb.dir, join(kb.root, "broken.md"), broken));
    expect(d.kind).toBe("rewrite");
    if (d.kind !== "rewrite") return;
    expect(d.masked).toBeGreaterThan(0);
    expect(d.updatedInput.content as string).not.toContain("AKIA1234567890ABCD56");
    expect(d.updatedInput.content as string).toContain("[REDACTED");
    expect(d.slug).toBe("broken");
  });

  it("PASSES a subdirectory write, a non-.md write, and a path outside the root", async () => {
    const kb = await withKb();
    const other = await tmpDir("outside-");
    const cases = [
      join(kb.root, "notes", "x.md"), // subdir
      join(kb.root, "scratch.txt"), // non-.md
      join(other, "elsewhere.md"), // outside the docs root
    ];
    for (const fp of cases) {
      const d = await memoryPreToolUse(preWrite(kb.dir, fp, "whatever"));
      expect(d.kind).toBe("pass");
    }
  });

  it("scrubs only new_string on an Edit (a fragment — no schema-map)", async () => {
    const kb = await withKb();
    const d = await memoryPreToolUse({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      cwd: kb.dir,
      tool_input: {
        file_path: join(kb.root, "my-lesson.md"),
        old_string: "x",
        new_string: "new contact admin@example.com",
      },
    });
    expect(d.kind).toBe("rewrite");
    if (d.kind !== "rewrite") return;
    expect(d.updatedInput.new_string as string).toContain("[REDACTED:email]");
    expect(d.updatedInput.old_string).toBe("x"); // untouched
    expect(d.updatedInput).not.toHaveProperty("content"); // Edit has no content
  });

  it("DENIES an Edit to a generated index too", async () => {
    const kb = await withKb();
    const d = await memoryPreToolUse({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      cwd: kb.dir,
      tool_input: { file_path: join(kb.root, "MEMORY.md"), old_string: "a", new_string: "b" },
    });
    expect(d.kind).toBe("deny");
  });

  it("fails OPEN (pass, never deny) when the cwd is not a knowledge base", async () => {
    const notKb = await tmpDir("not-a-kb-");
    const d = await memoryPreToolUse(preWrite(notKb, join(notKb, "x.md"), CC_NOTE));
    expect(d.kind).toBe("pass");
  });

  it("passes when tool_input / file_path is missing", async () => {
    const kb = await withKb();
    expect((await memoryPreToolUse({ tool_name: "Write", cwd: kb.dir })).kind).toBe("pass");
  });
});

describe("memoryPostToolUse", () => {
  it("nudges `mage groom` after a topic-note write", async () => {
    const kb = await withKb();
    const ctx = await memoryPostToolUse(preWrite(kb.dir, join(kb.root, "my-lesson.md"), CC_NOTE));
    expect(ctx).toContain("my-lesson");
    expect(ctx).toContain("mage groom");
  });

  it("is silent for an index write or a subdir write", async () => {
    const kb = await withKb();
    expect(await memoryPostToolUse(preWrite(kb.dir, join(kb.root, "MEMORY.md"), "x"))).toBeNull();
    expect(
      await memoryPostToolUse(preWrite(kb.dir, join(kb.root, "notes", "x.md"), "x")),
    ).toBeNull();
  });
});

describe("emit", () => {
  function spyStdout() {
    return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  }

  it("emits NOTHING for a pass (preserves the host's permission flow)", () => {
    const spy = spyStdout();
    emitPreToolUse({ kind: "pass" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits a deny decision as PreToolUse permissionDecision JSON", () => {
    const spy = spyStdout();
    emitPreToolUse({ kind: "deny", reason: "mage owns MEMORY.md" });
    const out = JSON.parse((spy.mock.calls[0]?.[0] as string).trim());
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("emits a rewrite as allow + updatedInput", () => {
    const spy = spyStdout();
    const d: MemoryDecision = {
      kind: "rewrite",
      updatedInput: { file_path: "/x/a.md", content: "scrubbed" },
      reason: "mage scrubbed 1",
      slug: "a",
      masked: 1,
    };
    emitPreToolUse(d);
    const out = JSON.parse((spy.mock.calls[0]?.[0] as string).trim());
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.content).toBe("scrubbed");
  });

  it("emits a PostToolUse additionalContext nudge", () => {
    const spy = spyStdout();
    emitPostToolUseContext("mage captured `a`");
    const out = JSON.parse((spy.mock.calls[0]?.[0] as string).trim());
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toBe("mage captured `a`");
  });
});

describe("buildMemoryHookCommand", () => {
  it("registers a hidden `memory-hook` command", () => {
    const cmd = buildMemoryHookCommand();
    expect(cmd.name()).toBe("memory-hook");
  });
});
