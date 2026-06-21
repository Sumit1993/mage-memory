import { describe, expect, it } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_DIR, LEARNINGS_DIR, METRICS_DIR } from "../paths.js";
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
  foldRollup,
  readRollup,
  rollupPath,
  summarize,
  writeRollup,
  ROLLUP_VERSION,
  type Rollup,
} from "./rollup.js";
import { tmpDir } from "../../test/fixtures/kb.js";

// ─── ObserveEvent builders (monotonic clock → lexical-max(ts) is last) ────────

const SESSION = "sess-1";
let clock = 0;
function nextTs(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 5, 7, 0, 0, clock)).toISOString();
}
function base(session = SESSION): EventBase {
  return { ts: nextTs(), session };
}

const WING_MATCH: SkillMatch = {
  wing: "payments",
  keywords: ["webhook", "idempotency"],
  paths: [],
};

function load(match: SkillMatch | null, session = SESSION): ReturnType<typeof buildSkillLoad> {
  return buildSkillLoad(base(session), {
    skill: "mage-wing-payments",
    args: null,
    match,
    trigger_hash: match === null ? null : "deadbeef",
  });
}
function prompt(text: string, session = SESSION): ReturnType<typeof buildUserPrompt> {
  return buildUserPrompt(base(session), text);
}
function tool(
  paths: string[],
  detail: string | null = null,
  session = SESSION,
): ReturnType<typeof buildToolUse> {
  return buildToolUse(base(session), { tool: "Read", paths, detail, ok: true, error_summary: null });
}

