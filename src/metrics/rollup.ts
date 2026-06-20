// Rollup fold (ADR-0016 §1). The persistent, append-only accumulation of the
// read-only context-match metric. `foldRollup` reads each per-session
// `.learnings/*.jsonl` full stream, scores its CLOSED skill_loads via
// `computeSessionMatches`, and folds the newly-closed prefix (everything past the
// session watermark) into per-skill stats. The watermark is a stable growing
// prefix — re-folding an unchanged file is a no-op — so the fold is idempotent.
//
// Thresholds + dimensions are imported from ./context-match.js. They are
// PROVISIONAL for 0.0.6's read-only metrics; the FINAL thresholds land in 0.0.8
// (per the build brief). The `status` labels here are ADVISORY only — 0.0.6
// flags, it never acts (acting is 0.0.8).

import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  computeSessionMatches,
  DEMOTE_MATCH_RATE,
  LOW_MATCH_RATE,
  MIN_LOADS_FOR_SUGGESTION,
  type MatchDimension,
} from "./context-match.js";
import { metricsPath } from "../paths.js";
import type { ObserveEvent } from "../observe/types.js";

// ─── consts ────────────────────────────────────────────────────────────────────

/** Bump when the on-disk rollup shape changes (a fresh empty rollup re-stamps). */
export const ROLLUP_VERSION = 1;
/**
 * The git-ignored metrics leaf, sibling of `.mage/learnings/` (re-exported from
 * paths.ts so the boundary has a single home; index.ts re-exports it as
 * ROLLUP_METRICS_DIR). Prefer {@link metricsPath} over re-joining it.
 */
export { METRICS_DIR } from "../paths.js";
/** The single rollup file the read-only context-match metric lives in. */
export const ROLLUP_FILE = "context-match.json";

/** The per-stat key: a skill is keyed by skill name + its trigger_hash. */
function key(skill: string, trigger_hash: string | null): string {
  return skill + "::" + (trigger_hash ?? "null");
}

/** Recover (skill, trigger_hash) from a stat key. The "null" sentinel → null. */
function splitKey(k: string): { skill: string; trigger_hash: string | null } {
  const idx = k.indexOf("::");
  const skill = idx < 0 ? k : k.slice(0, idx);
  const rest = idx < 0 ? "null" : k.slice(idx + 2);
  return { skill, trigger_hash: rest === "null" ? null : rest };
}

// ─── types ─────────────────────────────────────────────────────────────────────

/** Per-skill accumulation. `dims` carries all three keys (fully-keyed Record). */
export interface SkillStat {
  loads: number;
  matches: number;
  dims: Record<MatchDimension, number>;
  /** Lexical-max of folded load.ts — the most recent observation. */
  last_seen: string;
}

/** The persisted rollup: per-skill stats + per-session watermarks. */
export interface Rollup {
  v: number;
  skills: Record<string, SkillStat>;
  watermarks: Record<string, number>;
}

/** A fresh, empty rollup at the current version. */
function emptyRollup(): Rollup {
  return { v: ROLLUP_VERSION, skills: {}, watermarks: {} };
}

// ─── paths ─────────────────────────────────────────────────────────────────────

/** The on-disk rollup file path under a docs root. */
export function rollupPath(docsRoot: string): string {
  return join(metricsPath(docsRoot), ROLLUP_FILE);
}

// ─── readRollup — fail-open on missing/corrupt ──────────────────────────────────

/**
 * Read the persisted rollup. Missing file (ENOENT) or corrupt JSON → a fresh
 * empty rollup. This is the Stop-hook fold path: it must never throw to the host.
 */
export async function readRollup(docsRoot: string): Promise<Rollup> {
  let raw: string;
  try {
    raw = await readFile(rollupPath(docsRoot), "utf8");
  } catch {
    return emptyRollup(); // missing (ENOENT) or unreadable → fresh.
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRollup(parsed);
  } catch {
    return emptyRollup(); // corrupt JSON → fail-open to fresh.
  }
}

