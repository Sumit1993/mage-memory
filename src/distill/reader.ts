// The distill reader (ADR-0018 §3–§5). Deterministic — NO model, NO judgment.
// It reads mage's OWN `.learnings/*.jsonl` (ADR-0015 schema), groups the
// un-distilled CLOSED events into candidate clusters, attaches salient signals
// across the four ADR-0018 §4 lenses, and emits a manifest the `mage:groom`
// skill reasons over. The semantic clustering (split/merge) is the SKILL's job;
// this chops mechanically at compact/session boundaries (the natural chapters,
// already the closed-window unit the metrics fold uses).
//
// CLOSED-only mirrors context-match.ts: only events up to the last
// compact/session_end terminator are eligible — the in-flight tail is never
// half-distilled. The fs orchestrator is READ-ONLY: it suggests a watermark but
// NEVER writes it (only `mage distill --seen` commits, after human disposition).
// A bad file is skipped (fail-open) — a torn `.learnings/` must not abort a run.

import { basename, join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { type ObserveEvent, isTerminator } from "../observe/types.js";
import { redact } from "../redact.js";
import { readWatermark } from "./watermark.js";
import type { DistillCluster, DistillManifest } from "./types.js";

// ─── consts ────────────────────────────────────────────────────────────────────

/**
 * Max salient signals a single session's clusters may carry before the reader
 * caps and spills the remainder to the next run (ADR-0018 §5 — bound a giant
 * chapter, never silently truncate). Counted across all four lenses.
 */
export const SALIENCE_CAP = 40;

// ─── segmentation helpers ────────────────────────────────────────────────────

/**
 * The CLOSED prefix length: the index just past the LAST terminator, or 0 if the
 * stream has none (a wholly in-flight session is never distilled). Everything at
 * `events[closedCount..]` is OPEN and deferred to a later run.
 */
function closedCountOf(events: ObserveEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) return i + 1;
  }
  return 0;
}

/** One mechanical chapter: a run of events `[start, end)` ending at a terminator. */
interface Segment {
  start: number;
  end: number;
}

/**
 * Chop `events[from, upto)` into segments at terminator boundaries. Each segment
 * runs up to AND INCLUDING its terminator. Because `upto` is `closedCount` (just
 * past the final terminator), the region divides evenly — there is no trailing
 * unterminated remainder inside the closed region.
 */
function segmentClosed(events: ObserveEvent[], from: number, upto: number): Segment[] {
  const segments: Segment[] = [];
  let start = from;
  for (let i = from; i < upto; i++) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) {
      segments.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  return segments;
}

// ─── per-segment signal extraction (the four lenses) ─────────────────────────

/** The salient signals + their total count for one segment. */
interface SegmentSignals {
  signals: DistillCluster["signals"];
  /** Total salient signals across the four lenses (drives the cap budget). */
  count: number;
}

/**
 * Extract the four ADR-0018 §4 lenses from one segment's events. The terminator
 * at the segment's tail is structural, never a signal. A `user_prompt` is a
 * CORRECTION (lens ①, first-class) when the nearest preceding NON-TERMINATOR event
 * in the segment is a `tool_use` — the "agent acted → human reacted" *adjacency*.
 * `skill_load`/`session_start` are non-terminator events too, so a prompt right
 * after one of them is NOT a correction (the agent did not just act); and a prompt
 * after another prompt is a continuation, not a fresh reaction. A `tool_use` is
 * SALIENT (lenses ③/④) when it failed, carries a non-empty detail, or touched
 * paths; a routine successful no-detail/no-path tool_use is dropped.
 */
function extractSegment(events: ObserveEvent[], seg: Segment): SegmentSignals {
  const prompts: string[] = [];
  const corrections: string[] = [];
  const failures: string[] = [];
  const tools: string[] = [];

  // The type of the immediately-preceding non-terminator event — the adjacency the
  // correction lens keys on. Updated by EVERY non-terminator (prompt, tool_use,
  // skill_load, session_start), so "nearest preceding" is literal, not "most recent
  // tool_use ever". Terminators only close a segment and never update it.
  let prevType: ObserveEvent["type"] | null = null;

  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e === undefined) continue;

    if (e.type === "user_prompt") {
      prompts.push(e.text);
      // Lens ① (first-class): a prompt IMMEDIATELY after a tool_use is a steer.
      if (prevType === "tool_use") corrections.push(e.text);
      prevType = "user_prompt";
      continue;
    }

    if (e.type === "tool_use") {
      if (e.ok === false) {
        // Lens ②: the failure signal — error_summary, falling back to detail.
        failures.push(e.error_summary ?? e.detail ?? `${e.tool} failed`);
      }
      if (isSalientTool(e)) tools.push(toolLine(e));
      prevType = "tool_use";
      continue;
    }

    // skill_load / session_start: not a lens signal, but they ARE non-terminator
    // events, so they break the tool_use→prompt adjacency for the correction lens.
    if (e.type === "skill_load" || e.type === "session_start") prevType = e.type;
    // terminators (compact / session_end): structural only — leave prevType.
  }

  const signals = { prompts, corrections, failures, tools };
  const count = prompts.length + corrections.length + failures.length + tools.length;
  return { signals, count };
}

