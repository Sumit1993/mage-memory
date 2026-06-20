import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as redactMod from "../redact.js";
import { buildObserveCommand, observeCmd } from "./observe.js";
import { STATE_DIR, LEARNINGS_DIR } from "../paths.js";
import type { ObserveEvent } from "../observe/types.js";

const SECRET = "ghp_0123456789abcdefghijklmnopqrstuvwx";
const META = JSON.stringify({ schema: "mage.v1", mode: "in-repo", project: "x" });

const realStdin = process.stdin;
function withStdin(fake: Readable): void {
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
}
function restoreStdin(): void {
  Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
}
afterEach(() => {
  restoreStdin();
  vi.restoreAllMocks();
});

async function mkRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "mage-observe-cmd-"));
  await mkdir(join(repo, "mage"), { recursive: true });
  await writeFile(join(repo, "mage", "metadata.json"), META);
  return repo;
}

/** Feed `json` on stdin and run observeCmd; resolves after the command settles. */
async function run(
  json: string,
  opts: { session?: string; event?: ObserveEvent["type"]; cwd?: string },
): Promise<void> {
  const fake = new PassThrough();
  withStdin(fake);
  const p = observeCmd(opts);
  fake.write(json);
  fake.end();
  await p;
}

/** Read the single session jsonl back as parsed events. */
async function readEvents(repo: string, session: string): Promise<ObserveEvent[]> {
  const file = join(repo, "mage", STATE_DIR, LEARNINGS_DIR, `${session}.jsonl`);
  const raw = await readFile(file, "utf8");
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ObserveEvent);
}

