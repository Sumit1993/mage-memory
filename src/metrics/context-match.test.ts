import { describe, expect, it } from "vitest";
import {
  buildCompact,
  buildSessionEnd,
  buildSkillLoad,
  buildToolUse,
  buildUserPrompt,
  type EventBase,
} from "../observe/events.js";
import type { ObserveEvent, SkillMatch } from "../observe/types.js";
import {
  computeSessionMatches,
  loadMatches,
  MATCH_WINDOW,
} from "./context-match.js";

// ─── fixture helpers (inline ObserveEvent builders) ──────────────────────────

const SESSION = "sess-1";
let clock = 0;
/** Monotonic ISO timestamp so lexical-max(ts) is the last-emitted event. */
function nextTs(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 5, 7, 0, 0, clock)).toISOString();
}
function base(): EventBase {
  return { ts: nextTs(), session: SESSION };
}

const WING_MATCH: SkillMatch = {
  wing: "payments",
  keywords: ["webhook", "idempotency"],
  paths: [],
};

function load(match: SkillMatch | null): ReturnType<typeof buildSkillLoad> {
  return buildSkillLoad(base(), {
    skill: "mage-wing-payments",
    args: null,
    match,
    trigger_hash: match === null ? null : "deadbeef",
  });
}
function prompt(text: string): ReturnType<typeof buildUserPrompt> {
  return buildUserPrompt(base(), text);
}
function tool(paths: string[], detail: string | null = null): ReturnType<typeof buildToolUse> {
  return buildToolUse(base(), { tool: "Read", paths, detail, ok: true, error_summary: null });
}

// ─── loadMatches — the per-load predicate ────────────────────────────────────

describe("loadMatches — OR over 3 dimensions, recording which fired", () => {
  it("keywords dim fires on a forward user_prompt containing a match.keyword (word-boundary, case-fold)", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [prompt("Need to debug the WEBHOOK retry path")];
    const r = loadMatches(skillLoad, window, null);
    expect(r.matched).toBe(true);
    expect(r.dims).toContain("keywords");
  });

  it("keywords dim fires on a tool_use.detail containing a match.keyword", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [tool([], "grep -n idempotency src/")];
    const r = loadMatches(skillLoad, window, null);
    expect(r.matched).toBe(true);
    expect(r.dims).toContain("keywords");
  });

  it("keywords dim does NOT fire on a substring that is not a whole word (word-boundary)", () => {
    const skillLoad = load(WING_MATCH);
    // "webhooked" / "rewebhook" must not match the term "webhook".
    const window: ObserveEvent[] = [prompt("the rewebhooked subsystem")];
    const r = loadMatches(skillLoad, window, null);
    expect(r.dims).not.toContain("keywords");
  });

  it("wing dim fires on a touched path segment equal to match.wing (case-insensitive)", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [tool(["src/Payments/webhook.ts"])];
    const r = loadMatches(skillLoad, window, null);
    expect(r.matched).toBe(true);
    expect(r.dims).toContain("wing");
  });

  it("wing dim resolves an absolute path relative to repoRoot before segment-splitting", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [tool(["/home/u/repo/payments/foo.ts"])];
    const r = loadMatches(skillLoad, window, "/home/u/repo");
    expect(r.dims).toContain("wing");
  });

  it("wing dim does NOT fire on a partial segment (payments-archive is not the segment payments)", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [tool(["src/payments-archive/foo.ts"])];
    const r = loadMatches(skillLoad, window, null);
    expect(r.dims).not.toContain("wing");
  });

  it("a foreign skill (match === null) is never scored", () => {
    const skillLoad = load(null);
    const window: ObserveEvent[] = [prompt("webhook"), tool(["payments/x.ts"])];
    const r = loadMatches(skillLoad, window, null);
    expect(r.matched).toBe(false);
    expect(r.dims).toEqual([]);
  });

  it("no dimension fires → matched false, empty dims (paths dim is dormant in 0.0.6)", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [prompt("unrelated text"), tool(["src/billing/x.ts"])];
    const r = loadMatches(skillLoad, window, null);
    expect(r.matched).toBe(false);
    expect(r.dims).toEqual([]);
  });

  it("paths dim handles empty match.paths gracefully (no path glob in 0.0.6)", () => {
    const skillLoad = load(WING_MATCH);
    const window: ObserveEvent[] = [tool(["any/path.ts"])];
    const r = loadMatches(skillLoad, window, null);
    expect(r.dims).not.toContain("paths");
  });
});