/** A tool_use is salient iff it failed, OR carries a NON-EMPTY detail, OR touched paths. */
function isSalientTool(e: Extract<ObserveEvent, { type: "tool_use" }>): boolean {
  return e.ok === false || hasContent(e.detail) || e.paths.length > 0;
}

/** True iff a nullable string carries non-whitespace content (an empty detail is noise). */
function hasContent(s: string | null): boolean {
  return s !== null && s.trim().length > 0;
}

/**
 * One-liner for a salient tool_use: `tool: <detail | joined-paths>`.
 *
 * SECURITY: `e.detail` is already scrubbed at capture (scrub.ts), but `e.paths`
 * are STRUCTURED identifiers that ADR-0015 §4 deliberately never routes through
 * scrubField — so an unscrubbed path could carry a credential in a segment (e.g.
 * a mounted `//user:pass@host/share/file.ts`). 0.0.7 is the first release to
 * surface those paths in a JSON manifest handed to an external skill, and the
 * manifest goes straight to stdout with no post-hoc scan, so we redact() the
 * assembled line here — masking any secret in a path to `[REDACTED:<kind>]` while
 * leaving the path otherwise intact. redact() is idempotent, so the already-scrubbed
 * `detail` half round-trips unchanged.
 */
function toolLine(e: Extract<ObserveEvent, { type: "tool_use" }>): string {
  const body = hasContent(e.detail) ? (e.detail as string) : e.paths.join(",");
  return redact(`${e.tool}: ${body}`).text;
}

// ─── deterministic hint (the likely note-type nudge) ─────────────────────────

/**
 * A deterministic phrase nudging the likely mage note-type, combining the lenses
 * that fired (ADR-0018 §4). Corrections lead (direct human feedback is the
 * highest-signal durable knowledge); failures and repeated workflows follow.
 * Falls back to "tool activity" when only routine tool traces are present.
 */
function hintFor(signals: DistillCluster["signals"]): string {
  const parts: string[] = [];
  if (signals.corrections.length > 0) parts.push("a user correction (likely a preference/principle)");
  if (signals.failures.length > 0) parts.push("a failure (likely a gotcha)");
  if (hasRepeatedTool(signals.tools)) parts.push("a repeated workflow (likely a playbook)");
  if (parts.length > 0) return parts.join(" + ");
  // No correction/failure/repeat fired. A prompts-only chapter is still intent the
  // skill may distill (e.g. a stated preference with no tool follow-up) — don't
  // mislabel it "tool activity" when there were no salient tools at all.
  if (signals.prompts.length > 0) return "a user prompt (likely intent/context)";
  return "tool activity";
}

/** True iff any single tool name appears ≥2 times — the repeated-workflow shape. */
function hasRepeatedTool(tools: string[]): boolean {
  const counts = new Map<string, number>();
  for (const line of tools) {
    const name = line.slice(0, line.indexOf(":")); // the tool name before the ": ".
    const next = (counts.get(name) ?? 0) + 1;
    if (next >= 2) return true;
    counts.set(name, next);
  }
  return false;
}

// ─── computeDistillClusters — PURE compute ───────────────────────────────────

/**
 * Group one session's un-distilled CLOSED events into candidate clusters
 * (ADR-0018 §3–§5). PURE — no fs, no model.
 *
 *  - `priorOffset` is how many events were already dispositioned for this session.
 *  - Only the CLOSED region `events[0..closedCount)` is eligible; the new region
 *    is `events[priorOffset..closedCount)`. priorOffset >= closedCount → nothing.
 *  - The new region is chopped at terminator boundaries; each segment's salient
 *    signals are extracted across the four lenses. A segment with NO salient
 *    signal produces NO cluster (the salience filter, §5).
 *  - SALIENCE_CAP (§5): segments are processed in order, accumulating a running
 *    signal count. Before adding a segment, if including it would exceed the cap
 *    AND at least one cluster is already emitted, STOP (capped=true) and leave
 *    `closedOffset` at the END of the last INCLUDED segment so the spilled
 *    segments stay past the watermark and are re-offered next run. If never
 *    capped, closedOffset = closedCount (the whole closed region was offered).
 */
