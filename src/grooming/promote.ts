// The promote manifest builder (ADR-0019 §4/§5). PURE — no fs, no model, no network.
// The final deterministic stage of the promote core: it folds a recurrence tally,
// the repo's notes, the thresholds dial, and the rejected-edit buffer into the
// `PromoteManifest` the `mage:promote` / `mage:graduate` skills reason over.
//
// TWO LADDER RUNGS, one tally (ADR-0019 §4):
//   ① scratch → note (the catch-net): a signature becomes a "note" proposal iff it
//      recurred in >= thresholds.promoteSessions DISTINCT sessions (K), NO existing note
//      covers it, and the human has not rejected an equivalent proposal.
//   ② note → skill (graduate): a signature that IS covered by an existing note becomes a
//      "graduate" proposal iff it recurred in >= thresholds.graduateSessions sessions (M)
//      AND the covering note is PROCEDURAL (playbook/gotcha — you auto-load a procedure,
//      not a fact, ADR-0019 §5), deduped by the note's relPath, and not rejected.
// A covered signature below M is counted in `covered` (info only). The merge/split/reword/
// demote actions are NOT emitted here — merge/split are judgment-constructed by the skill,
// reword/demote come from `mage skills --metrics` (context-match), not the recurrence tally.
//
// Proposals are emitted in a STABLE order (action asc, then target asc) so the manifest is
// deterministic across runs — the skill and any snapshot test see the same sequence.

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
 * The canonical `"note"` proposal a signature would produce: `target` is the
 * signature KEY (action "note" acts on a signature, per types.ts), `payload` carries
 * the `{wing, keywords, hint}` the `mage:promote` skill drafts a note from, and
 * `evidence` is the recurrence rationale. PURE — the SAME signature always yields the
 * SAME proposal (the rejected-buffer dedupe keys on action+target, both stable here).
 */
export function noteProposalFor(key: string, stat: SignatureStat): Proposal {
  return {
    action: "note",
    target: key,
    payload: { wing: stat.wing, keywords: stat.keywords, hint: stat.hint },
    evidence: `recurred in ${stat.sessions} session(s): ${stat.hint}`,
  };
}

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

// ─── buildManifest — both ladder rungs ──────────────────────────────────────────

/**
 * Build the {@link PromoteManifest} from a folded tally, the repo's notes, the
 * thresholds, the rejected buffer, and the suggested per-session cursors. PURE — the
 * caller supplies `cursors` (the read path computes them from the tally) and they pass
 * through verbatim. See the file header for the two-rung gate. Proposals are sorted
 * (action asc, target asc) for a deterministic manifest.
 */
export function buildManifest(
  tally: PromoteTally,
  notes: ScannedNote[],
  thresholds: Thresholds,
  rejected: Proposal[],
  cursors: Record<string, number>,
): PromoteManifest {
  const proposals: Proposal[] = [];
  const graduateTargets = new Set<string>(); // note relPaths already proposed (dedupe).
  let covered = 0;

  for (const key of Object.keys(tally.signatures)) {
    const stat = tally.signatures[key];
    if (stat === undefined) continue;
    if (stat.sessions < thresholds.promoteSessions) continue; // below K — not yet recurrent.

    const sig = { wing: stat.wing, keywords: stat.keywords };
    const cover = coveringNote(sig, notes);

    if (cover !== null) {
      covered += 1; // an existing note covers it — info, never a NEW-note proposal.
      // Rung ②: a PROVEN (>= M) procedural note earns a Procedure skill (deduped).
      if (
        stat.sessions >= thresholds.graduateSessions &&
        isProcedural(cover.type) &&
        !graduateTargets.has(cover.relPath)
      ) {
        const gp = graduateProposalFor(cover, stat);
        if (!isRejected(gp, rejected)) {
          proposals.push(gp);
          graduateTargets.add(cover.relPath);
        }
      }
      continue;
    }

    // Rung ①: an UNCOVERED recurring signature → a fresh "note" proposal (unless rejected).
    const proposal = noteProposalFor(key, stat);
    if (isRejected(proposal, rejected)) continue; // the human already declined — back off.
    proposals.push(proposal);
  }

  // Stable order: action asc, then target asc — deterministic across runs.
  proposals.sort(
    (a, b) =>
      (a.action < b.action ? -1 : a.action > b.action ? 1 : 0) ||
      (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
  );

  return { proposals, cursors: { ...cursors }, covered };
}
