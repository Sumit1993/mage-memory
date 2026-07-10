// The boundary nudge's persisted state store (ADR-0030 §5): the throttle clock + the
// mtime-cache, behind a small interface so the nudge orchestrates rather than owning file I/O.
//
// One git-ignored file under `.mage/metrics/` carries four concerns:
//   - the BACKLOG clock — when the backlog reminder last surfaced (anti-nag, once per window);
//   - the DREAM clock — when the read-only dream-health tick last scanned (its own, slower window);
//   - the CHAPTER watermark — the terminator ts of the last chapter whose digest surfaced, so the
//     digest fires at most once per chapter across the compact + startup/resume paths (ADR-0030 amend);
//   - the MTIME CACHE — the scratch fingerprint + the tally it pinned, so a no-new-scratch
//     startup reuses the counts instead of re-scanning.
// They share one file (and one fail-open field-merge) but are exposed as clean per-concern
// operations, so the nudge never touches the on-disk shape, the schema, or the merge — and this
// module can be unit-tested directly (nudge-state.test.ts) without the whole nudge integration.
//
// FAIL-OPEN throughout: a missing/corrupt file reads as "never reminded, no cache" and a write
// failure is swallowed — the boundary nudge must never break the host session start.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { distillWatermarkPath } from "../../distill/watermark.js";
import type { BacklogTally } from "../../grooming/backlog.js";
import { learningsPath, metricsPath, stagingPath } from "../../paths.js";

/** Anti-nag throttle + mtime cache: the backlog reminder fires at most once per window. */
const NUDGE_THROTTLE_FILE = "nudge-throttle.json";

/** The state file for a docs root — `<root>/.mage/metrics/nudge-throttle.json`. */
function statePath(root: string): string {
  return join(metricsPath(root), NUDGE_THROTTLE_FILE);
}

interface NudgeState {
  /** Epoch ms of the last surfaced backlog reminder (0 = never). */
  lastNudge: number;
  /** Epoch ms of the last dream-health scan (0 = never). */
  lastDream: number;
  /**
   * Terminator timestamp (the chapter's own `ts`, a string) of the last chapter whose digest
   * surfaced — the once-per-chapter de-dup watermark (ADR-0030 amendment). Stamped by BOTH the
   * compact and the startup/resume paths so a chapter never surfaces twice across them. "" = never.
   */
  lastChapterTs: string;
  /** The scratch mtime fingerprint at the last tally compute ("" = none cached). */
  fp: string;
  /** The cached three-part tally, when a fingerprint pinned it. */
  tally?: BacklogTally;
}

async function readState(root: string): Promise<NudgeState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(root), "utf8")) as Record<string, unknown>;
    const lastNudge = typeof parsed.lastNudge === "number" ? parsed.lastNudge : 0;
    const lastDream = typeof parsed.lastDream === "number" ? parsed.lastDream : 0;
    const lastChapterTs = typeof parsed.lastChapterTs === "string" ? parsed.lastChapterTs : "";
    const fp = typeof parsed.fp === "string" ? parsed.fp : "";
    const tally = isBacklogTally(parsed.tally) ? parsed.tally : undefined;
    return { lastNudge, lastDream, lastChapterTs, fp, tally };
  } catch {
    // missing/corrupt → never throttled, no chapter shown, no cache.
    return { lastNudge: 0, lastDream: 0, lastChapterTs: "", fp: "" };
  }
}

/** Narrow a parsed value to a BacklogTally (drops a partial/corrupt cache). */
function isBacklogTally(v: unknown): v is BacklogTally {
  if (v === null || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.staged === "number" &&
    typeof t.unmined === "number" &&
    typeof t.unminedCapped === "boolean" &&
    typeof t.graduable === "number"
  );
}

/**
 * Merge a partial update into the state file. The two clocks (`lastNudge`, `lastDream`) and the
 * mtime cache (`fp` + `tally`) are each kept when not in the patch, so stamping one clock or
 * recomputing the tally never resets the others. Fail-open: a write failure must never break
 * session start.
 */
