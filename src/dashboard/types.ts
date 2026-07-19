// The DashboardData model (ADR-0020 — the per-KB, no-server generated dashboard).
//
// This is the FROZEN data contract every renderer (static Dashboard.md, the
// Knowledge.base frontmatter view, and the centerpiece `dashboard.html`) builds
// against. It is a pure, JSON-serializable snapshot of ONE knowledge base, read
// from LOCAL FILES ONLY — never a remote fetch (ADR-0020 §4). The collector
// ({@link ./collect.ts}) is KB-directory-agnostic (ADR-0020 §5): it takes a
// resolved KB dir as input, so the same shape is produced locally now and could
// be produced server-side later.
//
// Design rules baked into this type:
//   - Every field is plain data (string | number | boolean | array | nested
//     object). No functions, no Dates — instants are ISO-8601 strings so the
//     snapshot round-trips through JSON unchanged.
//   - Optional sources degrade to zeros / empties, never to absent keys: a
//     brand-new KB with only a couple of notes and NO `.metrics/` still yields a
//     fully-populated, valid DashboardData (empty proposals[], zeroed kpis,
//     ladder.scratch === 0). Renderers never have to guard for `undefined` on a
//     required field.
//   - `registry` is the lone hub-only field — present (possibly empty) for a hub
//     KB, omitted for a repo KB. It carries POINTERS only (names, repo URLs,
//     local paths), never remote content (ADR-0020 §4).

/** Which kind of KB this snapshot was collected from. Mirrors `resolveDocsRoot`. */
export type DashboardKbKind = "repo" | "hub";

/** A grooming proposal's kind — the ADR-0019 §2 `ProposalAction` vocabulary. */
export type ProposalKind = "note" | "graduate" | "merge" | "split" | "reword" | "demote";

/** The advisory context-match status for a skill (mirrors rollup.ts SkillMetricRow). */
export type SkillStatus = "ok" | "reword-suggested" | "demote-suggested";

/** Top-of-dashboard identity + provenance stamp. */
export interface DashboardMeta {
  /** Display name of the KB (hub name, or the in-repo code-repo basename). */
  kbName: string;
  kind: DashboardKbKind;
  /** Absolute docs root the snapshot was read from. */
  root: string;
  /** mage's own version that generated this snapshot. */
  mageVersion: string;
  /** ISO-8601 instant the snapshot was taken (the honest `last_refreshed` stamp). */
  lastRefreshed: string;
}

/** The headline numbers — all REAL, derived from the scan + metrics (no mocks). */
export interface DashboardKpis {
  notes: number;
  skills: number;
  wings: number;
  /** Whole-KB context-match rate as a percentage 0–100 (0 when no rollup yet). */
  contextMatchPct: number;
  /** Count of proposals awaiting the human's judgment (the hero-queue depth). */
  awaitingYou: number;
  /** Count of `graduate` proposals — notes proven ready to become skills. */
  graduateReady: number;
}

/** One row in the hero "Awaiting your judgment" queue (ADR-0020 §2). */
export interface DashboardProposal {
  kind: ProposalKind;
  /** What it acts on: a signature key (kind "note") or a note relPath (others). */
  target: string;
  /** Human-readable rationale (the proposal's `evidence`). */
  why: string;
  /** The wing this proposal belongs to, when derivable from its payload. */
  wing?: string;
  /** The raw structured rationale, for renderers that want more than `why`. */
  evidence?: string;
}

/** One wing, with its note/skill counts and the rooms it spans. */
export interface DashboardWing {
  name: string;
  /** Optional stable color hint (renderer may map it; e.g. for the graph). */
  color?: string;
  noteCount: number;
  /** Skills attributed to this wing (by the skill's first keyword/wing tag). */
  skillCount: number;
  /** The rooms (second tag segment) seen under this wing, sorted. */
  rooms?: string[];
}

/** One note — enough for a list row AND an `obsidian://` deep-link. */
export interface DashboardNote {
  title: string;
  type: string;
  /** Primary wing ("" = cross-cutting). */
  wing: string;
  /** Primary room ("" = none). */
  room: string;
  /**
   * EVERY tag-wing this note is homed under (multi-home, ADR-0012 §5), each with
   * its per-wing room. A note multi-homed in wings A and B must be LISTED under
   * both (not just the primary), so renderers iterate this rather than `wing`.
   * Empty => cross-cutting. Mirrors `ScannedNote.wings`.
   */
  wings: Array<{ wing: string; room: string }>;
  keywords: string[];
  status?: string;
  lastReviewed?: string;
  /** Posix path relative to the docs root. */
  relPath: string;
  /** Vault-relative path for `obsidian://open?file=…` deep-links (== relPath). */
  obsidianFile: string;
}

