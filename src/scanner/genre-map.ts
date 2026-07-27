// Closed type-to-genre mapping for recall rungs and doctor annotations (ADR-0041 §2).

export type Genre = "memory" | "decision" | "work" | "doc" | "unclassified";

/**
 * Closed map from note `type:` to `Genre` (ADR-0041 §2).
 *
 *  - memory: gotcha, procedure, pointer, principle, feedback, reference, note
 *  - decision: decision
 *  - work: plan, tasks
 *  - doc: spec, doc
 */
export const TYPE_TO_GENRE: Readonly<Record<string, Genre>> = Object.freeze({
  gotcha: "memory",
  procedure: "memory",
  pointer: "memory",
  principle: "memory",
  feedback: "memory",
  reference: "memory",
  note: "memory",
  decision: "decision",
  plan: "work",
  tasks: "work",
  spec: "doc",
  doc: "doc",
});

/**
 * Resolve a note's `type:` string to its `Genre`.
 * Falls back to "unclassified" if missing or unrecognized.
 */
export function genreOf(type: string | undefined): Genre {
  if (!type) return "unclassified";
  return TYPE_TO_GENRE[type] ?? "unclassified";
}
