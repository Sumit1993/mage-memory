// The promote manifest builder (ADR-0019 §4). PURE — no fs, no model, no network.
// The final deterministic stage of the promote core: it folds a recurrence tally,
// the repo's notes, the thresholds dial, and the rejected-edit buffer into the
// `PromoteManifest` the `mage:promote` skill reasons over.
//
// THE CATCH-NET GATE (ADR-0019 §2/§4): a signature becomes a fresh "note" proposal
// iff ALL THREE hold —
//   ① it recurred in >= thresholds.promoteSessions DISTINCT sessions (the K gate),
//   ② no existing note already covers it (isCovered — otherwise it's a merge/graduate
//     concern, not a NEW note), and
//   ③ the human has not already rejected an equivalent proposal (isRejected — the
//     back-off half of the accept/reject loop, ADR-0016 §4).
// A signature at/above K that IS covered is counted in `covered` (info only — never
// proposed). Stage 1 emits ONLY the "note" action; graduate/merge/split/reword/demote
// are Stage 2/3.
//
// The proposals are emitted in a STABLE order (signature key asc) so the manifest is
// deterministic across runs — the skill and any snapshot test see the same sequence.

import { isCovered } from "./covering-note.js";
import { isRejected } from "./proposals.js";
import type { Thresholds } from "./thresholds.js";
import type {
  Proposal,
  PromoteManifest,
  PromoteTally,
  SignatureStat,
} from "./types.js";
import type { ScannedNote } from "../scan.js";

// ─── noteProposalFor — the canonical "note" proposal for a signature ────────────

/**
 * The canonical `"note"` proposal a signature would produce: `target` is the
 * signature KEY (action "note" acts on a signature, per types.ts), `payload` carries
 * the `{wing, keywords, hint}` the `mage:promote` skill drafts a note from, and
 * `evidence` is the human-readable recurrence rationale. PURE — derived solely from the
 * stat, so the SAME signature always yields the SAME proposal (the rejected-buffer
 * dedupe keys on action+target, both stable here).
 */
export function noteProposalFor(key: string, stat: SignatureStat): Proposal {
  return {
    action: "note",
    target: key,
    payload: { wing: stat.wing, keywords: stat.keywords, hint: stat.hint },
    evidence: `recurred in ${stat.sessions} session(s): ${stat.hint}`,
  };
}

// ─── buildManifest — the catch-net gate ─────────────────────────────────────────

/**
 * Build the {@link PromoteManifest} from a folded tally, the repo's notes, the
 * thresholds, the rejected buffer, and the suggested per-session cursors. For each
 * signature AT/ABOVE the recurrence gate (`stat.sessions >= thresholds.promoteSessions`):
 *   - if a note already covers it → bump `covered` (info; never proposed),
 *   - else if its canonical note-proposal is NOT already rejected → emit it,
 *   - else (rejected) → suppressed silently (the back-off).
 * Signatures BELOW the gate are ignored (not yet recurrent enough). Proposals are
 * sorted by signature key asc for a deterministic manifest. PURE — the caller supplies
 * `cursors` (the read path computes them from the tally) and they pass through verbatim.
 */
export function buildManifest(
  tally: PromoteTally,
  notes: ScannedNote[],
  thresholds: Thresholds,
  rejected: Proposal[],
  cursors: Record<string, number>,
): PromoteManifest {
  const proposals: Proposal[] = [];
  let covered = 0;

  // Stable iteration order: signature keys ascending → a deterministic manifest.
  const keys = Object.keys(tally.signatures).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const key of keys) {
    const stat = tally.signatures[key];
    if (stat === undefined) continue;
    if (stat.sessions < thresholds.promoteSessions) continue; // below K — not yet recurrent.

    const sig = { wing: stat.wing, keywords: stat.keywords };
    if (isCovered(sig, notes)) {
      covered += 1; // an existing note already covers it — info, never proposed.
      continue;
    }

    const proposal = noteProposalFor(key, stat);
    if (isRejected(proposal, rejected)) continue; // the human already declined — back off.
    proposals.push(proposal);
  }

  return { proposals, cursors: { ...cursors }, covered };
}
