// The promote manifest builder (ADR-0019 §4/§5). PURE — no fs, no model, no network.
// The final deterministic stage of the promote core: it folds a recurrence tally,
// the repo's notes, the thresholds dial, and the rejected-edit buffer into the
// `PromoteManifest` the `mage:groom` / `mage:graduate` skills reason over.
//
// ONE LADDER RUNG (ADR-0038 deleted the other):
//   note → skill (graduate): a signature covered by an existing note becomes a "graduate"
//      proposal iff it recurred in >= thresholds.graduateSessions sessions (M) AND the
//      covering note is PROCEDURAL (playbook/gotcha — you auto-load a procedure, not a
//      fact, ADR-0019 §5), deduped by the note's relPath, and not rejected.
//
// The scratch → note rung is GONE. [ADR-0038] deleted it: proposing a NEW note from
// recurrence is the deterministic-selection pattern two pre-registered replay gates killed
// (Faultline 0/62, prose-keyed 0/55; ADR-0029 flagged this ladder suspect + deferred, and
// issue #71 supplied the field evidence — ~115 buckets, 0 durable proposals). Recurrence
// never again SELECTS what becomes a note; that judgment is the agent's, via `mage:learn`.
//
// TRANSITIONAL: graduate still rides this keyword-fold tally. ADR-0038 §2 repoints it to
// note-READ recurrence (usage, not keyword recurrence) in the next PR of the sequence —
// which is when `covered`, the K gate's absence, and the fold itself stop mattering here.
//
// The merge/split/reword/demote actions are NOT emitted here — merge/split are
// judgment-constructed by the skill, reword/demote come from `mage skills --metrics`
// (context-match), not the recurrence tally.
//
// Eligible proposals are RANKED strongest-first (graduate rung, then recurrence, lens
// diversity, recency, target asc) and only the top `promotionBudget` are surfaced — a
// bounded, deterministic stage (0.0.11): a flood of eligible signatures (which the finer
// compact-chapter unit can produce) never buries the strongest, and the rest are reported
// as `deferred` for the next pass.

import { coveringNote } from "./covering-note.js";
import { isRejected } from "./proposals.js";
import type { Thresholds } from "./thresholds.js";
import type {
  Proposal,
  PromoteManifest,
  PromoteTally,
  SignatureStat,
} from "./types.js";
import type { ScannedNote } from "../scan.js";

// ─── proposal constructors (PURE, stable — the rejected-buffer dedupe keys on these) ─

/**
 * The canonical `"graduate"` proposal for a PROVEN procedural note: `target` is the
 * note's relPath (action "graduate" acts on a note — the applier reads it + derives its
 * wing). `payload` carries what the `mage:graduate` skill shows the human; `evidence`
 * is the recurrence rationale. PURE / stable for the rejected-buffer dedupe.
 */
export function graduateProposalFor(note: ScannedNote, stat: SignatureStat): Proposal {
  return {
    action: "graduate",
    target: note.relPath,
    payload: { note: note.relPath, wing: note.wing, type: note.type },
    evidence: `note recurred in ${stat.sessions} session(s) — a proven ${note.type}, ready to graduate to a skill`,
  };
}

/** A note graduates only if it is a PROCEDURE (playbook/gotcha) — ADR-0019 §5. */
function isProcedural(type: string): boolean {
  return type === "playbook" || type === "gotcha";
}

// ─── the bounded promotion budget (0.0.11) — rank strongest-first, surface top-N ─────

/** An eligible proposal with the stat it was scored from (pre-budget ranking). */
interface RankedProposal {
  proposal: Proposal;
  stat: SignatureStat;
}

/** Count of distinct lenses a signature fired under (more lenses = more robust signal). */
function lensDiversity(s: SignatureStat): number {
  const l = s.lenses;
  return (
    (l.correction > 0 ? 1 : 0) +
    (l.failure > 0 ? 1 : 0) +
    (l.workflow > 0 ? 1 : 0) +
    (l.preference > 0 ? 1 : 0)
  );
}

/**
 * Strength comparator for the promotion budget: more recurrence, more lens diversity, more
 * recent, then target asc — a TOTAL, deterministic order so the budget is stable. The
 * rung tiebreak is gone with the note rung (ADR-0038): every proposal here is a graduate.
 */
function rankProposals(a: RankedProposal, b: RankedProposal): number {
  if (a.stat.sessions !== b.stat.sessions) return b.stat.sessions - a.stat.sessions;
  const dl = lensDiversity(b.stat) - lensDiversity(a.stat);
  if (dl !== 0) return dl;
  if (a.stat.lastSeen !== b.stat.lastSeen) return a.stat.lastSeen < b.stat.lastSeen ? 1 : -1;
  return a.proposal.target < b.proposal.target ? -1 : a.proposal.target > b.proposal.target ? 1 : 0;
}

// ─── buildManifest — the graduate rung ──────────────────────────────────────────

/**
 * Build the {@link PromoteManifest} from a folded tally, the repo's notes, the
 * thresholds, the rejected buffer, and the suggested per-session cursors. PURE — the
 * caller supplies `cursors` (the read path computes them from the tally) and they pass
 * through verbatim. See the file header for the gate. Proposals are sorted
 * (action asc, target asc) for a deterministic manifest.
 */
export function buildManifest(
  tally: PromoteTally,
  notes: ScannedNote[],
  thresholds: Thresholds,
  rejected: Proposal[],
  cursors: Record<string, number>,
): PromoteManifest {
  const eligible: RankedProposal[] = []; // every proposal that passed its gate, pre-budget.
  const graduateTargets = new Set<string>(); // note relPaths already proposed (dedupe).
  let covered = 0;

  for (const key of Object.keys(tally.signatures)) {
    const stat = tally.signatures[key];
    if (stat === undefined) continue;
    // NO K gate (ADR-0038): `promoteSessions` only ever pre-filtered the deleted note rung.
    // M > K at every dial position, so the graduate gate below already subsumes it — keeping
    // K here would be dead weight that reads as load-bearing.

    const sig = { wing: stat.wing, keywords: stat.keywords };
    const cover = coveringNote(sig, notes);

    // An UNCOVERED signature is now a dead end: recurrence no longer proposes a new note
    // (ADR-0038 §1). It is not even counted — `covered` describes covered signatures only.
    if (cover === null) continue;

    covered += 1;
    // The only rung: a PROVEN (>= M) procedural note earns a Procedure skill (deduped).
    if (
      stat.sessions >= thresholds.graduateSessions &&
      isProcedural(cover.type) &&
      !graduateTargets.has(cover.relPath)
    ) {
      const gp = graduateProposalFor(cover, stat);
      if (!isRejected(gp, rejected)) {
        eligible.push({ proposal: gp, stat });
        graduateTargets.add(cover.relPath);
      }
    }
  }

  // Rank strongest-first, then surface only the top `promotionBudget` — the rest defer.
  eligible.sort(rankProposals);
  const budget = Math.max(0, thresholds.promotionBudget);
  const surfaced = eligible.slice(0, budget);

  return {
    proposals: surfaced.map((e) => e.proposal),
    cursors: { ...cursors },
    covered,
    deferred: eligible.length - surfaced.length,
  };
}