/** Serialize events to a `.jsonl` body (one JSON object per line, trailing NL). */
function toJsonl(events: ObserveEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

// ─── readRollup — fresh empty on missing/corrupt (fail-open) ──────────────────

describe("readRollup — fresh empty rollup on missing/corrupt", () => {
  it("returns a fresh empty rollup when no file exists", async () => {
    const dir = await tmpDir("mage-rollup-");
    const r = await readRollup(dir);
    expect(r).toEqual({ v: ROLLUP_VERSION, skills: {}, watermarks: {} });
  });

  it("returns a fresh empty rollup when the file is corrupt JSON (fail-open)", async () => {
    const dir = await tmpDir("mage-rollup-");
    await mkdir(join(dir, STATE_DIR, METRICS_DIR), { recursive: true });
    await writeFile(rollupPath(dir), "{ not json", "utf8");
    const r = await readRollup(dir);
    expect(r).toEqual({ v: ROLLUP_VERSION, skills: {}, watermarks: {} });
  });

  it("round-trips a written rollup", async () => {
    const dir = await tmpDir("mage-rollup-");
    const r: Rollup = {
      v: ROLLUP_VERSION,
      skills: {
        "x::null": { loads: 2, matches: 1, dims: { paths: 0, keywords: 1, wing: 0 }, last_seen: "t" },
      },
      watermarks: { "sess-x": 2 },
    };
    await writeRollup(dir, r);
    expect(await readRollup(dir)).toEqual(r);
  });
});

// ─── foldRollup — one session, loads/matches/dims ─────────────────────────────

describe("foldRollup — folds closed loads into per-skill stats", () => {
  it("folds one session of skill_load + tool_use into correct loads/matches/dims", async () => {
    const dir = await tmpDir("mage-rollup-");
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });

    const skillLoad = load(WING_MATCH);
    const events: ObserveEvent[] = [
      skillLoad,
      tool(["payments/webhook.ts"], "idempotency key"),
      buildSessionEnd(base()),
    ];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");

    const rollup = await foldRollup(dir, learnings, null);

    const k = "mage-wing-payments::deadbeef";
    expect(rollup.skills[k]).toBeDefined();
    expect(rollup.skills[k]?.loads).toBe(1);
    expect(rollup.skills[k]?.matches).toBe(1);
    expect(rollup.skills[k]?.dims.wing).toBe(1);
    expect(rollup.skills[k]?.dims.keywords).toBe(1);
    expect(rollup.skills[k]?.dims.paths).toBe(0);
    expect(rollup.skills[k]?.last_seen).toBe(skillLoad.ts);
    expect(rollup.watermarks[SESSION]).toBe(1);
  });

  it("a second fold of the SAME unchanged file adds nothing (watermark idempotency)", async () => {
    const dir = await tmpDir("mage-rollup-");
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });

    const events: ObserveEvent[] = [load(WING_MATCH), prompt("webhook"), buildSessionEnd(base())];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");

    const first = await foldRollup(dir, learnings, null);
    await writeRollup(dir, first);
    const second = await foldRollup(dir, learnings, null);

    expect(second).toEqual(first);
    expect(second.skills["mage-wing-payments::deadbeef"]?.loads).toBe(1);
  });

  it("appending more events then re-folding only adds the newly-closed loads", async () => {
    const dir = await tmpDir("mage-rollup-");
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });
    const file = join(learnings, `${SESSION}.jsonl`);

    // First turn: one closed load (closed by a compact terminator).
    const turn1: ObserveEvent[] = [load(WING_MATCH), prompt("webhook"), buildCompact(base(), "manual")];
    await writeFile(file, toJsonl(turn1), "utf8");
    const r1 = await foldRollup(dir, learnings, null);
    await writeRollup(dir, r1);
    expect(r1.skills["mage-wing-payments::deadbeef"]?.loads).toBe(1);
    expect(r1.watermarks[SESSION]).toBe(1);

    // Second turn: append a new closed load. Re-fold should add exactly one.
    const turn2: ObserveEvent[] = [load(WING_MATCH), tool(["payments/x.ts"]), buildSessionEnd(base())];
    await writeFile(file, toJsonl([...turn1, ...turn2]), "utf8");
    const r2 = await foldRollup(dir, learnings, null);

    expect(r2.skills["mage-wing-payments::deadbeef"]?.loads).toBe(2);
    expect(r2.watermarks[SESSION]).toBe(2);
  });

  it("ignores *.skills.jsonl sidecars and the .archive dir", async () => {
    const dir = await tmpDir("mage-rollup-");
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(join(learnings, ".archive"), { recursive: true });

    const events: ObserveEvent[] = [load(WING_MATCH), prompt("webhook"), buildSessionEnd(base())];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");

    // Sidecar: a skill_load-only stream — must NOT be folded (no full context).
    await writeFile(
      join(learnings, `${SESSION}.skills.jsonl`),
      toJsonl([load(WING_MATCH), load(WING_MATCH), buildSessionEnd(base())]),
      "utf8",
    );
    // Archived full stream — must be skipped (it lives in the .archive subdir).
    await writeFile(
      join(learnings, ".archive", `${SESSION}-old.jsonl`),
      toJsonl([load(WING_MATCH), prompt("webhook"), buildSessionEnd(base())]),
      "utf8",
    );

    const rollup = await foldRollup(dir, learnings, null);

    // Only the single full-stream session contributes; the sidecar/archive don't.
    expect(rollup.skills["mage-wing-payments::deadbeef"]?.loads).toBe(1);
    // The sidecar's basename `<session>.skills` must NOT appear as a watermark key.
    expect(rollup.watermarks[`${SESSION}.skills`]).toBeUndefined();
    expect(Object.keys(rollup.watermarks)).toEqual([SESSION]);
  });

  it("skips unparseable lines and returns a fresh rollup on an empty learnings dir", async () => {
    const dir = await tmpDir("mage-rollup-");
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });

    const events: ObserveEvent[] = [load(WING_MATCH), prompt("webhook"), buildSessionEnd(base())];
    const body = "{ garbage\n" + toJsonl(events) + "also not json\n";
    await writeFile(join(learnings, `${SESSION}.jsonl`), body, "utf8");

    const rollup = await foldRollup(dir, learnings, null);
    expect(rollup.skills["mage-wing-payments::deadbeef"]?.loads).toBe(1);
  });
});

// ─── writeRollup — JSON shape ─────────────────────────────────────────────────

