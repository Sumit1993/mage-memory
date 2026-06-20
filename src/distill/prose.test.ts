import { describe, expect, it } from "vitest";
import {
  type Chapter,
  chapterize,
  correctionCandidates,
  failureSkeleton,
  hasContradictionCue,
  isProtocolFailure,
  isSubstantiveCorrection,
  type ProseCandidate,
  rankProseCandidates,
  recurrentFailures,
  type SessionStream,
} from "./prose.js";
import type { ObserveEvent } from "../observe/types.js";

// ─── builders ──────────────────────────────────────────────────────────────────

function bash(detail: string, ok = true, error_summary: string | null = null): ObserveEvent {
  return {
    v: 1, ts: "t", session: "s", type: "tool_use",
    tool: "Bash", paths: [], detail, ok, error_summary: ok ? null : (error_summary ?? "boom"),
  };
}

function prompt(text: string, session = "s"): ObserveEvent {
  return { v: 1, ts: "t", session, type: "user_prompt", text };
}

function fail(error_summary: string, tool = "Bash"): ObserveEvent {
  return { v: 1, ts: "t", session: "s", type: "tool_use", tool, paths: [], detail: null, ok: false, error_summary };
}

function term(): ObserveEvent {
  return { v: 1, ts: "t", session: "s", type: "session_end", reason: "eof" };
}

// ─── failureSkeleton — conservative normalization ───────────────────────────────

describe("failureSkeleton", () => {
  it("strips URLs but keeps the structural error phrase", () => {
    const a = failureSkeleton("403 Forbidden fetching https://api.github.com/repos/x/y/branches");
    const b = failureSkeleton("403 Forbidden fetching https://api.github.com/repos/p/q/protection");
    expect(a).toBe(b); // same error, different URL → one bucket.
    expect(a).toContain("403");
    expect(a).toContain("forbidden");
  });

  it("keeps short status codes, strips long numbers", () => {
    const s = failureSkeleton("Request failed with status 500 after 123456 ms");
    expect(s).toContain("500");
    expect(s).not.toContain("123456");
  });

  it("strips absolute and relative paths", () => {
    const a = failureSkeleton("ENOENT: no such file, open /home/sumit/foo/bar/baz.ts");
    const b = failureSkeleton("ENOENT: no such file, open /var/tmp/other/thing.ts");
    expect(a).toBe(b);
    expect(a).toContain("enoent");
  });

  it("strips UUIDs and long hex hashes", () => {
    const a = failureSkeleton("task 3aec7cad-1fa0-4af2-a35b-e99239336e10 failed");
    const b = failureSkeleton("task 8af71eb4-c683-4fb5-98e9-364c56a5db29 failed");
    expect(a).toBe(b);
    expect(failureSkeleton("commit deadbeef1234 rejected")).not.toContain("deadbeef1234");
  });

  it("collapses quoted specifics so the same error phrase clusters", () => {
    const a = failureSkeleton('Module "react" not found');
    const b = failureSkeleton('Module "vue-router" not found');
    expect(a).toBe(b);
    expect(a).toContain("module");
    expect(a).toContain("not found");
  });

  it("does NOT collapse two genuinely different errors", () => {
    const a = failureSkeleton("permission denied (publickey)");
    const b = failureSkeleton("connection refused");
    expect(a).not.toBe(b);
  });

  it("returns empty when nothing structural survives", () => {
    expect(failureSkeleton("/home/sumit/x/y/z.ts")).toBe("");
    expect(failureSkeleton("123456789")).toBe("");
  });

  it("is idempotent", () => {
    const once = failureSkeleton("403 fetching https://x.com/a/b after 99999 ms");
    expect(failureSkeleton(once)).toBe(once);
  });
});

// ─── isProtocolFailure ───────────────────────────────────────────────────────

describe("isProtocolFailure", () => {
  it("flags Claude Code Edit/Read protocol strings", () => {
    expect(isProtocolFailure("File has not been read yet. Read it first.")).toBe(true);
    expect(isProtocolFailure("String to replace was not found in the file.")).toBe(true);
    expect(isProtocolFailure("Found 3 matches of the string to replace")).toBe(true);
  });

  it("does NOT flag a domain failure", () => {
    expect(isProtocolFailure("403 Forbidden: branch protection requires a paid plan")).toBe(false);
    expect(isProtocolFailure("git: --no-verify is blocked by a pre-commit hook")).toBe(false);
  });
});

