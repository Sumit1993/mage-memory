// The covering-note predicate (ADR-0019 §4). PURE — no fs, no model. Answers "is
// there already a note that covers this signature?" — the catch-net's gate: a
// signature recurring in ≥ K sessions becomes a NEW-note proposal ONLY when no
// existing note already covers it (otherwise it's a merge/graduate concern, not a
// fresh note).
//
// It reuses the context-match shape (context-match.ts: a note's frontmatter
// `keywords`/`wing` vs the event's signals), pared to what a NOTE carries: notes have
// NO `paths` field, so coverage is wing + keyword overlap only. A note covers a
// signature iff the wings align (same wing, OR the signature is cross-cutting so any
// wing's note can cover it) AND at least one keyword overlaps (case-folded).
//
// Operates on ScannedNote[] from scanNotes(docsRoot) — the same note set `mage index`
// / `mage dream` walk.

import type { ScannedNote } from "../scan.js";

/** The signature shape the predicate keys on — wing + its keyword set. */
interface SigShape {
  wing: string;
  keywords: string[];
}

// ─── coveringNoteMin ───────────────────────────────────────────────────────────
//
// `coveringNote` / `isCovered` (minOverlap 1) were deleted with the keyword fold
// (ADR-0038): promote no longer maps a signature onto a note — graduation binds by the
// note PATH that was read. `staging.ts` remains, using the min-overlap form for its
// anti-flood dedup, which is a suppression gate where a loose match is cheap.

/**
 * Like {@link coveringNote}, but requires the note to share at least `minOverlap`
 * keywords with the signature (still wing-aligned). The lesson path uses a higher
 * bar than the recurrence path: with a single-wing KB, wing-alignment is always
 * true, so a 1-keyword overlap would wrongly suppress every fresh lesson sharing one
 * common token — first-sight capture must not silently drop a real lesson.
 */
export function coveringNoteMin(
  sig: SigShape,
  notes: ScannedNote[],
  minOverlap: number,
): ScannedNote | null {
  const sigKeywords = lowerSet(sig.keywords);
  if (sigKeywords.size === 0 || minOverlap < 1) return null; // keyword-less ⇒ uncoverable.
  const sigWing = sig.wing.toLowerCase();

  for (const note of notes) {
    if (!wingAligns(sigWing, note)) continue;
    if (sharedKeywordCount(sigKeywords, note.keywords) >= minOverlap) return note;
  }
  return null;
}

// ─── predicates ───────────────────────────────────────────────────────────────

/**
 * Wing alignment: a cross-cutting signature ("") aligns with EVERY note (any note can
 * cover a cross-cutting pattern); otherwise the note must be tagged under the
 * signature's wing. A note is multi-home (ADR-0012 §5), so every one of its wings is
 * checked, case-folded.
 */
function wingAligns(sigWing: string, note: ScannedNote): boolean {
  if (sigWing.length === 0) return true; // cross-cutting → any note aligns.
  if (note.wing.toLowerCase() === sigWing) return true; // fast path: primary wing.
  return note.wings.some((w) => w.wing.toLowerCase() === sigWing);
}

/** Count of DISTINCT signature keywords (already lower-cased) present in the note. */
function sharedKeywordCount(sigKeywords: ReadonlySet<string>, noteKeywords: string[]): number {
  const noteSet = new Set(noteKeywords.map((k) => k.toLowerCase()));
  let n = 0;
  for (const k of sigKeywords) {
    if (noteSet.has(k)) n++;
  }
  return n;
}

/** A case-folded Set of non-empty keywords (drops blanks defensively). */
function lowerSet(keywords: string[]): Set<string> {
  const out = new Set<string>();
  for (const k of keywords) {
    const w = k.toLowerCase();
    if (w.length > 0) out.add(w);
  }
  return out;
}
