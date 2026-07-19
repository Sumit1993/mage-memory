// The promote manifest builder (ADR-0019 §4/§5). PURE — no fs, no model, no network.
// The final deterministic stage of the promote core: it folds a recurrence tally,
// the repo's notes, the thresholds dial, and the rejected-edit buffer into the
// `PromoteManifest` the `mage:groom` / `mage:graduate` skills reason over.
//
// ONE LADDER RUNG (ADR-0038 deleted the other):
//   note → skill (graduate): a note READ in >= thresholds.graduateSessions distinct
//      chapters (M) earns a Procedure skill, iff it is PROCEDURAL (playbook/gotcha — you
//      auto-load a procedure, not a fact, ADR-0019 §5) and not rejected.
//
// The scratch → note rung is GONE. [ADR-0038] deleted it: proposing a NEW note from
// recurrence is the deterministic-selection pattern two pre-registered replay gates killed
// (Faultline 0/62, prose-keyed 0/55; ADR-0029 flagged this ladder suspect + deferred, and
// issue #71 supplied the field evidence — ~115 buckets, 0 durable proposals). Recurrence
// never again SELECTS what becomes a note; that judgment is the agent's, via `mage:learn`.
//
// The signal is USAGE, not keyword recurrence (ADR-0038 §2): the tally counts distinct
// chapters in which the agent actually opened the note. This makes ADR-0029's "graduating
// already-human-confirmed notes by continued usage" true for the first time, and it
// dissolves `coveringNote`'s inversion — the note is identified by the PATH READ, so a
// fuzzy wing+keyword match can no longer mint a skill from the wrong note.
//
// The merge/split/reword/demote actions are NOT emitted here — merge/split are
// judgment-constructed by the skill, reword/demote come from `mage skills --metrics`
// (context-match), not the recurrence tally.
//
// Eligible proposals are RANKED strongest-first (more chapters, then recency, then target
// asc) and only the top `promotionBudget` are surfaced — a
// bounded, deterministic stage (0.0.11): a flood of eligible signatures (which the finer
// compact-chapter unit can produce) never buries the strongest, and the rest are reported
// as `deferred` for the next pass.

import { isRejected } from "./proposals.js";
import type { Thresholds } from "./thresholds.js";
import type { NoteReadStat, Proposal, PromoteManifest, PromoteTally } from "./types.js";
import type { ScannedNote } from "../scan.js";

// ─── proposal constructors (PURE, stable — the rejected-buffer dedupe keys on these) ─

/**
 * The canonical `"graduate"` proposal for a PROVEN procedural note: `target` is the
 * note's relPath (action "graduate" acts on a note — the applier reads it + derives its
 * wing). `payload` carries what the `mage:graduate` skill shows the human; `evidence`
 * is the recurrence rationale. PURE / stable for the rejected-buffer dedupe.
 */
export function graduateProposalFor(note: ScannedNote, stat: NoteReadStat): Proposal {
  return {
    action: "graduate",
    target: note.relPath,
    payload: { note: note.relPath, wing: note.wing, type: note.type },
    evidence: `note read in ${stat.chapters} distinct chapter(s) — a proven ${note.type}, ready to graduate to a skill`,
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
  stat: NoteReadStat;
}

/**
 * Strength comparator for the promotion budget: more chapters, more recent, then target
 * asc — a TOTAL, deterministic order so the budget is stable. Lens diversity is gone with
 * the keyword fold (ADR-0038); a note read is a read, with no lens to be diverse across.
 */
function rankProposals(a: RankedProposal, b: RankedProposal): number {
  if (a.stat.chapters !== b.stat.chapters) return b.stat.chapters - a.stat.chapters;
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
  const byRelPath = new Map(notes.map((n) => [n.relPath, n]));
  let climbing = 0;

  for (const [relPath, stat] of Object.entries(tally.notes)) {
    if (stat === undefined || stat.chapters < 1) continue;
    if (stat.chapters < thresholds.graduateSessions) {
      climbing += 1; // being used, not yet proven — info only.
      continue;
    }
    // A note read enough times but since DELETED has no graduation target. Its count is
    // left in the tally rather than pruned: the note may return (a revert, a moved file),
    // and the fold is not the place to decide a note is gone for good.
    const note = byRelPath.get(relPath);
    if (note === undefined) continue;
    if (!isProcedural(note.type)) continue; // ADR-0019 §5 — procedures graduate, facts don't.

    const gp = graduateProposalFor(note, stat);
    if (isRejected(gp, rejected)) continue; // the human already declined — back off.
    eligible.push({ proposal: gp, stat });
  }

  // Rank strongest-first, then surface only the top `promotionBudget` — the rest defer.
  eligible.sort(rankProposals);
  const budget = Math.max(0, thresholds.promotionBudget);
  const surfaced = eligible.slice(0, budget);

  return {
    proposals: surfaced.map((e) => e.proposal),
    cursors: { ...cursors },
    climbing,
    deferred: eligible.length - surfaced.length,
  };
}