describe("observeCmd — hook payload → event mapping", () => {
  it("SessionStart → one session_start line with harness/cwd/repo_root/mage_version/source", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", cwd: repo, source: "startup" }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("session_start");
    if (e?.type === "session_start") {
      expect(e.cwd).toBe(repo);
      expect(typeof e.harness).toBe("string");
      expect(typeof e.mage_version).toBe("string");
      expect(e.source).toBe("startup");
      expect(e.repo_root).toBe(repo);
    }
  });

  it("UserPromptSubmit with a secret → user_prompt whose text is scrubbed and bounded", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: `do it ${SECRET}` }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("user_prompt");
    if (e?.type === "user_prompt") {
      expect(e.text).not.toContain(SECRET);
      expect(e.text.length).toBeLessThanOrEqual(2000);
    }
  });

  it("PostToolUse Bash → tool_use with paths:[], scrubbed bounded detail, ok derived", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: `echo ${SECRET}` },
        tool_response: "ok",
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("tool_use");
    if (e?.type === "tool_use") {
      expect(e.tool).toBe("Bash");
      expect(e.paths).toEqual([]);
      expect(e.detail).not.toBeNull();
      expect(e.detail as string).not.toContain(SECRET);
      expect(e.ok).toBe(true);
    }
  });

  it("PostToolUse Read → tool_use with paths:[file_path], detail null", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        cwd: repo,
        tool_name: "Read",
        tool_input: { file_path: "/a/b.ts" },
        tool_response: "contents",
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    if (e?.type === "tool_use") {
      expect(e.paths).toEqual(["/a/b.ts"]);
      expect(e.detail).toBeNull();
    }
  });

  it("PostToolUse with an error response → ok:false + scrubbed error_summary", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "ls /nope" },
        tool_response: { is_error: true, content: "No such file" },
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    if (e?.type === "tool_use") {
      expect(e.ok).toBe(false);
      expect(e.error_summary).not.toBeNull();
    }
  });

  it("PostToolUseFailure → tool_use ok:false (the failure hook is mapped, not dropped) with the top-level error", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUseFailure",
        session_id: "s1",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        error: "exited with code 1: 3 failing tests",
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("tool_use");
    if (e?.type === "tool_use") {
      expect(e.ok).toBe(false);
      expect(e.tool).toBe("Bash");
      expect(e.error_summary).toContain("3 failing");
    }
  });

  it("PostToolUseFailure on the Skill tool → skill_load (still recognized as a load)", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUseFailure",
        session_id: "s1",
        cwd: repo,
        tool_name: "Skill",
        tool_input: { skill: "handoff" },
        error: "skill not found",
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("skill_load");
  });

  it("PostToolUse Skill (mage wing) → skill_load with match + trigger_hash, NOT tool_use", async () => {
    const repo = await mkRepo();
    // Seed a wing skill + a wing note so the snapshot has real content.
    const skillDir = join(repo, ".claude", "skills", "mage-wing-mage");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: mage-wing-mage\ndescription: Load when working on mage.\n---\n# mage\n",
    );
    await mkdir(join(repo, "mage", "notes"), { recursive: true });
    await writeFile(
      join(repo, "mage", "notes", "n.md"),
      "---\ntype: gotcha\ntags: [mage/core]\nkeywords: [observe, capture, schema]\n---\n# n\n",
    );

    await run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        cwd: repo,
        tool_name: "Skill",
        tool_input: { skill: "mage-wing-mage" },
        tool_response: "loaded",
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("skill_load");
    if (e?.type === "skill_load") {
      expect(e.skill).toBe("mage-wing-mage");
      expect(e.match).not.toBeNull();
      expect(e.match?.wing).toBe("mage");
      expect(e.trigger_hash).not.toBeNull();
    }
  });

  it("PostToolUse Skill (foreign) → skill_load with match:null, trigger_hash:null", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        cwd: repo,
        tool_name: "Skill",
        tool_input: { skill: "continuous-learning-v2" },
        tool_response: "loaded",
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("skill_load");
    if (e?.type === "skill_load") {
      expect(e.skill).toBe("continuous-learning-v2");
      expect(e.match).toBeNull();
      expect(e.trigger_hash).toBeNull();
    }
  });

  it("PreCompact → compact with the right trigger; defaults to auto when absent", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "PreCompact", session_id: "s1", trigger: "manual" }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("compact");
    if (e?.type === "compact") expect(e.trigger).toBe("manual");

    await run(
      JSON.stringify({ hook_event_name: "PreCompact", session_id: "s2" }),
      { cwd: repo },
    );
    const [e2] = await readEvents(repo, "s2");
    if (e2?.type === "compact") expect(e2.trigger).toBe("auto");
  });

  it("coerces an unexpected compact trigger string to auto (validate at boundary)", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "PreCompact", session_id: "s1", trigger: "weird" }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    if (e?.type === "compact") expect(e.trigger).toBe("auto");
  });

  it("SessionEnd → session_end; reason omitted when absent", async () => {
    const repo = await mkRepo();
    await run(JSON.stringify({ hook_event_name: "SessionEnd", session_id: "s1" }), { cwd: repo });
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("session_end");
    if (e?.type === "session_end") expect(e.reason).toBeUndefined();
  });

  it("--event override forces the type regardless of hook_event_name", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", cwd: repo }),
      { cwd: repo, event: "session_end" },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("session_end");
  });

  it("--session override wins over stdin session_id and drives the filename", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "SessionStart", session_id: "from-stdin", cwd: repo }),
      { cwd: repo, session: "from-flag" },
    );
    const [e] = await readEvents(repo, "from-flag");
    expect(e?.session).toBe("from-flag");
  });

  it("a bogus --event value writes NOTHING (no corrupt `undefined` JSONL line)", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", cwd: repo }),
      // Bogus forced type — Commander does not validate the union at runtime.
      { cwd: repo, event: "bogus" as ObserveEvent["type"] },
    );
    // The session file must not exist: the invalid type is a clean no-op, never a
    // non-parseable `undefined\n` line.
    await expect(readEvents(repo, "s1")).rejects.toThrow();
  });
});

