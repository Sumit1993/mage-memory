import { describe, expect, it } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import {
  buildAssistantMsg,
  buildSessionEnd,
  buildSessionStart,
  buildSkillLoad,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import { keywordsFromText, segmentSignatures, SIG_KEYWORDS, wingFromSegment } from "./signature.js";

// ─── ObserveEvent builders (monotonic clock) ──────────────────────────────────

const SESSION = "sess-1";
let clock = 0;
function nextTs(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 5, 8, 0, 0, clock)).toISOString();
}
function base(session = SESSION): EventBase {
  return { ts: nextTs(), session };
}
function prompt(text: string): ObserveEvent {
  return buildUserPrompt(base(), text);
}
function assistant(text: string): ObserveEvent {
  return buildAssistantMsg(base(), text);
}
function tool(
  p: { tool?: string; paths?: string[]; detail?: string | null; ok?: boolean; error_summary?: string | null },
): ObserveEvent {
  return buildToolUse(base(), {
    tool: p.tool ?? "Read",
    paths: p.paths ?? [],
    detail: p.detail ?? null,
    ok: p.ok ?? true,
    error_summary: p.error_summary ?? null,
  });
}
function skillLoad(): ObserveEvent {
  return buildSkillLoad(base(), { skill: "s", args: null, match: null, trigger_hash: null });
}
function sessionStart(): ObserveEvent {
  return buildSessionStart(base(), {
    harness: "claude",
    cwd: "/x",
    repo_root: null,
    mage_version: "0.0.8",
    source: "startup",
  });
}
const sessionEnd = (): ObserveEvent => buildSessionEnd(base());

/** Whole-array segment helper. */
function whole(events: ObserveEvent[]): { start: number; end: number } {
  return { start: 0, end: events.length };
}

// ─── keywordsFromText ─────────────────────────────────────────────────────────

describe("keywordsFromText — deterministic derivation", () => {
  it("lower-cases, drops stopwords and short tokens, sorts alpha", () => {
    expect(keywordsFromText("The Webhook is IDEMPOTENT to a")).toEqual(["idempotent", "webhook"]);
  });

  it("de-dupes and caps at SIG_KEYWORDS, frequency-desc then alpha", () => {
    // "alpha" x3, "bravo" x2, then five singletons — only top SIG_KEYWORDS survive.
    const text = "alpha alpha alpha bravo bravo charlie delta echo foxtrot golf hotel";
    const kw = keywordsFromText(text);
    expect(kw.length).toBe(SIG_KEYWORDS);
    // The two highest-frequency tokens MUST be present regardless of alpha sort.
    expect(kw).toContain("alpha");
    expect(kw).toContain("bravo");
    // Final order is alpha-sorted (stable key).
    expect([...kw]).toEqual([...kw].sort());
  });

  it("is order-independent: same words → same sorted set", () => {
    expect(keywordsFromText("webhook idempotency retry")).toEqual(
      keywordsFromText("retry webhook idempotency"),
    );
  });

  it("returns [] for all-stopword / empty text", () => {
    expect(keywordsFromText("the a an of to")).toEqual([]);
    expect(keywordsFromText("")).toEqual([]);
  });
});

// ─── wingFromSegment ──────────────────────────────────────────────────────────

