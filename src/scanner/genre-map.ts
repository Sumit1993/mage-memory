import { logger } from "../logger.js";

// Closed type-to-genre mapping for recall rungs and doctor annotations (ADR-0041 §2).

export type Genre = "memory" | "decision" | "work" | "doc" | "unclassified";

export const VALID_GENRES: ReadonlySet<Genre> = Object.freeze(
  new Set<Genre>(["memory", "decision", "work", "doc"]),
);

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
 * Resolve/validate user-provided `genres` overrides from metadata.json (ADR-0041 §3).
 *
 * Rules:
 *  - Built-in types in TYPE_TO_GENRE are immutable; attempts to remap them are ignored.
 *  - Target genre values MUST be one of: "memory" | "decision" | "work" | "doc".
 *  - Ignored entries emit a warning line via `logger.warn` when logWarn is true.
 */
export function resolveGenreOverrides(
  rawOverrides?: Record<string, string>,
  logWarn = false,
): Record<string, Genre> {
  if (!rawOverrides || typeof rawOverrides !== "object") return {};

  const resolved: Record<string, Genre> = {};
  for (const [typeKey, targetGenre] of Object.entries(rawOverrides)) {
    if (typeKey in TYPE_TO_GENRE) {
      if (logWarn) {
        logger.warn(
          `Ignoring genre override for "${typeKey}": built-in types are immutable.`,
        );
      }
      continue;
    }
    if (!VALID_GENRES.has(targetGenre as Genre)) {
      if (logWarn) {
        logger.warn(
          `Ignoring genre override for "${typeKey}": target genre "${targetGenre}" is invalid (must be memory, decision, work, or doc).`,
        );
      }
      continue;
    }
    resolved[typeKey] = targetGenre as Genre;
  }
  return resolved;
}

/**
 * Resolve a note's `type:` string to its `Genre`.
 * Falls back to "unclassified" if missing or unrecognized.
 * Takes optional resolved or raw overrides from metadata.json (ADR-0041 §3).
 */
export function genreOf(
  type: string | undefined,
  overrides?: Record<string, Genre> | Record<string, string>,
): Genre {
  if (!type) return "unclassified";
  const builtIn = TYPE_TO_GENRE[type];
  if (builtIn) return builtIn;
  if (overrides && type in overrides) {
    const val = overrides[type];
    if (val && VALID_GENRES.has(val as Genre)) return val as Genre;
  }
  return "unclassified";
}