describe("writeRollup — JSON shape + trailing newline", () => {
  it("writes pretty JSON with a trailing newline and the locked shape", async () => {
    const dir = await tmpDir("mage-rollup-");
    const learnings = join(dir, STATE_DIR, LEARNINGS_DIR);
    await mkdir(learnings, { recursive: true });
    const events: ObserveEvent[] = [load(WING_MATCH), prompt("webhook"), buildSessionEnd(base())];
    await writeFile(join(learnings, `${SESSION}.jsonl`), toJsonl(events), "utf8");

    const rollup = await foldRollup(dir, learnings, null);
    await writeRollup(dir, rollup);

    const raw = await readFile(rollupPath(dir), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw) as Rollup;
    expect(parsed.v).toBe(ROLLUP_VERSION);
    expect(typeof parsed.skills).toBe("object");
    expect(typeof parsed.watermarks).toBe("object");
    const stat = parsed.skills["mage-wing-payments::deadbeef"];
    expect(stat).toBeDefined();
    expect(Object.keys(stat?.dims ?? {}).sort()).toEqual(["keywords", "paths", "wing"]);
  });
});

// ─── summarize — status ladder against the thresholds ─────────────────────────

describe("summarize — ok / reword-suggested / demote-suggested per thresholds", () => {
  function rollupWith(loads: number, matches: number): Rollup {
    return {
      v: ROLLUP_VERSION,
      skills: {
        "s::h": { loads, matches, dims: { paths: 0, keywords: matches, wing: 0 }, last_seen: "t" },
      },
      watermarks: {},
    };
  }

  it("ok when loads below MIN_LOADS_FOR_SUGGESTION regardless of rate", () => {
    const rows = summarize(rollupWith(4, 0)); // 4 < 5 → not enough data
    expect(rows[0]?.status).toBe("ok");
    expect(rows[0]?.matchRate).toBe(0);
  });

  it("demote-suggested when rate < DEMOTE_MATCH_RATE (0.2)", () => {
    const rows = summarize(rollupWith(10, 1)); // 0.1 < 0.2
    expect(rows[0]?.status).toBe("demote-suggested");
  });

  it("reword-suggested when DEMOTE_MATCH_RATE <= rate < LOW_MATCH_RATE (0.4)", () => {
    const rows = summarize(rollupWith(10, 3)); // 0.3 in [0.2, 0.4)
    expect(rows[0]?.status).toBe("reword-suggested");
  });

  it("ok when rate >= LOW_MATCH_RATE (0.4)", () => {
    const rows = summarize(rollupWith(10, 8)); // 0.8 >= 0.4
    expect(rows[0]?.status).toBe("ok");
  });

  it("matchRate is 0 for zero loads and carries the dims through", () => {
    const empty: Rollup = { v: ROLLUP_VERSION, skills: {}, watermarks: {} };
    expect(summarize(empty)).toEqual([]);
  });

  it("sorts worst-first (matchRate asc, then loads desc) and splits the key", () => {
    const r: Rollup = {
      v: ROLLUP_VERSION,
      skills: {
        "good::h1": { loads: 10, matches: 9, dims: { paths: 0, keywords: 9, wing: 0 }, last_seen: "t" },
        "bad::h2": { loads: 10, matches: 1, dims: { paths: 0, keywords: 1, wing: 0 }, last_seen: "t" },
        "bad-more::h3": { loads: 20, matches: 2, dims: { paths: 0, keywords: 2, wing: 0 }, last_seen: "t" },
      },
      watermarks: {},
    };
    const rows = summarize(r);
    // worst rate first; ties broken by loads desc.
    expect(rows[0]?.matchRate).toBeCloseTo(0.1);
    expect(rows[0]?.loads).toBe(20); // 20-load 0.1 before 10-load 0.1
    expect(rows[1]?.loads).toBe(10);
    expect(rows[2]?.matchRate).toBeCloseTo(0.9);
    // key splitting: skill + trigger_hash recovered from "skill::hash".
    expect(rows[0]?.skill).toBe("bad-more");
    expect(rows[0]?.trigger_hash).toBe("h3");
  });

  it("recovers a null trigger_hash from the 'null' key sentinel", () => {
    const r: Rollup = {
      v: ROLLUP_VERSION,
      skills: {
        "foreignish::null": { loads: 5, matches: 0, dims: { paths: 0, keywords: 0, wing: 0 }, last_seen: "t" },
      },
      watermarks: {},
    };
    const rows = summarize(r);
    expect(rows[0]?.trigger_hash).toBeNull();
  });
});