async function writeState(root: string, patch: Partial<NudgeState>): Promise<void> {
  try {
    const prev = await readState(root);
    const next: NudgeState & { v: number } = {
      v: 4,
      lastNudge: patch.lastNudge ?? prev.lastNudge,
      lastDream: patch.lastDream ?? prev.lastDream,
      lastChapterTs: patch.lastChapterTs ?? prev.lastChapterTs,
      fp: patch.fp ?? prev.fp,
      tally: patch.tally ?? prev.tally,
    };
    const path = statePath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(next)}\n`);
  } catch {
    // Fail-open: a state-file write failure must never break the host session start.
  }
}

// ─── the seam ────────────────────────────────────────────────────────────────────

/**
 * An mtime fingerprint of the scratch that feeds the backlog scan: the `.learnings/` dir mtime
 * (new/removed/rewritten session streams bump it), the distill watermark file mtime (a `mage
 * distill --seen` advances the unmined cursor), and the `.mage/staging/` dir mtime (a `mage stage`
 * adds a draft / a groom drains one — the staged count must not go stale across a stage/groom that
 * never touched `.learnings/`). "" when none can be stat'd → never gate (always recompute), the
 * safe-open behaviour.
 */
export async function scratchFingerprint(root: string): Promise<string> {
  const parts: string[] = [];
  try {
    parts.push(String((await stat(learningsPath(root))).mtimeMs));
  } catch {
    // No `.learnings/` yet — leave it out; the watermark/staging may still pin the fingerprint.
  }
  try {
    parts.push(String((await stat(distillWatermarkPath(root))).mtimeMs));
  } catch {
    // No watermark yet — distill has not run; fine.
  }
  try {
    parts.push(String((await stat(stagingPath(root))).mtimeMs));
  } catch {
    // No `.mage/staging/` yet — nothing staged; fine.
  }
  return parts.join(":");
}

/** The cached tally iff a non-empty `fingerprint` matches the one pinned on disk; else null. */
export async function cachedTally(root: string, fingerprint: string): Promise<BacklogTally | null> {
  if (fingerprint.length === 0) return null; // no fingerprint → never gate (always recompute).
  const { fp, tally } = await readState(root);
  return fp === fingerprint && tally ? tally : null;
}

/** Pin a freshly-computed tally to its scratch fingerprint, preserving the throttle clock. */
export async function cacheTally(root: string, fingerprint: string, tally: BacklogTally): Promise<void> {
  await writeState(root, { fp: fingerprint, tally });
}

/** True iff the backlog window has elapsed since the last surfaced reminder (fail-open: yes). */
export async function elapsedSince(root: string, windowMs: number): Promise<boolean> {
  const { lastNudge } = await readState(root);
  return Date.now() - lastNudge >= windowMs;
}

/** Stamp the reminder clock to now, preserving the dream clock + mtime cache. */
export async function markReminded(root: string): Promise<void> {
  await writeState(root, { lastNudge: Date.now() });
}

/**
 * The terminator `ts` of the last chapter whose digest surfaced ("" = never). The nudge compares a
 * candidate chapter's terminator `ts` against this to fire the digest at most once per chapter
 * (ADR-0030 amendment). Fail-open: a missing/corrupt file reads "" → the candidate is treated as new.
 */
export async function lastShownChapterTs(root: string): Promise<string> {
  return (await readState(root)).lastChapterTs;
}

/** Stamp the once-per-chapter watermark to `ts`, preserving the clocks + mtime cache. */
export async function markChapterShown(root: string, ts: string): Promise<void> {
  await writeState(root, { lastChapterTs: ts });
}

/** True iff the dream-health window has elapsed since the last scan (fail-open: yes). */
export async function elapsedSinceDream(root: string, windowMs: number): Promise<boolean> {
  const { lastDream } = await readState(root);
  return Date.now() - lastDream >= windowMs;
}

/** Stamp the dream-health clock to now, preserving the reminder clock + mtime cache. */
export async function markDreamShown(root: string): Promise<void> {
  await writeState(root, { lastDream: Date.now() });
}
