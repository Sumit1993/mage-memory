// The thresholds seam + the sensitivity dial (ADR-0019 §7). PURE compute — no fs
// in the constants/scaling; the dial READ touches metadata only.
//
// ADR-0019 §7 mandates ONE module holding every provisional grooming constant
// (no scattering), tunable without touching logic. `BASE_THRESHOLDS` are the
// @normal values; they FINALIZE the provisional 0.0.6 rate-floors by reusing
// context-match.ts's LOW_MATCH_RATE / DEMOTE_MATCH_RATE / MIN_LOADS_FOR_SUGGESTION
// (imported here — never forked, so the numbers stay single-sourced).
//
// The dial is the lone TRACKED knob (ADR-0019 §9): a single human "sensitivity"
// (low | normal | high, default normal) that scales the recurrence GATES together
// — and ONLY the gates. Rates / minLoads / editBudget / sizeCap are quality floors,
// not eagerness, so the dial leaves them fixed. The auto-tuner is a deferred opt-in
// rung (ADR-0019 §7) — nothing here derives the dial from data.

import {
  DEMOTE_MATCH_RATE,
  LOW_MATCH_RATE,
  MIN_LOADS_FOR_SUGGESTION,
} from "../metrics/context-match.js";
import { readHubMetadata, readMetadata } from "../paths.js";

// ─── types ───────────────────────────────────────────────────────────────────

/** The human dial (ADR-0019 §7): scales the recurrence gates together. */
export type Sensitivity = "low" | "normal" | "high";

/** The full thresholds seam — every provisional grooming constant in one place. */
export interface Thresholds {
  promoteSessions: number; // K: distinct CHAPTERS to surface a NEW note candidate (0.0.11)
  graduateSessions: number; // M: distinct CHAPTERS to graduate a note → skill (0.0.11: unit is a compact-chapter, not a session)
  noteSizeCap: number; // split trigger: note body char cap (Stage 2)
  rewordRate: number; // context-match rate below which reword (Stage 3)
  demoteRate: number; // context-match rate below which demote (Stage 2/3)
  minLoads: number; // min skill loads before a context-match suggestion
  editBudget: number; // bounded edits per optimize pass ("textual learning rate", Stage 3)
  promotionBudget: number; // max proposals surfaced per promote pass (ranked strongest-first; the rest defer)
  lessonNoteCap: number; // SOFT target for an organic lesson draft (`mage stage`) — CC-memory-sized, warn-not-block (0.0.12)
  stagingBudget: number; // max staged lesson drafts `mage groom` surfaces per pass (anti-flood; the rest defer) (0.0.12)
}

// ─── consts ──────────────────────────────────────────────────────────────────

/** The dial's default when metadata is absent / invalid (ADR-0019 §7). */
export const DEFAULT_SENSITIVITY: Sensitivity = "normal";

/**
 * BASE = the @normal thresholds. These FINALIZE the provisional 0.0.6 numbers:
 * the rate-floors (rewordRate / demoteRate) and minLoads are IMPORTED from
 * context-match.ts so the metric and the seam never drift. The recurrence gates
 * (K=3, M=5 — chapters, 0.0.11), the note size cap, and the edit budget are constants.
 *
 * M NOTE (0.0.11): briefly raised to 8 to tame the chapter-unit flood, then returned
 * to 5 — de-noise (Candidate 3) + the bounded promotionBudget already tame the flood,
 * and the live soak showed real topical recurrence tops at ~5, so M=8 made graduation
 * unreachable. M=5 keeps graduation organically achievable.
 */
export const BASE_THRESHOLDS: Thresholds = {
  promoteSessions: 3,
  graduateSessions: 5,
  noteSizeCap: 6000,
  rewordRate: LOW_MATCH_RATE,
  demoteRate: DEMOTE_MATCH_RATE,
  minLoads: MIN_LOADS_FOR_SUGGESTION,
  editBudget: 3,
  promotionBudget: 5,
  // 0.0.12 lesson path: organic drafts are CC-memory-sized (one distilled fact +
  // Why/How), far under the 6000 authored-note cap. SOFT — `mage stage` warns past
  // it but never blocks (frictionless inline capture).
  lessonNoteCap: 1200,
  // Anti-flood: at most 3 staged drafts surfaced per `mage groom` pass; the budget
  // is load-bearing even if the salience bar is loose (plan §9).
  stagingBudget: 3,
};

