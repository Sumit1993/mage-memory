// Stage-1 grooming types (ADR-0019 — mage promote / self-grooming). PURE types — no
// runtime. The deterministic promote core (signature → tally → manifest) and the
// gitignored proposal/rejected stores all key on these shapes. See
// mage/decisions/0019-mage-promote-self-grooming.md.

/** The four ADR-0019 §2 lenses a signal can belong to. Corrections are first-class. */
export type Lens = "correction" | "failure" | "workflow" | "preference";

/** Per-lens hit counts for a signature (which lenses produced its evidence). */
export type LensCounts = Record<Lens, number>;

/**
 * A deterministic (wing + keywords) recurrence signature extracted from a CLOSED
 * segment. The `key` is the tally bucket id; equal keys are "the same pattern".
 */
export interface SignatureHit {
  /** Stable key: `${wing}::${sortedKeywords.join(",")}` — the tally bucket id. */
  key: string;
  /** Derived wing ("" = cross-cutting). */
  wing: string;
  /** Sorted, deduped, lower-cased keywords (≤ SIG_KEYWORDS). */
  keywords: string[];
  /** Which lens this hit came from. */
  lens: Lens;
  /** A short, REDACTED human hint for the proposal (≤ 160 chars). */
  hint: string;
}

/** Per-signature accumulation in the tally (purge-surviving global counts). */
export interface SignatureStat {
  /** DISTINCT sessions that contributed this signature (the recurrence count). */
  sessions: number;
  lenses: LensCounts;
  wing: string;
  keywords: string[];
  /** Lexical-max ts observed for this signature. */
  lastSeen: string;
  /** Representative redacted hint (first non-empty wins; stable). */
  hint: string;
}

/** Per-session fold memory (prunable once a session's `.learnings` file vanishes). */
export interface SessionFold {
  /** closedCount already folded (never regresses). */
  offset: number;
  /** Signature keys this session has ALREADY contributed (distinct-session dedupe). */
  sigs: string[];
}

/** The persisted promote tally — gitignored `.metrics/promote.json`. */
export interface PromoteTally {
  v: number;
  /** key → global stat (survives purge). */
  signatures: Record<string, SignatureStat>;
  /** session → fold memory (prunable). */
  sessions: Record<string, SessionFold>;
}

/**
 * A promote/groom proposal (ADR-0016 §4 `{action,target,payload,evidence}`). Stage 1
 * emits only `"note"`; the rest are the Stage-2/3 applier actions, defined here so the
 * rejected-buffer dedupe and the manifest share one vocabulary.
 */
export type ProposalAction = "note" | "graduate" | "merge" | "split" | "reword" | "demote";

export interface Proposal {
  action: ProposalAction;
  /** What it acts on: a signature key (action "note") or a note relpath (later actions). */
  target: string;
  /** Action-specific data the skill/applier consumes (e.g. {wing,keywords,hint} for "note"). */
  payload: Record<string, unknown>;
  /** Why: human-readable evidence ("recurred in N sessions: …"). */
  evidence: string;
}

/** The manifest `mage promote --json` emits for the `mage:groom` / `mage:graduate` skills. */
export interface PromoteManifest {
  /**
   * Both ladder rungs (ADR-0019 §4): `"note"` proposals (signature ≥ K sessions, no
   * covering note — the scratch→note catch-net) and `"graduate"` proposals (a covered,
   * procedural note whose signature recurs ≥ M sessions — the note→skill rung).
   */
  proposals: Proposal[];
  /** Suggested per-session watermark offsets (NOT written by the read path; `--seen` commits). */
  cursors: Record<string, number>;
  /** Count of signatures at/above K that ARE already covered by a note (info; not proposed). */
  covered: number;
}