describe("observeCmd — fail-open contract (never throws to the host hook)", () => {
  it("malformed JSON on stdin → resolves, writes nothing, never throws", async () => {
    const repo = await mkRepo();
    await expect(run("not json at all {", { cwd: repo })).resolves.toBeUndefined();
    await expect(readEvents(repo, "s1")).rejects.toThrow(); // nothing written
  });

  it("empty stdin → resolves, writes nothing", async () => {
    const repo = await mkRepo();
    await expect(run("", { cwd: repo })).resolves.toBeUndefined();
  });

  it("non-object JSON (array/primitive) → resolves, writes nothing", async () => {
    const repo = await mkRepo();
    await expect(run("[1,2,3]", { cwd: repo })).resolves.toBeUndefined();
    await expect(run("true", { cwd: repo })).resolves.toBeUndefined();
  });

  it("a stdin 'error' event → resolves (does NOT reject, unlike redactCmd)", async () => {
    const repo = await mkRepo();
    const fake = new PassThrough();
    withStdin(fake);
    const p = observeCmd({ cwd: repo });
    fake.emit("error", new Error("pipe broke"));
    await expect(p).resolves.toBeUndefined();
  });

  it("no KB found → resolves, writes nothing", async () => {
    const plain = await mkdtemp(join(tmpdir(), "mage-observe-nokb-"));
    await expect(
      run(JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", cwd: plain }), { cwd: plain }),
    ).resolves.toBeUndefined();
  });
});

describe("observeCmd — fail-closed redaction inside fail-open", () => {
  it("when redact() throws, the line is still written with the sentinel and raw is never stored", async () => {
    const repo = await mkRepo();
    vi.spyOn(redactMod, "redact").mockImplementation(() => {
      throw new Error("redactor blew up");
    });
    await expect(
      run(
        JSON.stringify({
          hook_event_name: "PostToolUse",
          session_id: "s1",
          cwd: repo,
          tool_name: "Bash",
          tool_input: { command: `echo ${SECRET}` },
          tool_response: "ok",
        }),
        { cwd: repo },
      ),
    ).resolves.toBeUndefined();
    const [e] = await readEvents(repo, "s1");
    if (e?.type === "tool_use") {
      expect(e.detail).toBe("[REDACTED:redact-error]");
      expect(JSON.stringify(e)).not.toContain(SECRET);
    }
  });

  it("JSON.stringify error fallback passes the FULL value to scrubField (scrub-before-truncate)", async () => {
    const repo = await mkRepo();
    // An error tool_response with NO .error/.content/.message string field forces
    // the deriveOk JSON.stringify fallback. The secret leads the serialization so
    // the whole token is in-band; the fix scrubs the full value (no pre-slice) and
    // the stored error_summary must redact it rather than carry the raw token.
    await run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "s1",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "do thing" },
        tool_response: { is_error: true, token: SECRET },
      }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("tool_use");
    if (e?.type === "tool_use") {
      expect(e.ok).toBe(false);
      expect(e.error_summary).not.toBeNull();
      // The full token reached the detector and was redacted; no raw token stored.
      expect(JSON.stringify(e)).not.toContain(SECRET);
      expect(e.error_summary).toContain("REDACTED");
    }
  });
});