/**
 * The min-work floor for a compact CHAPTER to count as one distinct recurrence unit
 * (0.0.11). The recurrence gates count distinct *chapters* (compact/session_end
 * segments), not session_ids — so a single continuously-compacted chat can still
 * accrue recurrence (a session_id is constant across compaction). A chapter must carry
 * at least this many WORK events (user_prompt + tool_use) so a trivial `/compact`
 * cannot manufacture a unit. STRUCTURAL floor — NOT dial-scaled.
 *
 * KNOWN LIMITATION (deferred, plan-0.0.11-signal-and-capture.md, Candidate 1): chapter
 * SIZE tracks the context-window (compaction fires when it fills), so the raw chapter
 * count is window-sensitive. A window-independent unit (distinct days / idle-gap
 * episodes) is the planned refinement.
 */
export const MIN_CHAPTER_WORK_EVENTS = 2;

/** The recurrence gates per dial position — the ONLY fields the dial scales. */
const GATES: Record<Sensitivity, { promoteSessions: number; graduateSessions: number }> = {
  // high → easier to surface (fewer chapters needed).
  high: { promoteSessions: 2, graduateSessions: 4 },
  // normal → BASE.
  normal: { promoteSessions: BASE_THRESHOLDS.promoteSessions, graduateSessions: BASE_THRESHOLDS.graduateSessions },
  // low → harder to surface (more chapters needed).
  low: { promoteSessions: 4, graduateSessions: 7 },
};

// ─── thresholdsFor — scale ONLY the recurrence gates ──────────────────────────

/**
 * The thresholds at a given sensitivity. Scales ONLY `promoteSessions` +
 * `graduateSessions` (the recurrence gates); rates / minLoads / editBudget /
 * sizeCap are quality floors and stay at BASE. PURE: returns a NEW object spread
 * from BASE — BASE_THRESHOLDS is never mutated.
 *
 *   high  → easier: promoteSessions 2, graduateSessions 4
 *   normal→ BASE  : promoteSessions 3, graduateSessions 5
 *   low   → harder: promoteSessions 4, graduateSessions 7
 */
export function thresholdsFor(s: Sensitivity): Thresholds {
  const gates = GATES[s];
  return { ...BASE_THRESHOLDS, ...gates };
}

// ─── readSensitivity — the dial read (fail-open) ──────────────────────────────

/**
 * Read the tracked sensitivity dial from metadata, defaulting to "normal" and
 * failing open. In-repo → `readMetadata(repo).grooming?.sensitivity`; hub →
 * `readHubMetadata(root).grooming?.sensitivity`. Any read/parse error, a missing
 * file, or a value outside the three-way enum ⇒ DEFAULT_SENSITIVITY. The dial is
 * a CHOICE, not derived data (ADR-0019 §7), so a junk value never silently shifts
 * behaviour — it falls back to the safe normal default.
 */
export async function readSensitivity(resolved: {
  root: string;
  kind: "repo" | "hub";
  repo: string;
}): Promise<Sensitivity> {
  let raw: unknown;
  try {
    if (resolved.kind === "hub") {
      const meta = await readHubMetadata(resolved.root);
      raw = meta?.grooming?.sensitivity;
    } else {
      const meta = await readMetadata(resolved.repo);
      raw = meta?.grooming?.sensitivity;
    }
  } catch {
    return DEFAULT_SENSITIVITY; // unreadable / unknown-schema metadata → safe default.
  }
  return validateSensitivity(raw);
}

/** Narrow an untrusted value to a Sensitivity; anything else ⇒ DEFAULT_SENSITIVITY. */
function validateSensitivity(v: unknown): Sensitivity {
  if (v === "low" || v === "normal" || v === "high") return v;
  return DEFAULT_SENSITIVITY;
}
