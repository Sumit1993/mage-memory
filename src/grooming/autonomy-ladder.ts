// The opt-in autonomy ladder (ADR-0030): the single home for the
// Operator → Approver → Overseer dial. Everything a caller must know about a
// level — its ordered place, its one-line human meaning, the agent mandate it
// templates at a boundary, how to narrow an untrusted value, how to coerce a
// user-supplied string — lives behind this one interface.
//
// Before this module the ladder had no home: the type + default + validator sat
// in thresholds.ts, the level list + meanings + coercer in commands/autonomy.ts,
// and the three mandate templates in adapters/claude-code/nudge.ts — four files that had to
// change together to add or reword a rung. This module concentrates them so a
// rung change touches one place (locality) and every consumer reads one
// definition (leverage). PURE: no fs, no model, no metadata read — the config
// read lives in grooming/config.ts, which narrows through {@link narrowAutonomy}.

/** The opt-in autonomy ladder (ADR-0030): how much of the grooming ladder the host agent drains. */
export type Autonomy = "operator" | "approver" | "overseer";

/** The three levels, in ladder order — the source for the error list and the meaning/mandate lookups. */
export const LEVELS: readonly Autonomy[] = ["operator", "approver", "overseer"];

/**
 * The autonomy default when metadata is absent / invalid (ADR-0030): "operator" —
 * the dial is opt-IN, so a fresh KB gets no surprise autonomous writes (it still gets
 * the new backlog signal). The maintainer raises their own repos to approver/overseer.
 */
export const DEFAULT_AUTONOMY: Autonomy = "operator";

/** One-line meaning per level (ADR-0030 §1) — the human-role summary printed by `mage autonomy`. */
const MEANING: Record<Autonomy, string> = {
  operator: "you run mage:groom, judge each draft, write + commit (HITL; the default)",
  approver: "the agent grooms + writes clearly-durable notes uncommitted (Gate-2 runs); you review the diff + commit",
  overseer: "as approver + the agent disposes the borderline tier and graduates eligible notes; you audit git log + commit",
};

/** The one-line human meaning of a level (ADR-0030 §1). */
export function meaningOf(level: Autonomy): string {
  return MEANING[level];
}

/**
 * Narrow an untrusted value to an Autonomy level; anything outside the three-way enum ⇒
 * {@link DEFAULT_AUTONOMY}. The level is a CHOICE, not derived data, so a junk value never
 * silently escalates autonomy — it fails open to the safe default. Used by the config read.
 */
export function narrowAutonomy(v: unknown): Autonomy {
  if (v === "operator" || v === "approver" || v === "overseer") return v;
  return DEFAULT_AUTONOMY;
}

/**
 * Validate a user-supplied level (the `mage autonomy <level>` set path); throw — listing the
 * three — on anything else. Distinct from {@link narrowAutonomy}: a hand-typed junk level is a
 * user error worth surfacing, not silently defaulting.
 */
export function coerceAutonomy(value: string): Autonomy {
  if (value === "operator" || value === "approver" || value === "overseer") return value;
  throw new Error(`Unknown autonomy level '${value}'. Use one of: ${LEVELS.join(", ")}.`);
}

/**
 * Template the autonomy-scaled mandate (ADR-0030 §5): the already-rendered one-line backlog tally
 * + the level-specific instruction. Operator = ask the human first; Approver = authorized to groom +
 * write durable notes uncommitted (Gate-2 runs); Overseer = + dispose the borderline tier and
 * graduate eligible notes. The caller renders `backlogLine` (it owns the tally shape); this owns
 * the per-level prose. PURE.
 */
export function mandateFor(level: Autonomy, backlogLine: string): string {
  if (level === "approver") {
    return (
      `${backlogLine}\n` +
      "You are authorized (autonomy: approver) to run `mage:groom` now and write the clearly-durable " +
      "notes into the working tree, UNCOMMITTED (Gate-2 redaction runs); leave borderline drafts staged. " +
      "Reviewing the diff is the review; the human's `git commit` is the confirm — mage never commits."
    );
  }
  if (level === "overseer") {
    return (
      `${backlogLine}\n` +
      "You are authorized (autonomy: overseer) to run `mage:groom` now: write durable notes, merge related " +
      "lessons into existing notes, dispose the borderline tier, and `mage:graduate` eligible notes (Gate-2 " +
      "runs; recurrence-gated). All writes land UNCOMMITTED in the working tree — the human audits `git log` " +
      "and `git commit`s; mage never commits."
    );
  }
  // operator (default) — ASK the human; no autonomous-write authorization.
  return (
    `${backlogLine}\n` +
    "At a natural break in the user's work (not mid-task), surface this and ASK whether to run " +
    "`mage:groom` now to file these lessons — or `mage:learn` to capture a specific one " +
    "(autonomy: operator — do not write notes without their go-ahead)."
  );
}