describe("observeCmd — Stop → assistant_msg (ADR-0019 amendment)", () => {
  /** Write a transcript .jsonl in the repo's tmp dir and return its path. */
  async function writeTranscript(repo: string, name: string, body: string): Promise<string> {
    const path = join(repo, name);
    await writeFile(path, body);
    return path;
  }

  it("Stop with a transcript → one assistant_msg whose text is the LAST assistant reply, scrubbed", async () => {
    const repo = await mkRepo();
    const transcript = await writeTranscript(
      repo,
      "transcript.jsonl",
      [
        JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "first reply" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: `final reply ${SECRET}` }] },
        }),
      ].join("\n"),
    );

    await run(
      JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo, transcript_path: transcript }),
      { cwd: repo },
    );

    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("assistant_msg");
    if (e?.type === "assistant_msg") {
      expect(e.text).toContain("final reply"); // the LAST assistant message wins.
      expect(e.text).not.toContain("first reply");
      expect(e.text).not.toContain(SECRET); // scrubbed before truncate.
      expect(e.text.length).toBeLessThanOrEqual(2000);
    }
  });

  it("SubagentStop with a subagent transcript → one assistant_msg (Candidate 4: autonomous capture)", async () => {
    const repo = await mkRepo();
    const transcript = await writeTranscript(
      repo,
      "subagent.jsonl",
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: `subagent result ${SECRET}` }] },
      }),
    );

    await run(
      JSON.stringify({
        hook_event_name: "SubagentStop",
        session_id: "s1",
        cwd: repo,
        transcript_path: transcript,
      }),
      { cwd: repo },
    );

    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("assistant_msg"); // SubagentStop maps to assistant_msg, exactly like Stop.
    if (e?.type === "assistant_msg") {
      expect(e.text).toContain("subagent result"); // the subagent's final reply is captured.
      expect(e.text).not.toContain(SECRET); // scrubbed before truncate (same seam as Stop).
    }
  });

  it("concatenates multiple text parts of the final assistant message", async () => {
    const repo = await mkRepo();
    const transcript = await writeTranscript(
      repo,
      "transcript.jsonl",
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "part-a " }, { type: "text", text: "part-b" }] },
      }),
    );
    await run(
      JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo, transcript_path: transcript }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    if (e?.type === "assistant_msg") expect(e.text).toBe("part-a part-b");
  });

  it("a missing transcript_path → nothing written (fail open)", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo }),
      { cwd: repo },
    );
    await expect(readEvents(repo, "s1")).rejects.toThrow();
  });

  it("a transcript_path pointing at a nonexistent file → nothing written (fail open)", async () => {
    const repo = await mkRepo();
    await run(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "s1",
        cwd: repo,
        transcript_path: join(repo, "does-not-exist.jsonl"),
      }),
      { cwd: repo },
    );
    await expect(readEvents(repo, "s1")).rejects.toThrow();
  });

  it("a garbage / torn transcript with no assistant text → nothing written (fail open)", async () => {
    const repo = await mkRepo();
    const transcript = await writeTranscript(
      repo,
      "garbage.jsonl",
      ["not json at all {", JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } })].join("\n"),
    );
    await run(
      JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo, transcript_path: transcript }),
      { cwd: repo },
    );
    await expect(readEvents(repo, "s1")).rejects.toThrow();
  });

  it("tolerates a torn line and still captures the last well-formed assistant message", async () => {
    const repo = await mkRepo();
    const transcript = await writeTranscript(
      repo,
      "mixed.jsonl",
      [
        "{ broken json",
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "survivor" }] },
        }),
      ].join("\n"),
    );
    await run(
      JSON.stringify({ hook_event_name: "Stop", session_id: "s1", cwd: repo, transcript_path: transcript }),
      { cwd: repo },
    );
    const [e] = await readEvents(repo, "s1");
    expect(e?.type).toBe("assistant_msg");
    if (e?.type === "assistant_msg") expect(e.text).toBe("survivor");
  });
});

// Drives the REAL Commander wiring (buildObserveCommand), not observeCmd() directly,
// so a flag declared on ObserveOptions but never registered (the `--cwd` regression)
// is caught — observeCmd-only tests cannot see the parser.
describe("observe CLI wiring (buildObserveCommand)", () => {
  it("registers --session, --event, and --cwd on the command", () => {
    const longs = buildObserveCommand()
      .options.map((o) => o.long);
    expect(longs).toContain("--session");
    expect(longs).toContain("--event");
    expect(longs).toContain("--cwd"); // the option that shipped unwired.
  });

  it("parses --cwd + --session through Commander into a written event", async () => {
    const repo = await mkRepo();
    const fake = new PassThrough();
    withStdin(fake);
    const cmd = buildObserveCommand();
    const p = cmd.parseAsync(
      ["--cwd", repo, "--session", "clitest"],
      { from: "user" },
    );
    fake.write(JSON.stringify({ hook_event_name: "PreCompact", trigger: "manual" }));
    fake.end();
    await p;

    const [e] = await readEvents(repo, "clitest");
    expect(e?.type).toBe("compact");
  });

  it("an unknown flag is rejected by Commander (registration is the contract)", async () => {
    const cmd = buildObserveCommand().exitOverride();
    await expect(
      cmd.parseAsync(["--nope", "x"], { from: "user" }),
    ).rejects.toThrow();
  });
});