describe("wingFromSegment — first touched-path wing", () => {
  it("derives the first path segment as the wing (relative path)", () => {
    const events = [tool({ paths: ["payments/webhook.ts"] }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), null)).toBe("payments");
  });

  it("strips repoRoot from an absolute path before reading the wing", async () => {
    const root = await tmpDir();
    const events = [tool({ paths: [`${root}/billing/charge.ts`] }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), root)).toBe("billing");
  });

  it("is '' when no tool touched a path", () => {
    const events = [prompt("hello"), tool({ detail: "ls" }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), null)).toBe("");
  });

  it("is '' for a bare leaf filename — a single-segment path names no wing (0.0.8 dogfood regression)", () => {
    // A bare relative filename has no directory scope; it must NOT become a wing, else
    // every distinct file is its own "wing" and recurrence fragments across files.
    const events = [tool({ paths: ["definitely-not-a-real-file.md"] }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), null)).toBe("");
  });

  it("is '' for a repo-ROOT file (absolute → single segment after stripping repoRoot)", async () => {
    // The exact dogfood shape: an absolute path to a file at the repo root resolves to a
    // single segment once repoRoot is stripped → no directory → no wing.
    const root = await tmpDir();
    const events = [tool({ paths: [`${root}/toplevel-file.md`] }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), root)).toBe("");
  });

  it("de-containers a hub `projects/<name>/...` path → the project name is the wing (0.0.11 Candidate 2)", () => {
    // A hub-owned project's docs live at `projects/<name>/...`; the wing must be the
    // PROJECT (`prismalens-engine`), not the literal `projects` container — else every
    // hub project collapses to one "projects" wing (the soak's mis-tag).
    const events = [tool({ paths: ["projects/prismalens-engine/specs/api.md"] }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), null)).toBe("prismalens-engine");
  });

  it("a length-2 `projects/<name>` path is not de-containered (name is a leaf, not a scope)", () => {
    // Only `projects/<name>/<leaf>` (>= 3 segments) names a project wing; a bare
    // `projects/<name>` keeps the conservative first-segment fallback.
    const events = [tool({ paths: ["projects/prismalens-engine"] }), sessionEnd()];
    expect(wingFromSegment(events, whole(events), null)).toBe("projects");
  });
});

// ─── segmentSignatures — the four lenses ──────────────────────────────────────

