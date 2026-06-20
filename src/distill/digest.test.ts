import { describe, expect, it } from "vitest";
import {
  computeDigest,
  failureSkeleton,
  hasContradictionCue,
  isExternalCommand,
  isProtocolFailure,
  isSubstantiveCorrection,
  renderDigest,
} from "./digest.js";
import type { ObserveEvent } from "../observe/types.js";

// ─── builders ──────────────────────────────────────────────────────────────────

let seq = 0;
function bash(detail: string, ok = true, error_summary: string | null = null): ObserveEvent {
  return { v: 1, ts: `t${seq++}`, session: "s", type: "tool_use", tool: "Bash", paths: [], detail, ok, error_summary: ok ? null : error_summary };
}
function fail(error_summary: string, tool = "Bash"): ObserveEvent {
  return { v: 1, ts: `t${seq++}`, session: "s", type: "tool_use", tool, paths: [], detail: null, ok: false, error_summary };
}
function prompt(text: string): ObserveEvent {
  return { v: 1, ts: `t${seq++}`, session: "s", type: "user_prompt", text };
}

// ─── isExternalCommand (the new first-class channel) ────────────────────────────

describe("isExternalCommand", () => {
  it("matches external/network CLIs", () => {
    for (const c of ["curl https://x.com", "gh api repos/a/b", "kubectl get pods", "aws s3 ls", "npm view react", "docker ps", "psql -c 'select 1'"]) {
      expect(isExternalCommand(c)).toBe(true);
    }
  });
  it("rejects local dev-loop commands", () => {
    for (const c of ["npm test", "npm run build", "git commit -m x", "node script.js", "make all", "npm install"]) {
      expect(isExternalCommand(c)).toBe(false);
    }
  });
});

// ─── reused primitives (smoke) ───────────────────────────────────────────────

describe("reused primitives", () => {
  it("failureSkeleton collapses incidental specifics, keeps the phrase", () => {
    expect(failureSkeleton("403 fetching https://a/x after 99999 ms")).toBe(failureSkeleton("403 fetching https://a/y after 12345 ms"));
    expect(failureSkeleton("403 fetching https://a/x")).toContain("403");
  });
  it("isProtocolFailure flags harness rules (real CC wordings), not domain failures", () => {
    expect(isProtocolFailure("File has not been read yet")).toBe(true);
    expect(isProtocolFailure("<tool_use_error>String to replace not found in file.")).toBe(true); // no "was"
    expect(isProtocolFailure("Permission for this action was denied by the Claude Code auto mode")).toBe(true);
    expect(isProtocolFailure("claude-opus-4-8 is temporarily unavailable, so auto mode cannot")).toBe(true);
    expect(isProtocolFailure("File does not exist. Note: your current working directory is /x")).toBe(true);
    expect(isProtocolFailure("403 branch protection requires a paid plan")).toBe(false);
    expect(isProtocolFailure("Exit code 1 === PRIVATE sreforge-memory protection (may 403 on free plan)")).toBe(false);
  });
  it("isSubstantiveCorrection drops noise, keeps steers", () => {
    expect(isSubstantiveCorrection("continue")).toBe(false);
    expect(isSubstantiveCorrection("Continue from where you left off.")).toBe(false);
    expect(isSubstantiveCorrection("no, copy the git history instead")).toBe(true);
    expect(hasContradictionCue("no, do it the other way")).toBe(true);
  });
});

// ─── computeDigest ──────────────────────────────────────────────────────────────

describe("computeDigest", () => {
  it("dedups failures by skeleton with a count, drops protocol noise, stays chronological", () => {
    const events = [
      fail("403 fetching https://api/x"),
      bash("npm test"),
      fail("403 fetching https://api/y"), // same skeleton → dedup, count 2
      fail("File has not been read yet"), // protocol → dropped
      fail("connection refused to db"),
    ];
    const d = computeDigest(events);
    expect(d.failures.items).toHaveLength(2);
    expect(d.failures.items[0]?.count).toBe(2); // the 403, seen first
    expect(d.failures.items[0]?.text).toContain("403");
    expect(d.failures.items[1]?.text).toContain("connection refused");
  });

  it("surfaces external commands only, exact-deduped", () => {
    const events = [bash("gh api repos/a/b"), bash("npm test"), bash("gh api repos/a/b"), bash("curl https://x")];
    const d = computeDigest(events);
    expect(d.commands.items).toHaveLength(2); // gh (×2) + curl; npm test excluded
    expect(d.commands.items.find((i) => i.text.includes("gh api"))?.count).toBe(2);
  });

  it("captures substantive corrections with preceding action + cue, no dedup", () => {
    const events = [bash("git fork upstream"), prompt("no — copy the history instead"), bash("npm test"), prompt("ok")];
    const d = computeDigest(events);
    expect(d.corrections.items).toHaveLength(1);
    expect(d.corrections.items[0]?.cue).toBe(true);
    expect(d.corrections.items[0]?.precededBy).toContain("git fork upstream");
  });

  it("caps a section keeping the MOST RECENT and records the spill", () => {
    const events = Array.from({ length: 5 }, (_, i) => fail(`distinct error number ${i} alpha`));
    const d = computeDigest(events, { failureCap: 2 });
    expect(d.failures.items).toHaveLength(2);
    expect(d.failures.total).toBe(5);
    expect(d.failures.spilled).toBe(3);
    expect(d.failures.items[1]?.text).toContain("number 4"); // most recent kept
  });

  it("is empty when nothing salient closed", () => {
    const d = computeDigest([bash("npm test"), bash("npm run build"), prompt("ok")]);
    expect(d.isEmpty).toBe(true);
  });
});

// ─── renderDigest ─────────────────────────────────────────────────────────────

describe("renderDigest", () => {
  it("renders a non-claim banner, sections, counts, steer flag, spill line", () => {
    const events = [
      fail("connection refused"),
      fail("connection refused"),
      bash("gh api repos/a/b"),
      bash("git fork upstream"),
      prompt("no, clone it instead of forking"),
    ];
    const out = renderDigest(computeDigest(events));
    expect(out).toContain("Raw material, NOT lessons");
    expect(out).toContain("## Failures");
    expect(out).toContain("(×2)");
    expect(out).toContain("## External commands");
    expect(out).toContain("gh api");
    expect(out).toContain("## Corrections");
    expect(out).toContain("[steer]");
    expect(out).toContain("after:");
  });

  it("emits an explicit spill line, never a silent cap", () => {
    const events = Array.from({ length: 4 }, (_, i) => fail(`unique failure number ${i} beta`));
    const out = renderDigest(computeDigest(events, { failureCap: 2 }));
    expect(out).toMatch(/\+2 more — run `mage distill`/);
  });

  it("returns empty string for an empty digest", () => {
    expect(renderDigest(computeDigest([bash("npm test")]))).toBe("");
  });

  it("honors the char budget with a truncation pointer", () => {
    const events = Array.from({ length: 40 }, (_, i) => fail(`a reasonably long distinct failure message number ${i} that eats budget`));
    const out = renderDigest(computeDigest(events, { failureCap: 100 }), 300);
    expect(out.length).toBeLessThanOrEqual(360);
    expect(out).toContain("truncated");
  });
});