/** Coerce a parsed value into a well-shaped Rollup, defaulting absent fields. */
function normalizeRollup(parsed: unknown): Rollup {
  if (parsed === null || typeof parsed !== "object") return emptyRollup();
  const p = parsed as Partial<Rollup>;
  return {
    v: typeof p.v === "number" ? p.v : ROLLUP_VERSION,
    skills: isRecord(p.skills) ? (p.skills as Record<string, SkillStat>) : {},
    watermarks: isRecord(p.watermarks) ? (p.watermarks as Record<string, number>) : {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ─── foldRollup — the idempotent accumulation ───────────────────────────────────

/**
 * Fold every newly-closed load across the per-session `.learnings/*.jsonl` full
 * streams into the rollup. Reads the current rollup, lists the full streams
 * (excluding `*.skills.jsonl` sidecars and the `.archive` subdir), scores each
 * session, and folds only the outcomes past that session's watermark. Returns a
 * NEW rollup (inputs are never mutated).
 *
 * KNOWN LIMITATION (0.0.6): a mid-session 10MB rotation resets the live file
 * while the session-keyed watermark persists, so a few post-rotation loads may be
 * skipped. Acceptable for read-only advisory metrics — not fixed here.
 */
export async function foldRollup(
  docsRoot: string,
  learningsDir: string,
  repoRoot: string | null,
): Promise<Rollup> {
  const prev = await readRollup(docsRoot);
  const skills: Record<string, SkillStat> = { ...prev.skills };
  const watermarks: Record<string, number> = { ...prev.watermarks };

  const files = await listSessionStreams(learningsDir);
  for (const file of files) {
    const events = await parseStream(join(learningsDir, file));
    const { outcomes, closedCount } = computeSessionMatches(events, repoRoot);
    const session = basename(file, ".jsonl");
    const wm = watermarks[session] ?? 0;
    for (const o of outcomes.slice(wm)) {
      const k = key(o.skill, o.trigger_hash);
      foldOutcomeInto(skills, k, o);
    }
    // Never let the watermark regress: a shrunk file (the rotation edge) must not
    // re-fold already-counted outcomes on the next pass.
    watermarks[session] = Math.max(wm, closedCount);
  }

  return { v: ROLLUP_VERSION, skills, watermarks };
}

/**
 * The full per-session streams to fold: top-level `*.jsonl` files, EXCLUDING the
 * `*.skills.jsonl` sidecars (the skills-first endswith check matters — a sidecar's
 * basename would otherwise corrupt the session key) and the `.archive` subdir
 * (only files, not dirs, are read).
 */
async function listSessionStreams(learningsDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(learningsDir, { withFileTypes: true });
  } catch {
    return []; // no `.learnings/` dir yet → nothing to fold.
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue; // skips the `.archive` subdir.
    const name = ent.name;
    if (name.endsWith(".skills.jsonl")) continue; // sidecar — ordered FIRST.
    if (!name.endsWith(".jsonl")) continue;
    out.push(name);
  }
  return out;
}

/** Parse a `.jsonl` stream into events; unparseable lines are skipped (fail-open). */
async function parseStream(path: string): Promise<ObserveEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const events: ObserveEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(JSON.parse(trimmed) as ObserveEvent);
    } catch {
      // Skip a torn/garbage line — a partial last write must not abort the fold.
    }
  }
  return events;
}

/** Accumulate one closed outcome into the per-skill stat (immutable replace). */
function foldOutcomeInto(
  skills: Record<string, SkillStat>,
  k: string,
  o: { matched: boolean; dims: MatchDimension[]; lastTs: string },
): void {
  const cur = skills[k] ?? freshStat();
  const dims: Record<MatchDimension, number> = { ...cur.dims };
  for (const d of o.dims) dims[d] += 1;
  skills[k] = {
    loads: cur.loads + 1,
    matches: cur.matches + (o.matched ? 1 : 0),
    dims,
    last_seen: o.lastTs > cur.last_seen ? o.lastTs : cur.last_seen,
  };
}

/** A zeroed stat with all three dim keys present (fully-keyed Record). */
function freshStat(): SkillStat {
  return { loads: 0, matches: 0, dims: { paths: 0, keywords: 0, wing: 0 }, last_seen: "" };
}

// ─── writeRollup ─────────────────────────────────────────────────────────────

/** Persist the rollup (creating `.mage/metrics/`), pretty-printed with trailing NL. */
export async function writeRollup(docsRoot: string, rollup: Rollup): Promise<void> {
  await mkdir(metricsPath(docsRoot), { recursive: true });
  await writeFile(rollupPath(docsRoot), JSON.stringify(rollup, null, 2) + "\n", "utf8");
}

// ─── summarize — advisory status ladder ────────────────────────────────────────

/** One advisory row per skill (worst-first). Labels never act in 0.0.6. */
export interface SkillMetricRow {
  skill: string;
  trigger_hash: string | null;
  loads: number;
  matchRate: number;
  status: "ok" | "reword-suggested" | "demote-suggested";
  dims: Record<MatchDimension, number>;
}

/**
 * Project the rollup into advisory rows. status is ADVISORY only (0.0.6 flags,
 * never acts — acting is 0.0.8). Rows sort worst-first: matchRate ascending, then
 * loads descending (a low rate on many loads is the strongest signal).
 */
export function summarize(rollup: Rollup): SkillMetricRow[] {
  const rows: SkillMetricRow[] = [];
  for (const [k, stat] of Object.entries(rollup.skills)) {
    const matchRate = stat.loads ? stat.matches / stat.loads : 0;
    const { skill, trigger_hash } = splitKey(k);
    rows.push({
      skill,
      trigger_hash,
      loads: stat.loads,
      matchRate,
      status: statusFor(stat.loads, matchRate),
      dims: { ...stat.dims },
    });
  }
  return rows.sort((a, b) => a.matchRate - b.matchRate || b.loads - a.loads);
}

/** Map (loads, rate) to an advisory status against the provisional thresholds. */
function statusFor(loads: number, rate: number): SkillMetricRow["status"] {
  if (loads < MIN_LOADS_FOR_SUGGESTION) return "ok"; // not enough data to advise.
  if (rate < DEMOTE_MATCH_RATE) return "demote-suggested";
  if (rate < LOW_MATCH_RATE) return "reword-suggested";
  return "ok";
}