export function computeDistillClusters(
  session: string,
  events: ObserveEvent[],
  priorOffset: number,
  repoRoot: string | null,
): { clusters: DistillCluster[]; closedOffset: number; capped: boolean } {
  void repoRoot; // reserved for future path-relative signals; lenses are path-agnostic in 0.0.7.

  const closedCount = closedCountOf(events);
  const from = Math.max(0, priorOffset);
  if (from >= closedCount) {
    // Nothing new closed since the last disposition — re-offer nothing, but the
    // suggested watermark must not regress below what's already closed.
    return { clusters: [], closedOffset: Math.max(from, closedCount), capped: false };
  }

  const segments = segmentClosed(events, from, closedCount);
  const clusters: DistillCluster[] = [];
  let running = 0;
  // The END of the last INCLUDED segment — only consulted on the capped path, so
  // the spilled segments stay past the watermark and are re-offered next run.
  let lastIncludedEnd = from;

  for (const seg of segments) {
    const { signals, count } = extractSegment(events, seg);
    if (count === 0) continue; // salience filter: an all-empty segment → no cluster.

    // Cap + spill (§5): stop BEFORE a segment that would overflow the budget, but
    // only once we've emitted at least one cluster (never emit an empty batch). The
    // suggested offset stops at the last INCLUDED segment so the rest re-offers.
    if (clusters.length > 0 && running + count > SALIENCE_CAP) {
      return { clusters, closedOffset: lastIncludedEnd, capped: true };
    }

    clusters.push({
      session,
      span: spanOf(seg),
      signals,
      hint: hintFor(signals),
    });
    running += count;
    lastIncludedEnd = seg.end;
  }

  // Never capped → we offered the WHOLE closed region (including any trailing
  // non-salient segments that produced no cluster but are still dispositioned).
  return { clusters, closedOffset: closedCount, capped: false };
}

/** Informational 1-based event span for a segment, e.g. `L3-L12`. */
function spanOf(seg: Segment): string {
  return `L${seg.start + 1}-L${seg.end}`;
}

// ─── readDistill — the fs orchestrator (READ-ONLY) ───────────────────────────

/**
 * List session streams, run {@link computeDistillClusters} per session, and
 * collect a {@link DistillManifest}. READ-ONLY: it reads the watermark for prior
 * offsets and SUGGESTS the next one in `manifest.cursors`, but NEVER writes it
 * (only `mage distill --seen` commits, after human disposition). Lists exactly
 * like rollup.ts — top-level `*.jsonl`, EXCLUDING `*.skills.jsonl` sidecars and
 * the `.archive` subdir — and skips a torn file (fail-open) so a bad stream never
 * aborts the whole pass.
 */
export async function readDistill(
  docsRoot: string,
  learningsDir: string,
  repoRoot: string | null,
): Promise<DistillManifest> {
  const wm = await readWatermark(docsRoot);
  const files = await listSessionStreams(learningsDir);

  const clusters: DistillCluster[] = [];
  const cursors: Record<string, number> = {};
  let capped = false;

  for (const file of files) {
    const session = basename(file, ".jsonl");
    const events = await parseStream(join(learningsDir, file));
    const priorOffset = wm.cursors[session] ?? 0;
    const r = computeDistillClusters(session, events, priorOffset, repoRoot);
    for (const c of r.clusters) clusters.push(c);
    cursors[session] = r.closedOffset; // SUGGESTED watermark — not written here.
    capped = capped || r.capped;
  }

  return { clusters, cursors, capped };
}

/**
 * Read every per-session stream into parsed events (ADR-0029): the digest path needs the raw
 * events, not chapter clusters. Reuses the same listing + fail-open parse as {@link readDistill}.
 * READ-ONLY. Returns `[]` on a missing `.learnings/` dir.
 */
export async function readSessionStreams(
  learningsDir: string,
): Promise<Array<{ session: string; events: ObserveEvent[] }>> {
  const files = await listSessionStreams(learningsDir);
  const out: Array<{ session: string; events: ObserveEvent[] }> = [];
  for (const file of files) {
    const session = basename(file, ".jsonl");
    out.push({ session, events: await parseStream(join(learningsDir, file)) });
  }
  return out;
}

/**
 * The full per-session streams to read: top-level `*.jsonl`, EXCLUDING the
 * `*.skills.jsonl` sidecars (the endswith check is ordered FIRST — a sidecar's
 * basename would corrupt the session key) and the `.archive` subdir (only files,
 * not dirs, are read). Mirrors rollup.ts listSessionStreams exactly.
 */
async function listSessionStreams(learningsDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(learningsDir, { withFileTypes: true });
  } catch {
    return []; // no `.learnings/` dir yet → nothing to distill.
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
      // Skip a torn/garbage line — a partial last write must not abort the read.
    }
  }
  return events;
}