describe("segmentSignatures — the four ADR-0019 lenses", () => {
  it("lens ① correction: a prompt right after a tool_use is a correction", () => {
    const events = [tool({ paths: ["payments/x.ts"] }), prompt("always validate the webhook signature"), sessionEnd()];
    const hits = segmentSignatures(events, whole(events), null);
    const corr = hits.find((h) => h.lens === "correction");
    expect(corr).toBeDefined();
    expect(corr?.wing).toBe("payments");
    expect(corr?.keywords).toContain("webhook");
    expect(corr?.hint.startsWith("correction:")).toBe(true);
  });

  it("lens ① correction: a prompt right after an assistant_msg is a correction (the amendment)", () => {
    const events = [assistant("I will refactor the parser"), prompt("no, keep the parser immutable"), sessionEnd()];
    const corr = segmentSignatures(events, whole(events), null).find((h) => h.lens === "correction");
    expect(corr).toBeDefined();
    expect(corr?.keywords).toContain("immutable");
  });

  it("a prompt after a skill_load / session_start / another prompt is NOT a correction", () => {
    const a = [skillLoad(), prompt("just intent here"), sessionEnd()];
    expect(segmentSignatures(a, whole(a), null).some((h) => h.lens === "correction")).toBe(false);
    const b = [sessionStart(), prompt("opening prompt text"), sessionEnd()];
    expect(segmentSignatures(b, whole(b), null).some((h) => h.lens === "correction")).toBe(false);
    const c = [prompt("first prompt here"), prompt("second prompt continuation"), sessionEnd()];
    expect(segmentSignatures(c, whole(c), null).some((h) => h.lens === "correction")).toBe(false);
  });

  it("lens ② failure: an ok:false tool_use keys its error_summary", () => {
    const events = [tool({ tool: "Bash", ok: false, error_summary: "ENOENT missing config file" }), sessionEnd()];
    const fail = segmentSignatures(events, whole(events), null).find((h) => h.lens === "failure");
    expect(fail).toBeDefined();
    expect(fail?.keywords).toContain("enoent");
    expect(fail?.hint.startsWith("failure:")).toBe(true);
  });

  it("lens ③ workflow: a tool repeated >=2 in the segment fires workflow (keyed on the TOPIC, not the tool verb)", () => {
    // The tool name ("grep") is a de-noise token (Candidate 3) — the signature keys on
    // the touched topic (the basename words), never the verb, so near-identical work
    // doesn't shatter into per-verb buckets.
    const events = [
      tool({ tool: "Grep", paths: ["payments/webhook-handler.ts"] }),
      tool({ tool: "Grep", paths: ["payments/webhook-retry.ts"] }),
      sessionEnd(),
    ];
    const wf = segmentSignatures(events, whole(events), null).find((h) => h.lens === "workflow");
    expect(wf).toBeDefined();
    expect(wf?.keywords).toContain("webhook");
    expect(wf?.keywords).not.toContain("grep"); // the tool verb is de-noised out.
  });

  it("a bare tool+file with no topical words yields NO signature (de-noise drops it, 0.0.11 Candidate 3)", () => {
    // `Grep a.ts` is pure noise: the verb is de-noised and the basename is too short —
    // an empty keyword set must mint NO bucket rather than a degenerate `wing::` key.
    const events = [
      tool({ tool: "Grep", paths: ["payments/a.ts"] }),
      tool({ tool: "Grep", paths: ["payments/b.ts"] }),
      sessionEnd(),
    ];
    expect(segmentSignatures(events, whole(events), null).some((h) => h.lens === "workflow")).toBe(false);
  });

  it("lens ④ preference: a salient non-repeat tool_use fires preference", () => {
    const events = [tool({ tool: "Edit", paths: ["payments/config.ts"] }), sessionEnd()];
    const pref = segmentSignatures(events, whole(events), null).find((h) => h.lens === "preference");
    expect(pref).toBeDefined();
    expect(pref?.keywords).toContain("config");
  });

  it("dedupes by key within the segment (one hit per (wing+keywords))", () => {
    // Same correction text twice → one correction hit, not two.
    const events = [
      tool({ paths: ["payments/x.ts"] }),
      prompt("validate the webhook"),
      tool({ paths: ["payments/y.ts"] }),
      prompt("validate the webhook"),
      sessionEnd(),
    ];
    const corr = segmentSignatures(events, whole(events), null).filter((h) => h.lens === "correction");
    expect(corr.length).toBe(1);
  });

  it("every hit carries a stable key of `${wing}::${sortedKeywords}`", () => {
    const events = [tool({ paths: ["payments/x.ts"] }), prompt("retry idempotent webhook"), sessionEnd()];
    const corr = segmentSignatures(events, whole(events), null).find((h) => h.lens === "correction");
    expect(corr?.key).toBe(`payments::${(corr?.keywords ?? []).join(",")}`);
  });

  it("redacts a secret in the hint (no raw secret reaches the proposal)", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const events = [tool({ paths: ["payments/x.ts"] }), prompt(`use the aws key ${secret} please`), sessionEnd()];
    const corr = segmentSignatures(events, whole(events), null).find((h) => h.lens === "correction");
    expect(corr?.hint).not.toContain(secret);
    expect(corr?.hint).toContain("[REDACTED:");
  });

  it("redacts a secret in a path basename so it never enters key or keywords", () => {
    // A high-entropy token embedded in a file-path basename. The workflow lens keys
    // off path basenames, so without redaction the raw token would land in both the
    // signature `key` and `keywords` (which reach stdout + the stored promote.json),
    // even though the hint is redacted separately. See ADR-0015 §5 / reader.ts toolLine.
    const secret = "ghp0123456789abcdefghijklmnopqrstuv";
    const events = [
      tool({ tool: "Grep", paths: [`payments/${secret}-a.ts`] }),
      tool({ tool: "Grep", paths: [`payments/${secret}-b.ts`] }),
      sessionEnd(),
    ];
    const wf = segmentSignatures(events, whole(events), null).find((h) => h.lens === "workflow");
    expect(wf).toBeDefined();
    // The raw secret must NOT appear in the key or any keyword (not just the hint).
    expect(wf?.key).not.toContain(secret);
    expect(wf?.keywords.some((k) => k.includes(secret))).toBe(false);
    expect(wf?.hint).not.toContain(secret);
  });
});