// ─── computeSessionMatches — windowing + closed/open semantics ────────────────

describe("computeSessionMatches — forward window, closure, watermark prefix", () => {
  it("emits a CLOSED outcome when the window reaches MATCH_WINDOW counted events", () => {
    const events: ObserveEvent[] = [load(WING_MATCH)];
    for (let i = 0; i < MATCH_WINDOW; i++) events.push(prompt("filler"));
    const { outcomes, closedCount } = computeSessionMatches(events, null);
    expect(outcomes).toHaveLength(1);
    expect(closedCount).toBe(1);
    expect(outcomes[0]?.skill).toBe("mage-wing-payments");
  });

  it("closes a window on session_end and emits the outcome", () => {
    const skillLoad = load(WING_MATCH);
    const events: ObserveEvent[] = [skillLoad, prompt("webhook fired"), buildSessionEnd(base())];
    const { outcomes, closedCount } = computeSessionMatches(events, null);
    expect(closedCount).toBe(1);
    expect(outcomes[0]?.matched).toBe(true);
    expect(outcomes[0]?.dims).toContain("keywords");
  });

  it("closes a window on compact and emits the outcome", () => {
    const skillLoad = load(WING_MATCH);
    const events: ObserveEvent[] = [skillLoad, tool(["payments/a.ts"]), buildCompact(base(), "auto")];
    const { outcomes } = computeSessionMatches(events, null);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.dims).toContain("wing");
  });

  it("does NOT emit an OPEN trailing load (window never closed)", () => {
    // A load with only a couple of trailing events and no terminator stays open.
    const events: ObserveEvent[] = [load(WING_MATCH), prompt("webhook"), tool(["x.ts"])];
    const { outcomes, closedCount } = computeSessionMatches(events, null);
    expect(outcomes).toEqual([]);
    expect(closedCount).toBe(0);
  });

  it("a foreign skill_load (match === null) is never scored / never emitted", () => {
    const events: ObserveEvent[] = [load(null), buildSessionEnd(base())];
    const { outcomes, closedCount } = computeSessionMatches(events, null);
    expect(outcomes).toEqual([]);
    expect(closedCount).toBe(0);
  });

  it("records lastTs as the load.ts (not a later window event)", () => {
    const skillLoad = load(WING_MATCH);
    const trailing = buildSessionEnd(base());
    const { outcomes } = computeSessionMatches([skillLoad, trailing], null);
    expect(outcomes[0]?.lastTs).toBe(skillLoad.ts);
  });

  it("emits CLOSED loads in causal order and reports a stable growing prefix", () => {
    // Two loads, both closed by a single terminator at the end.
    const a = load(WING_MATCH);
    const b = buildSkillLoad(base(), {
      skill: "mage-wing-other",
      args: null,
      match: { wing: "other", keywords: ["alpha"], paths: [] },
      trigger_hash: "cafef00d",
    });
    const events: ObserveEvent[] = [a, prompt("alpha"), b, buildSessionEnd(base())];
    const { outcomes, closedCount } = computeSessionMatches(events, null);
    expect(closedCount).toBe(2);
    expect(outcomes.map((o) => o.skill)).toEqual(["mage-wing-payments", "mage-wing-other"]);
  });

  it("dims breakdown records exactly the firing dimension(s)", () => {
    const skillLoad = load(WING_MATCH);
    const events: ObserveEvent[] = [
      skillLoad,
      tool(["payments/x.ts"], "idempotency key"),
      buildSessionEnd(base()),
    ];
    const { outcomes } = computeSessionMatches(events, null);
    const dims = outcomes[0]?.dims ?? [];
    expect(dims).toContain("wing");
    expect(dims).toContain("keywords");
    expect(dims).not.toContain("paths");
  });
});
