// Stage-2 applier types (ADR-0019 §6, ADR-0016 §4). PURE types — no runtime.
// Executors (graduate/demote/merge/split/reword) are READ-ONLY planners: they read
// what they need and return a MutationPlan of INTENDED changes. The single applier
// (applier.ts) enforces the §3 ceilings on the plan, THEN performs every write/
// archive/remove. Executors never touch disk; the applier is the one serialized writer.

import type { ProposalAction } from "../grooming/types.js";

/** Create-or-overwrite a file with this exact content (absolute path). */
export interface FileWrite {
  path: string;
  content: string;
}

/** Move a file/dir to an archive location (rename-move — never a delete). */
export interface FileArchive {
  from: string;
  to: string;
}

/**
 * A read-only PLAN of intended mutations. The applier scans EVERY `writes[].content`
 * for live secrets (Gate-2), bespoke-guards every existing `skillTargets` path
 * (must carry GEN_MARKER), and refuses any `removes` path outside the skill trees
 * (knowledge is never hard-deleted) — all BEFORE performing any change.
 */
export interface MutationPlan {
  action: ProposalAction;
  /** Notes/skills to create or overwrite. */
  writes: FileWrite[];
  /** Files/dirs to move to archive (never rm — knowledge is never hard-deleted). */
  archives: FileArchive[];
  /**
   * Generated-skill dirs to remove AFTER archiving. The applier refuses any path NOT
   * under `<repo>/.claude/skills/` or `<repo>/.agents/skills/` (never a note), and
   * each must also appear in `skillTargets` for the GEN_MARKER guard.
   */
  removes: string[];
  /**
   * Absolute SKILL.md paths this plan creates/overwrites/removes. For each that
   * ALREADY EXISTS, the applier reads it and REFUSES unless it carries GEN_MARKER
   * (no clobbering a bespoke skill). Empty for pure-note mutations.
   */
  skillTargets: string[];
  /** One-line human summary for the ApplyResult. */
  summary: string;
}

/** The result of the applier executing (or refusing) one proposal. */
export interface ApplyResult {
  action: ProposalAction;
  ok: boolean;
  /** Non-null when a ceiling refused the apply (Gate-2 / bespoke / unsafe-remove / unsupported). */
  refused: string | null;
  /** Docs-root-relative (or repo-relative) paths written. */
  written: string[];
  /** Archive moves performed (from→to, relative). */
  archived: string[];
  summary: string;
}