/** One skill row, carrying its context-match health when the rollup has data. */
export interface DashboardSkill {
  name: string;
  wing?: string;
  /** Context-match rate as a percentage 0–100 (absent when not yet observed). */
  contextMatchPct?: number;
  status?: SkillStatus;
}

/** A preview-scale node in the note-to-note link graph. */
export interface DashboardGraphNode {
  /** The note's relPath — its stable id and link target. */
  id: string;
  /** Primary wing, for coloring ("" = cross-cutting). */
  wing: string;
}

/** A directed note-to-note edge (from a markdown link to another note). */
export interface DashboardGraphEdge {
  /** Source note relPath. */
  source: string;
  /** Target note relPath (resolved, root-relative). */
  target: string;
}

/** The note-to-note link graph (preview-scale — capped node/edge count). */
export interface DashboardGraph {
  nodes: DashboardGraphNode[];
  edges: DashboardGraphEdge[];
}

/** One day's activity tally, from note created / updated / last_reviewed dates. */
export interface DashboardActivity {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Notes created on this date. */
  created: number;
  /** Notes reviewed/updated on this date. */
  reviewed: number;
}

/** One "climbing" rung: signatures that have recurred across `sessions` sessions. */
export interface DashboardLadderClimb {
  /** Distinct-session recurrence count this bucket sits at. */
  sessions: number;
  /** How many signatures are at this recurrence count. */
  count: number;
}

/** The durability ladder scratch → note → skill (ADR-0020 §2; ADR-0019 §4). */
export interface DashboardLadder {
  /** Pre-promotion scratch event count (cheap line tally of `.learnings/*.jsonl`). */
  scratch: number;
  /** Tracked knowledge notes. */
  notes: number;
  /** Promoted skills. */
  skills: number;
  /** "climbing: N signatures at K sessions" — the recurrence tally, descending. */
  climbing: DashboardLadderClimb[];
}

/** The repo's last commit, for the provenance stamp. Null when not a git repo. */
export interface DashboardCommit {
  hash: string;
  /** ISO-8601 commit instant. */
  when: string;
}

/** Knowledge-base health signals (reuses the read-only `mage dream` detector). */
export interface DashboardHealth {
  /** Notes missing/older-than-threshold `last_reviewed` (the staleness count). */
  notesDueForReview: number;
  /** Relative markdown links whose target file does not exist. */
  danglingLinks: number;
  /** Notes with no graph edges in or out. */
  orphanNotes: number;
  /** Last commit, or null when the root is not inside a git repo. */
  lastCommit: DashboardCommit | null;
}

/** One hub-registry pointer (hub KB only) — name + repo pointers, never content. */
export interface DashboardRegistryEntry {
  name: string;
  /** The member's code-repo URL (empty string when unknown). */
  repoUrl: string;
  /** The member's local code-repo path. */
  codePath: string;
  /** True iff that local path currently exists on disk (a cheap presence check). */
  cloned: boolean;
}

/**
 * The autonomy reject-ledger's crown signal (ADR-0031 P2) — the keep-vs-revert rate over
 * the agent's autonomously-authored notes, `source === "capture"` cohort ONLY. Omitted from
 * {@link DashboardData} entirely when there are no capture terminals yet (the tile hides).
 */
export interface DashboardKeepRate {
  /** (keep + edited) / terminals, 0..1. */
  rate: number;
  /** Total capture terminals (keep + edited + discard + reject). */
  terminals: number;
  keep: number;
  edited: number;
  discard: number;
  reject: number;
  /** The pre-registered crown threshold (0..1), or null when unset (ADR-0031 defers the value). */
  threshold: number | null;
}

/** The complete, JSON-serializable snapshot of ONE knowledge base (ADR-0020). */
export interface DashboardData {
  meta: DashboardMeta;
  kpis: DashboardKpis;
  proposals: DashboardProposal[];
  wings: DashboardWing[];
  notes: DashboardNote[];
  skills: DashboardSkill[];
  graph: DashboardGraph;
  activity: DashboardActivity[];
  ladder: DashboardLadder;
  health: DashboardHealth;
  /** Hub-only registry pointers; omitted entirely for an in-repo KB. */
  registry?: DashboardRegistryEntry[];
  /** The autonomy keep-rate crown signal (ADR-0031 P2); omitted when no capture terminals yet. */
  keepRate?: DashboardKeepRate;
}
