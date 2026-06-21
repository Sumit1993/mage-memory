import { describe, expect, it } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildCompact,
  buildSessionEnd,
  buildSkillLoad,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import { computeDistillClusters, readDistill, SALIENCE_CAP } from "./reader.js";
import { writeWatermark, DISTILL_VERSION } from "./watermark.js";
import { tmpDir } from "../../test/fixtures/kb.js";

// ─── tmp fixture plumbing ─────────────────────────────────────────────────────

async function tmp(): Promise<string> {
  return tmpDir("mage-distill-reader-");
}

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
function tool(
  p: { paths?: string[]; detail?: string | null; ok?: boolean; error_summary?: string | null; tool?: string },
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
const compact = (): ObserveEvent => buildCompact(base(), "manual");
const sessionEnd = (): ObserveEvent => buildSessionEnd(base());

function toJsonl(events: ObserveEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ─── computeDistillClusters — the four lenses ─────────────────────────────────

describe("computeDistillClusters — the four ADR-0018 lenses", () => {
  it("lens ① prompts: collects every user_prompt.text in a closed segment", () => {
    const events = [prompt("first"), prompt("second"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.signals.prompts).toEqual(["first", "second"]);
    expect(r.clusters[0]?.signals.corrections).toEqual([]);
  });

  it("lens ① corrections: a prompt right after a tool_use is a correction (first-class)", () => {
    const events = [tool({ paths: ["a.ts"] }), prompt("no, do it this way"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.corrections).toEqual(["no, do it this way"]);
    // It is also a prompt — corrections is a tagged subset, not a removal.
    expect(r.clusters[0]?.signals.prompts).toEqual(["no, do it this way"]);
    expect(r.clusters[0]?.hint).toContain("user correction");
  });

  it("lens ①: a prompt NOT preceded by a tool_use is not a correction", () => {
    const events = [prompt("just asking"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.corrections).toEqual([]);
  });

  it("lens ①: a prompt after another prompt (human turn) is not a correction", () => {
    const events = [prompt("a"), prompt("b"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.corrections).toEqual([]);
  });

  it("lens ② failures: a failing tool_use contributes its error_summary", () => {
    const events = [tool({ ok: false, error_summary: "boom" }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.failures).toEqual(["boom"]);
    expect(r.clusters[0]?.hint).toContain("failure");
  });

  it("lens ②: a failing tool_use with null error_summary falls back to detail", () => {
    const events = [tool({ ok: false, error_summary: null, detail: "the cmd" }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.failures).toEqual(["the cmd"]);
  });

  it("lens ③/④ tools: a salient tool_use (detail) yields a tool: detail one-liner", () => {
    const events = [tool({ tool: "Bash", detail: "npm test" }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.tools).toEqual(["Bash: npm test"]);
  });

  it("lens ③/④ tools: a path-only salient tool joins its paths", () => {
    const events = [tool({ tool: "Read", paths: ["a.ts", "b.ts"] }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.signals.tools).toEqual(["Read: a.ts,b.ts"]);
  });

  it("SECURITY: redacts a credential embedded in an unscrubbed tool path", () => {
    // paths are structured ids that capture-time scrubbing deliberately skips
    // (ADR-0015 §4). A mounted path can carry creds (e.g. an SMB share). The reader
    // must not surface a secret-bearing path verbatim in the manifest, so the
    // assembled tool line is redacted.
    const events = [
      tool({ tool: "Read", paths: ["smb://user:s3cr3tP4ssw0rd@host/share/file.ts"] }),
      sessionEnd(),
    ];
    const r = computeDistillClusters(SESSION, events, 0, null);
    const line = r.clusters[0]?.signals.tools[0] ?? "";
    expect(line).toContain("[REDACTED:");
    expect(line).not.toContain("s3cr3tP4ssw0rd");
  });
});

// ─── the salience filter ──────────────────────────────────────────────────────

describe("computeDistillClusters — salience filter", () => {
  it("drops routine successful tool_use with no detail and no paths", () => {
    const events = [tool({ tool: "Bash", detail: null, paths: [], ok: true }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    // No salient signal anywhere → the segment produces NO cluster.
    expect(r.clusters).toHaveLength(0);
    expect(r.closedOffset).toBe(2); // still advanced past the closed region.
  });

  it("a segment with only skill_load/session_start noise yields no cluster", () => {
    const events = [skillLoad(), compact()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(0);
  });

  it("a trailing non-salient segment still advances closedOffset to closedCount (not the last salient end)", () => {
    // seg1 salient (prompt), seg2 non-salient (routine tool). Not capped → the
    // suggested offset must cover the whole closed region so seg2 isn't re-offered.
    const events = [
      prompt("a"),
      compact(),
      tool({ tool: "Bash", detail: null, paths: [], ok: true }),
      sessionEnd(),
    ];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(1);
    expect(r.closedOffset).toBe(events.length); // closedCount, past the trailing noise.
    expect(r.capped).toBe(false);
  });
});

// ─── closed/open segmentation ─────────────────────────────────────────────────

describe("computeDistillClusters — closed/open segmentation", () => {
  it("no terminator → no closed region → no clusters, closedOffset 0", () => {
    const events = [prompt("hi"), tool({ detail: "x" })];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(0);
    expect(r.closedOffset).toBe(0);
  });

  it("trailing events after the LAST terminator are OPEN (excluded)", () => {
    // closed = [prompt, compact]; OPEN tail = [prompt("open")].
    const events = [prompt("closed"), compact(), prompt("open")];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.signals.prompts).toEqual(["closed"]);
    expect(r.closedOffset).toBe(2); // just past the compact, not the open prompt.
  });

  it("two terminators → two segments → two clusters with correct spans", () => {
    const events = [prompt("a"), compact(), prompt("b"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(2);
    expect(r.clusters[0]?.span).toBe("L1-L2"); // events[0..2) → L1-L2.
    expect(r.clusters[1]?.span).toBe("L3-L4"); // events[2..4) → L3-L4.
    expect(r.closedOffset).toBe(4);
  });
});

// ─── priorOffset skipping ─────────────────────────────────────────────────────

describe("computeDistillClusters — priorOffset skips dispositioned events", () => {
  it("skips the already-seen first segment, offers only the new one", () => {
    const events = [prompt("old"), compact(), prompt("new"), sessionEnd()];
    // priorOffset = 2 → the first segment [0,2) was already dispositioned.
    const r = computeDistillClusters(SESSION, events, 2, null);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.signals.prompts).toEqual(["new"]);
    expect(r.closedOffset).toBe(4);
  });

  it("priorOffset >= closedCount → no new clusters; offset does not regress", () => {
    const events = [prompt("a"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 2, null);
    expect(r.clusters).toHaveLength(0);
    expect(r.closedOffset).toBe(2);
  });

  it("a priorOffset already past everything closed stays put", () => {
    const events = [prompt("a"), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 5, null);
    expect(r.closedOffset).toBe(5);
  });
});

// ─── the cap + spill (ADR-0018 §5) ────────────────────────────────────────────

describe("computeDistillClusters — salience cap + spill", () => {
  /** A segment of `n` salient prompts then a compact (n prompts = n signals). */
  function segmentOf(n: number): ObserveEvent[] {
    const out: ObserveEvent[] = [];
    for (let i = 0; i < n; i++) out.push(prompt(`p${i}`));
    out.push(compact());
    return out;
  }

  it("does not cap when total salient signals fit under SALIENCE_CAP", () => {
    const events = [...segmentOf(10), ...segmentOf(10)]; // 20 <= 40.
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.capped).toBe(false);
    expect(r.clusters).toHaveLength(2);
    expect(r.closedOffset).toBe(events.length);
  });

  it("does NOT cap at exactly SALIENCE_CAP (the check is strict >): 20+20=40 both emitted", () => {
    const events = [...segmentOf(20), ...segmentOf(20)]; // 40 === SALIENCE_CAP.
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.capped).toBe(false);
    expect(r.clusters).toHaveLength(2);
    expect(r.closedOffset).toBe(events.length);
  });

  it("caps one over the boundary: 20+21=41 > 40 → spills the second segment", () => {
    const seg1 = segmentOf(20);
    const r = computeDistillClusters(SESSION, [...seg1, ...segmentOf(21)], 0, null);
    expect(r.capped).toBe(true);
    expect(r.clusters).toHaveLength(1);
    expect(r.closedOffset).toBe(seg1.length);
  });

  it("caps + spills: stops before the segment that would overflow, offset at last included", () => {
    // seg1 = 30 signals (cluster), seg2 = 30 signals (30+30 > 40 → spill seg2).
    const seg1 = segmentOf(30);
    const events = [...seg1, ...segmentOf(30)];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.capped).toBe(true);
    expect(r.clusters).toHaveLength(1); // only seg1 emitted.
    // closedOffset stops at the END of the last INCLUDED segment (seg1), so seg2
    // stays past the watermark and is re-offered next run.
    expect(r.closedOffset).toBe(seg1.length);
  });

  it("never caps to an empty batch: a lone oversized first segment is still emitted", () => {
    const events = segmentOf(SALIENCE_CAP + 50); // way over cap, but it's the first.
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters).toHaveLength(1); // emitted anyway — no cluster yet when we checked.
    expect(r.capped).toBe(false);
    expect(r.closedOffset).toBe(events.length);
  });
});

// ─── the hint (deterministic note-type nudge) ─────────────────────────────────

describe("computeDistillClusters — deterministic hint", () => {
  it("repeated tool name (>=2) hints a playbook", () => {
    const events = [tool({ tool: "Bash", detail: "a" }), tool({ tool: "Bash", detail: "b" }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.hint).toContain("repeated workflow");
  });

  it("falls back to 'tool activity' when only single salient tools are present", () => {
    const events = [tool({ tool: "Read", paths: ["a.ts"] }), sessionEnd()];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.hint).toBe("tool activity");
  });

  it("combines lenses: correction + failure both surface in the hint", () => {
    const events = [
      tool({ paths: ["a.ts"] }),
      prompt("no use the other one"),
      tool({ ok: false, error_summary: "nope" }),
      sessionEnd(),
    ];
    const r = computeDistillClusters(SESSION, events, 0, null);
    expect(r.clusters[0]?.hint).toContain("user correction");
    expect(r.clusters[0]?.hint).toContain("failure");
  });
});

// ─── readDistill — the fs orchestrator (READ-ONLY) ────────────────────────────

describe("readDistill — lists streams, reads watermark, never writes", () => {
  async function seedLearnings(dir: string): Promise<string> {
    const learnings = join(dir, ".learnings");
    await mkdir(learnings, { recursive: true });
    return learnings;
  }

  it("returns an empty manifest when there is no .learnings dir", async () => {
    const dir = await tmp();
    const m = await readDistill(dir, join(dir, ".learnings"), null);
    expect(m).toEqual({ clusters: [], cursors: {}, capped: false });
  });

  it("reads clusters from a session stream and suggests the closed offset", async () => {
    const dir = await tmp();
    const learnings = await seedLearnings(dir);
    const events = [prompt("hello"), tool({ detail: "x" }), sessionEnd()];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");

    const m = await readDistill(dir, learnings, null);
    expect(m.clusters).toHaveLength(1);
    expect(m.clusters[0]?.session).toBe(SESSION);
    expect(m.cursors[SESSION]).toBe(3); // suggested watermark = closedCount.
    expect(m.capped).toBe(false);
  });

  it("honors the prior watermark: a passed segment is not re-offered", async () => {
    const dir = await tmp();
    const learnings = await seedLearnings(dir);
    const events = [prompt("old"), compact(), prompt("new"), sessionEnd()];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");
    // Watermark already past the first segment.
    await writeWatermark(dir, { v: DISTILL_VERSION, cursors: { [SESSION]: 2 } });

    const m = await readDistill(dir, learnings, null);
    expect(m.clusters).toHaveLength(1);
    expect(m.clusters[0]?.signals.prompts).toEqual(["new"]);
  });

  it("excludes *.skills.jsonl sidecars and the .archive dir", async () => {
    const dir = await tmp();
    const learnings = await seedLearnings(dir);
    await mkdir(join(learnings, ".archive"), { recursive: true });

    const events = [prompt("real"), sessionEnd()];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");
    await writeFile(join(learnings, `${SESSION}.skills.jsonl`), toJsonl([skillLoad(), sessionEnd()]), "utf8");
    await writeFile(join(learnings, ".archive", "old.jsonl"), toJsonl([prompt("archived"), sessionEnd()]), "utf8");

    const m = await readDistill(dir, learnings, null);
    expect(m.clusters).toHaveLength(1);
    expect(m.clusters[0]?.signals.prompts).toEqual(["real"]);
    expect(Object.keys(m.cursors)).toEqual([SESSION]); // sidecar key absent.
  });

  it("skips a torn file (fail-open) — a bad stream yields no clusters, not a throw", async () => {
    const dir = await tmp();
    const learnings = await seedLearnings(dir);
    const good = [prompt("ok"), sessionEnd()];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(good), "utf8");
    await writeFile(join(learnings, "torn.jsonl"), "{ not json\nalso bad\n", "utf8");

    const m = await readDistill(dir, learnings, null);
    // The good session contributes; the torn file just yields zero events.
    expect(m.clusters).toHaveLength(1);
    expect(m.cursors["torn"]).toBe(0);
  });

  it("does NOT write the watermark (read-only): no distill.json is created", async () => {
    const dir = await tmp();
    const learnings = await seedLearnings(dir);
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl([prompt("x"), sessionEnd()]), "utf8");

    await readDistill(dir, learnings, null);
    // The watermark must not have been created by a pure read.
    const present = await access(join(dir, ".metrics", "distill.json")).then(
      () => true,
      () => false,
    );
    expect(present).toBe(false);
  });
});
