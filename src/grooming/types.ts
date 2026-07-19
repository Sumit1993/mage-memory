// Stage-1 grooming types (ADR-0019 — mage promote / self-grooming). PURE types — no
// runtime. The deterministic promote core (note reads → tally → manifest) and the
// gitignored proposal/rejected stores all key on these shapes. The keyword-fold types
// (Lens / SignatureHit / SignatureStat) were deleted with the fold itself — see
// mage/decisions/0038-promote-note-rung-deleted-graduate-on-usage.md.

/**
 * Per-NOTE accumulation in the tally: how many distinct compact-chapters the agent
 * READ this note in (ADR-0038 §2). Keyed by the note's docs-root-relative path, so the
 * binding is exact — unlike the keyword fold it replaces, which bound a signature to a
 * note through `coveringNote`'s fuzzy wing + one-keyword overlap.
 *
 * Chapters in which one of mage's own skills loaded contribute nothing (the
 * self-reference exclusion), so this counts USAGE, not mage inspecting itself.
 */
export interface NoteReadStat {
  /** DISTINCT qualifying chapters this note was read in (the graduation count). */
  chapters: number;
  /** Lexical-max ts of a chapter that counted a read of this note. */
  lastSeen: string;
}

/** Per-session fold memory (prunable once a session's `.learnings` file vanishes). */
export interface SessionFold {
  /** closedCount already folded (never regresses). */
  offset: number;
  /** Signature keys this session has ALREADY contributed (distinct-session dedupe). */
  sigs: string[];
}

/**
 * The persisted promote tally — gitignored `.metrics/promote.json`.
 *
 * v4 (ADR-0038 §7) replaced the `signatures` keyword fold with `notes` (note-read
 * usage). The per-session offset/chapter engine is UNCHANGED — it was never the bug;
 * only what gets counted per chapter changed. A `v` mismatch resets counts AND offsets
 * (`normalizeTally`), which is correct here: v3 counts are uninterpretable under v4 keys.
 * `PROMOTE_VERSION` in tally.ts is the single source of truth for the number.
 */
export interface PromoteTally {
  v: number;
  /** note relPath → read stat (survives purge). */
  notes: Record<string, NoteReadStat>;
  /** session → fold memory (prunable). */
  sessions: Record<string, SessionFold>;
}

/**
 * A promote/groom proposal (ADR-0016 §4 `{action,target,payload,evidence}`). The promote
 * core emits only `"graduate"` (ADR-0038 deleted `"note"`); the rest are Stage-2/3
 * applier actions, defined here so the rejected-buffer dedupe and the manifest share one
 * vocabulary. `"note"` remains in the union: rejected-buffer entries written before
 * ADR-0038 still carry it, and the applier still refuses it explicitly.
 */
export type ProposalAction = "note" | "graduate" | "merge" | "split" | "reword" | "demote";

export interface Proposal {
  action: ProposalAction;
  /** What it acts on: a note relpath (every action the core emits; "note" was a signature key). */
  target: string;
  /** Action-specific data the skill/applier consumes (e.g. {wing,keywords,hint} for "note"). */
  payload: Record<string, unknown>;
  /** Why: human-readable evidence ("recurred in N sessions: …"). */
  evidence: string;
}

/** The manifest `mage promote --json` emits for the `mage:groom` / `mage:graduate` skills. */
export interface PromoteManifest {
  /**
   * ONE ladder rung: `"graduate"` proposals only — a PROCEDURAL note (playbook/gotcha)
   * READ in ≥ M distinct chapters. The `"note"` rung was deleted by ADR-0038; recurrence
   * never proposes a NEW note. An EMPTY list is the normal result and does not imply
   * "nothing was used": a proposal is also absent when the note is non-procedural, when
   * the human rejected it (back-off buffer), or when the read count is below M.
   */
  proposals: Proposal[];
  /** Suggested per-session watermark offsets (NOT written by the read path; `--seen` commits). */
  cursors: Record<string, number>;
  /**
   * Notes being USED but not yet proven: read in ≥1 qualifying chapter, below M (info).
   *
   * Replaces v1's `covered` (recurring signatures a note covered), which described the
   * keyword fold ADR-0038 deleted and had no meaning once graduation keyed on note reads.
   * A rename rather than a redefinition, so a stale reader breaks loudly instead of
   * silently misreading the number.
   */
  climbing: number;
  /** Eligible proposals NOT surfaced this pass — the bounded promotion budget deferred them
   *  (strongest-first); >0 means more candidates wait for the next pass (0.0.11). */
  deferred: number;
}
