import { describe, expect, it } from "vitest";
import {
  buildSessionEnd,
  buildSessionStart,
  buildToolUse,
  type EventBase,
  extractDetail,
  extractPaths,
  triggerHash,
} from "./events.js";
import { DETAIL_MAX, OBSERVE_SCHEMA_VERSION } from "./types.js";

const BASE: EventBase = { ts: "2026-06-06T00:00:00.000Z", session: "sess-1" };

describe("event builders (ADR-0015 §1–§4)", () => {
  it("buildSessionStart stamps v:1, ts/session, and copies session-constant fields", () => {
    const e = buildSessionStart(BASE, {
      harness: "claude-code",
      cwd: "/repo",
      repo_root: "/repo",
      mage_version: "0.0.5",
      source: "SessionStart",
    });
    expect(e.v).toBe(OBSERVE_SCHEMA_VERSION);
    expect(e.v).toBe(1);
    expect(e.ts).toBe(BASE.ts);
    expect(e.session).toBe(BASE.session);
    expect(e.type).toBe("session_start");
    expect(e.harness).toBe("claude-code");
    expect(e.cwd).toBe("/repo");
    expect(e.repo_root).toBe("/repo");
    expect(e.mage_version).toBe("0.0.5");
    expect(e.source).toBe("SessionStart");
  });

  it("buildToolUse for Read → paths carries the file, detail null, ok true", () => {
    const e = buildToolUse(BASE, {
      tool: "Read",
      paths: ["/abs/file.ts"],
      detail: null,
      ok: true,
      error_summary: null,
    });
    expect(e.type).toBe("tool_use");
    expect(e.tool).toBe("Read");
    expect(e.paths).toEqual(["/abs/file.ts"]);
    expect(e.detail).toBeNull();
    expect(e.ok).toBe(true);
    expect(e.error_summary).toBeNull();
  });

  it("buildSessionEnd omits reason when not supplied (consumers tolerate absence)", () => {
    const e = buildSessionEnd(BASE);
    expect(e.type).toBe("session_end");
    expect("reason" in e).toBe(false);
    const withReason = buildSessionEnd(BASE, "clear");
    expect(withReason.reason).toBe("clear");
  });
});

describe("extractPaths — structured inputs only (§4/§5)", () => {
  it("Bash is never path-parsed → []", () => {
    expect(extractPaths("Bash", { command: "cat /etc/passwd && ls /tmp" })).toEqual([]);
  });

  it("Read/Write/Edit/NotebookEdit → [file_path], or [] when absent", () => {
    for (const tool of ["Read", "Write", "Edit", "NotebookEdit"]) {
      expect(extractPaths(tool, { file_path: "/a/b.ts" })).toEqual(["/a/b.ts"]);
      expect(extractPaths(tool, {})).toEqual([]);
    }
  });

  it("Glob/Grep → [path] when present, else []", () => {
    expect(extractPaths("Glob", { path: "/root", pattern: "**/*.ts" })).toEqual(["/root"]);
    expect(extractPaths("Grep", { path: "/root", pattern: "foo" })).toEqual(["/root"]);
    expect(extractPaths("Glob", { pattern: "**/*.ts" })).toEqual([]);
    expect(extractPaths("Grep", { pattern: "foo" })).toEqual([]);
  });

  it("unknown tools → []", () => {
    expect(extractPaths("WebFetch", { url: "https://x.test" })).toEqual([]);
    expect(extractPaths("Task", { prompt: "do" })).toEqual([]);
  });

  it("non-string structured fields are ignored (noUncheckedIndexedAccess safety)", () => {
    expect(extractPaths("Read", { file_path: 42 })).toEqual([]);
    expect(extractPaths("Grep", { path: { x: 1 } })).toEqual([]);
  });

  it("bounds an over-long path to PATH_MAX", () => {
    const long = `/${"a".repeat(1000)}`;
    const [p] = extractPaths("Read", { file_path: long });
    expect(p).toBeDefined();
    expect((p as string).length).toBeLessThanOrEqual(400);
  });
});

describe("extractDetail — per-tool salient field (§4/§5)", () => {
  it("Bash → the command (raw, untruncated — scrub layer bounds it)", () => {
    expect(extractDetail("Bash", { command: "pnpm test" }, [])).toBe("pnpm test");
  });

  it("Grep → pattern; WebFetch → url; absent → null", () => {
    expect(extractDetail("Grep", { pattern: "TODO" }, [])).toBe("TODO");
    expect(extractDetail("WebFetch", { url: "https://x.test" }, [])).toBe("https://x.test");
    expect(extractDetail("Grep", {}, [])).toBeNull();
    expect(extractDetail("WebFetch", {}, [])).toBeNull();
  });

  it("Read/Write/Edit/NotebookEdit → null (paths carry the salient datum)", () => {
    for (const tool of ["Read", "Write", "Edit", "NotebookEdit"]) {
      expect(extractDetail(tool, { file_path: "/a/b.ts" }, ["/a/b.ts"])).toBeNull();
    }
  });

  it("unknown tools → null", () => {
    expect(extractDetail("Task", { prompt: "x" }, [])).toBeNull();
  });

  it("returns the FULL raw value (no pre-truncation) so scrub-then-truncate cannot split a secret", () => {
    const long = "x".repeat(DETAIL_MAX + 100);
    const d = extractDetail("Bash", { command: long }, []);
    expect(d).toBe(long);
    expect((d as string).length).toBeGreaterThan(DETAIL_MAX);
  });

  it("non-string detail fields → null", () => {
    expect(extractDetail("Bash", { command: 123 }, [])).toBeNull();
  });
});

describe("triggerHash (§3 / ADR-0016 §1 held-out gate)", () => {
  it("is deterministic — same input yields same hex", () => {
    expect(triggerHash("a trigger")).toBe(triggerHash("a trigger"));
  });

  it("differs when the description changes", () => {
    expect(triggerHash("trigger A")).not.toBe(triggerHash("trigger B"));
  });

  it("trims before hashing (whitespace-insensitive at the edges)", () => {
    expect(triggerHash("  desc  ")).toBe(triggerHash("desc"));
  });

  it("produces a 64-char sha256 hex string", () => {
    expect(triggerHash("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