// ─── cue + correction noise filter ─────────────────────────────────────────────

describe("hasContradictionCue", () => {
  it("detects steer words on word boundaries", () => {
    expect(hasContradictionCue("no, copy the git history instead")).toBe(true);
    expect(hasContradictionCue("you should split app and load")).toBe(true);
    expect(hasContradictionCue("rather than forking, clone it")).toBe(true);
  });
  it("does not false-fire inside larger words", () => {
    expect(hasContradictionCue("now generate the report")).toBe(false); // "no" in "now"
    expect(hasContradictionCue("annotate the diagram")).toBe(false); // "no" in "annotate"
  });
});

describe("isSubstantiveCorrection", () => {
  it("drops bare continuation/ack tokens", () => {
    for (const t of ["continue", "ok", "yes", "commit", "go ahead", "thanks", "next.", "Perfect!"]) {
      expect(isSubstantiveCorrection(t)).toBe(false);
    }
  });
  it("drops slash-commands and boilerplate", () => {
    expect(isSubstantiveCorrection("/compact")).toBe(false);
    expect(isSubstantiveCorrection("This session is being continued from a previous conversation")).toBe(false);
    expect(isSubstantiveCorrection("Caveat: The messages below were generated by the user")).toBe(false);
  });
  it("drops 'continue from where you left off' continuation phrases", () => {
    expect(isSubstantiveCorrection("Continue from where you left off.")).toBe(false);
    expect(isSubstantiveCorrection("resume where we left off")).toBe(false);
    expect(isSubstantiveCorrection("continue, but commit first and don't push")).toBe(true); // a real steer survives.
  });
  it("drops very short prompts with no contradiction cue", () => {
    expect(isSubstantiveCorrection("do that")).toBe(false);
    expect(isSubstantiveCorrection("run it")).toBe(false);
  });
  it("keeps a terse correction that carries a cue", () => {
    expect(isSubstantiveCorrection("no, fork it")).toBe(true);
    expect(isSubstantiveCorrection("wrong dir")).toBe(true);
  });
  it("keeps a substantive multi-word instruction", () => {
    expect(isSubstantiveCorrection("use the staging dir, not the metrics one")).toBe(true);
    expect(isSubstantiveCorrection("copy the git history rather than forking the repo")).toBe(true);
  });
});

// ─── correctionCandidates ──────────────────────────────────────────────────────

describe("correctionCandidates", () => {
  it("fires on a substantive prompt right after a tool_use", () => {
    const events = [bash("git fork upstream"), prompt("no — copy the git history instead of forking")];
    const out = correctionCandidates(events);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("correction");
    expect(out[0]?.cue).toBe(true);
    expect(out[0]?.precededBy).toContain("git fork upstream");
    expect(out[0]?.text).toContain("copy the git history");
  });

  it("does NOT fire on a prompt that follows session_start (a fresh task, not a reaction)", () => {
    const events: ObserveEvent[] = [
      { v: 1, ts: "t", session: "s", type: "session_start", harness: "cc", cwd: "/x", repo_root: null, mage_version: "0", source: "startup" },
      prompt("use the staging dir, not the metrics one"),
    ];
    expect(correctionCandidates(events)).toHaveLength(0);
  });

  it("drops noise prompts even right after a tool_use", () => {
    const events = [bash("npm test"), prompt("ok"), bash("npm run build"), prompt("continue")];
    expect(correctionCandidates(events)).toHaveLength(0);
  });

  it("fires after an assistant_msg (the ADR-0015 amendment adjacency)", () => {
    const events: ObserveEvent[] = [
      { v: 1, ts: "t", session: "s", type: "assistant_msg", text: "Done — I forked the repo." },
      prompt("that's wrong, copy the history instead"),
    ];
    expect(correctionCandidates(events)).toHaveLength(1);
  });
});

// ─── recurrentFailures ─────────────────────────────────────────────────────────

