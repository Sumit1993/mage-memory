// The boundary nudge's three-part capped backlog tally (ADR-0030 §2). PURE-ish: it
// only READS cheap, already-persisted artifacts — no re-fold, no model, no write — so
// it is safe on the SessionStart hot path and fully fail-open (every read .catch()'d).
//
// The three parts (ADR-0030 §2):
//   1. staged    — `.mage/staging/` draft count (a file count: readStagedDrafts().length);
//   2. unmined   — terminator-closed chapters in `.mage/learnings/` past the distill
//                  watermark cursor, CAPPED at 9 (rendered "9+") so the scan is bounded;
//   3. graduable — signatures in the PERSISTED promote tally whose recurrence count is at
//                  or above the graduation gate M. This is the purge-surviving tally
//                  (ADR-0019 §1) read as-is — NO re-fold (a full promote fold at the hook
//                  is exactly what the ADR forbids).
//
// At Operator the tally is a human reminder; at Approver/Overseer it doubles as the
// agent's work-list. Rendering ("3 staged · 6 chapters unmined · 1 note ready to
// graduate") lives in the nudge — this module just produces the counts.

import { readWatermark } from "../distill/watermark.js";
import { unminedClosedChapters } from "../distill/digest.js";
import type { ObserveEvent } from "../observe/types.js";
import { stagingPath } from "../paths.js";
import { readStagedDrafts } from "./staging.js";
import { readTally } from "./tally.js";
import { type Sensitivity, thresholdsFor } from "./thresholds.js";

/** The capped tally of grooming backlog at a docs root (ADR-0030 §2). */
export interface BacklogTally {
  /** Staged lesson drafts awaiting `mage:groom` (a file count). */
  staged: number;
  /** Closed chapters in `.learnings/` past the distill watermark, CAPPED at {@link UNMINED_CAP}. */
  unmined: number;
  /** True iff `unmined` hit the cap — the caller renders it "9+". */
  unminedCapped: boolean;
  /** Persisted-tally signatures at/above the graduation gate M (no re-fold). */
  graduable: number;
}

/** The unmined-chapter ceiling (ADR-0030 §2): the scan stops here and renders "9+". */
export const UNMINED_CAP = 9;

/**
 * Compute the three-part capped backlog tally from PRE-READ session streams (ADR-0030 §2). FAIL-OPEN:
 * every read is `.catch()`'d so a missing/corrupt artifact yields 0 for that part, never throws
 * (reachable from a SessionStart hook). The `unmined` count sums each session's post-watermark closed
 * chapters, capped at {@link UNMINED_CAP}; `graduable` reads the persisted promote tally as-is (no
 * fold). `sensitivity` scales the graduation gate M.
 *
 * The streams are hoisted OUT (rather than read here) so the boundary nudge shares its single
 * `readSessionStreams` call across both the digest and this tally (ADR-0030 amendment).
 */
export async function computeBacklogFromStreams(
  root: string,
  sensitivity: Sensitivity,
  streams: Array<{ session: string; events: ObserveEvent[] }>,
): Promise<BacklogTally> {
  const staged = (await readStagedDrafts(stagingPath(root)).catch(() => [])).length;
  const unmined = await unminedFromStreams(root, streams);
  const graduable = await graduableTally(root, sensitivity);
  return {
    staged,
    unmined: unmined.count,
    unminedCapped: unmined.count >= UNMINED_CAP,
    graduable,
  };
}

/**
 * Sum the post-watermark closed chapters across the given session streams, capped at
 * {@link UNMINED_CAP}. The watermark cursor is a per-session event OFFSET, so each
 * session's tail is counted against its own cursor (a missing cursor ⇒ 0 ⇒ count ALL of
 * that session's closed chapters). readWatermark already fails open to an empty watermark.
 */
async function unminedFromStreams(
  root: string,
  streams: Array<{ session: string; events: ObserveEvent[] }>,
): Promise<{ count: number }> {
  const wm = await readWatermark(root).catch(() => ({ v: 0, cursors: {} as Record<string, number> }));
  let count = 0;
  for (const { session, events } of streams) {
    const cursor = wm.cursors[session] ?? 0;
    // Distribute the remaining cap budget so the early-break stays a true 9+ ceiling.
    count += unminedClosedChapters(events, cursor, UNMINED_CAP - count);
    if (count >= UNMINED_CAP) return { count: UNMINED_CAP };
  }
  return { count };
}

/**
 * Count persisted-tally signatures whose recurrence count is at/above the graduation gate
 * M (dial-scaled). NO re-fold — this reads `.mage/metrics/promote.json` as-is, the
 * purge-surviving global counter (ADR-0019 §1). A signature ≥ M is graduation-eligible by
 * recurrence; whether a covering note exists (the precise `mage:graduate` proposal set)
 * needs a fold we deliberately skip here, so this is the cheap UPPER-BOUND reminder, not
 * the exact proposal count. readTally fails open to an empty tally.
 */
async function graduableTally(root: string, sensitivity: Sensitivity): Promise<number> {
  const tally = await readTally(root).catch(() => null);
  if (!tally) return 0;
  const m = thresholdsFor(sensitivity).graduateSessions;
  let n = 0;
  for (const stat of Object.values(tally.signatures)) {
    if (typeof stat?.sessions === "number" && stat.sessions >= m) n += 1;
  }
  return n;
}