describe("recurrentFailures", () => {
  it("surfaces a skeleton recurring across ≥K distinct chapters, cross-session", () => {
    const msg = "git --no-verify is blocked by the pre-commit hook";
    const chapters: Chapter[] = [
      { session: "a", failures: [msg] },
      { session: "a", failures: [msg] },
      { session: "b", failures: [msg] },
    ];
    const out = recurrentFailures(chapters, { k: 3 });
    expect(out).toHaveLength(1);
    expect(out[0]?.chapters).toBe(3);
    expect(out[0]?.sessions).toEqual(["a", "b"]);
    expect(out[0]?.examples.length).toBeGreaterThan(0);
  });

  it("does NOT surface a one-off (below K)", () => {
    const chapters: Chapter[] = [
      { session: "a", failures: ["connection refused to db"] },
      { session: "a", failures: ["connection refused to db"] },
    ];
    expect(recurrentFailures(chapters, { k: 3 })).toHaveLength(0);
  });

  it("counts DISTINCT chapters — a tight retry loop in one chapter counts once", () => {
    const chapters: Chapter[] = [
      { session: "a", failures: ["timeout", "timeout", "timeout", "timeout"] },
    ];
    expect(recurrentFailures(chapters, { k: 3 })).toHaveLength(0); // 4 in ONE chapter → count 1.
  });

  it("drops harness-protocol failures before counting", () => {
    const chapters: Chapter[] = [
      { session: "a", failures: ["File has not been read yet"] },
      { session: "b", failures: ["File has not been read yet"] },
      { session: "c", failures: ["File has not been read yet"] },
    ];
    expect(recurrentFailures(chapters, { k: 3 })).toHaveLength(0);
  });

  it("clusters the same error reached via different incidental specifics", () => {
    const chapters: Chapter[] = [
      { session: "a", failures: ["403 fetching https://api.x.com/a"] },
      { session: "b", failures: ["403 fetching https://api.x.com/b"] },
      { session: "c", failures: ["403 fetching https://api.x.com/c"] },
    ];
    const out = recurrentFailures(chapters, { k: 3 });
    expect(out).toHaveLength(1);
    expect(out[0]?.chapters).toBe(3);
  });
});

// ─── chapterize ────────────────────────────────────────────────────────────────

describe("chapterize", () => {
  it("segments at terminators and collects only failures", () => {
    const streams: SessionStream[] = [
      { session: "s", events: [bash("ok cmd"), fail("boom one"), term(), fail("boom two"), term()] },
    ];
    const chapters = chapterize(streams);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.failures).toEqual(["boom one"]);
    expect(chapters[1]?.failures).toEqual(["boom two"]);
  });

  it("windows a terminator-less stream when windowSize is given", () => {
    const events = [fail("e1"), fail("e2"), fail("e3"), fail("e4")];
    const chapters = chapterize([{ session: "s", events }], { windowSize: 2 });
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.failures).toEqual(["e1", "e2"]);
  });

  it("treats a terminator-less stream as one chapter with no windowSize", () => {
    const events = [fail("e1"), fail("e2")];
    expect(chapterize([{ session: "s", events }])).toHaveLength(1);
  });
});

// ─── rankProseCandidates ────────────────────────────────────────────────────────

describe("rankProseCandidates", () => {
  const rf = (chapters: number): ProseCandidate => ({ kind: "recurrent-failure", skeleton: "x", chapters, sessions: ["a"], examples: [] });
  const corr = (cue: boolean): ProseCandidate => ({ kind: "correction", session: "s", text: "t", precededBy: "", cue });

  it("orders recurrent-failure > cue-correction > cue-less correction", () => {
    const ranked = rankProseCandidates([corr(false), corr(true), rf(3)]);
    expect(ranked.map((c) => c.kind)).toEqual(["recurrent-failure", "correction", "correction"]);
    expect((ranked[1] as { cue: boolean }).cue).toBe(true);
  });

  it("orders recurrent-failures by chapter count", () => {
    const ranked = rankProseCandidates([rf(3), rf(9), rf(5)]);
    expect(ranked.map((c) => (c as { chapters: number }).chapters)).toEqual([9, 5, 3]);
  });

  it("honors the cap", () => {
    expect(rankProseCandidates([rf(3), corr(true), corr(false)], { cap: 2 })).toHaveLength(2);
  });
});
