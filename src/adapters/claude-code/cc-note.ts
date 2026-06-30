// The Claude Code note shape (ADR-0032/0033/0035) — the ONE module that knows what a
// CC native-memory note looks like and how to read mage's fields back out of it.
//
// CC owns the format of files in its memory dir and re-normalizes them after the hook
// (the restamp buries the WHOLE authored frontmatter under `metadata` and blanks
// `name`). So every place that has to recognize a CC capture, recover mage's fields,
// translate CC's vocab, or key a capture for dedup comes HERE, instead of re-deriving
// the shape:
//   - the discriminator predicate ({@link isCcShaped});
//   - the preservation recovery used at the durable boundary ({@link recoverCcFrontmatter},
//     run by flatten.ts) — recover every mage field from the top level OR from under
//     `metadata` (top-level wins), dropping CC's internal discriminators;
//   - the native→mage vocab map ({@link mapType}/{@link rewriteWikilinks}/{@link deKebab});
//   - the capture-identity key ({@link captureKey}/{@link captureSessions}/{@link ccSessionId}).
// The HARNESS-NEUTRAL nested-read (surface `metadata.*` to top for the scanner) is NOT
// here — it lives in note.ts (`effectiveFrontmatter`) so scan/dream/groom stay vocab-free
// (the neutral-core posture, ADR-0035 §6). This module layers CC vocab on top of it.
//
// PURE + deterministic (no fs, no redact, no model). ADR-0035 retired the write-time
// CC→mage frontmatter mapper that once lived here (as `schema-map.ts`); the mapping now
// happens at the durable boundary, and this module is its home.

import { type NoteFrontmatter, isoDate } from "../../note.js";
import { slugify } from "../../grooming/staging.js";

/** CC's frontmatter discriminator — present on every native-memory file, never on a mage note. */
export const CC_MEMORY_NODE_TYPE = "memory";

/** The `cc-session:<uuid>` source-pointer prefix a captured/ingested note carries. */
export const CC_SESSION_PREFIX = "cc-session:";

/** CC-only frontmatter keys — dropped (or extracted-then-dropped) on recovery. */
const CC_ONLY_KEYS = new Set(["name", "description", "metadata"]);

/** mage's canonical frontmatter key order, so recovered output matches authored notes. */
const MAGE_KEY_ORDER = [
  "type",
  "tags",
  "created",
  "updated",
  "last_reviewed",
  "status",
  "provenance",
  "sources",
  "keywords",
] as const;

/** A CC native-memory note's frontmatter (either on-disk shape — raw native or post-renorm). */
export interface CcFrontmatter extends NoteFrontmatter {
  /** kebab slug (raw native) or "" (post-renormalization, blanked by CC). */
  name?: string;
  /** one-line summary (raw native only); folds into the body when not already there. */
  description?: string;
  metadata?: {
    /** the "memory" discriminator. */
    node_type?: string;
    /** the mage type (post-renorm) or a raw CC type — mapType handles both. */
    type?: string;
    created?: string;
    /** the CC session UUID → a `cc-session:` source pointer. */
    originSessionId?: string;
    [k: string]: unknown;
  };
}

/** CC `metadata.type` → mage `type` (open vocab — alias the known ones, pass the rest through). */
const TYPE_ALIASES: Record<string, string> = {
  reference: "pointer",
  project: "note",
};

export function mapType(ccType: string | undefined): string {
  const key = (ccType ?? "").trim().toLowerCase();
  // A CC memory note is never a "gotcha" (composeDraft's default) — default to "note".
  if (!key) return "note";
  return TYPE_ALIASES[key] ?? key;
}

/**
 * Rewrite Obsidian-style `[[name]]` / `[[name|alias]]` wikilinks (CC's link form)
 * into mage's flat relative links `[alias](name.md)` — notes live flat in `notes/`
 * (ADR-0008), so the target is a sibling `<slug>.md`. Link text defaults to the
 * target name when no alias is given.
 */
export function rewriteWikilinks(body: string): string {
  return body.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_m, target: string, alias?: string) => {
      const text = (alias ?? target).trim();
      return `[${text}](${slugify(target.trim())}.md)`;
    },
  );
}

/** "wsl-rancher-container-gotchas" → "Wsl rancher container gotchas" (a readable H1). */
export function deKebab(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * True iff this frontmatter is a Claude Code capture — i.e. it carries CC's
 * `metadata.node_type: memory` discriminator. A hand-authored mage note (no nested
 * `metadata`) NEVER matches. The single CC-capture gate, shared by the inbox ingest,
 * the durable-boundary flatten, and dream's restamp-skip.
 */
export function isCcShaped(fm: NoteFrontmatter): boolean {
  const meta = (fm as CcFrontmatter).metadata;
  return !!meta && typeof meta === "object" && meta.node_type === CC_MEMORY_NODE_TYPE;
}

// ─── capture identity (dedup key; the SCOPE — within-run vs cross-run — is the caller's) ──

/** The bare CC session id a native capture was written under (raw, in `metadata.originSessionId`). */
export function ccSessionId(fm: NoteFrontmatter): string | undefined {
  const meta = (fm as CcFrontmatter).metadata;
  return typeof meta?.originSessionId === "string" ? meta.originSessionId : undefined;
}

/** A `cc-session:<id>` source pointer from a bare session id. */
export function ccSource(sessionId: string): string {
  return `${CC_SESSION_PREFIX}${sessionId}`;
}

/** The bare CC session ids carried in a note's `sources: [cc-session:<id>]` (ingest-stamped). */
export function captureSessions(fm: NoteFrontmatter): string[] {
  const sources = (fm as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  const out: string[] = [];
  for (const s of sources) {
    if (typeof s === "string" && s.startsWith(CC_SESSION_PREFIX)) out.push(s.slice(CC_SESSION_PREFIX.length));
  }
  return out;
}

/**
 * The canonical "have we already lifted/adopted this capture?" key — `<session>::<slug>`.
 * Keyed on session AND slug, never session alone: ONE Claude session legitimately writes
 * MANY distinct memories, so a session-only key would silently drop sibling captures.
 */
export function captureKey(sessionId: string, slug: string): string {
  return `${sessionId}::${slug}`;
}

/** Merge an existing `sources` array with a `cc-session:<id>` pointer, de-duped, order-stable. */
export function mergeCcSource(existing: unknown, sessionId: string | undefined): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: unknown) => {
    if (typeof s === "string" && s.length > 0 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  if (Array.isArray(existing)) for (const s of existing) push(s);
  if (sessionId) push(ccSource(sessionId));
  return out.length > 0 ? out : undefined;
}

/**
 * Recover a CC-restamped note's frontmatter to mage's neutral, flat, canonically-ordered
 * schema (FRONTMATTER ONLY — the caller keeps the body verbatim). PURE. The preservation
 * recovery the durable-boundary flatten runs: CC's restamp buries the WHOLE authored
 * frontmatter (tags, last_reviewed, sources, keywords, …) under `metadata`, so every mage
 * field is recovered from the top level OR from under `metadata` (top-level wins). Only CC's
 * internal discriminators (`node_type`, `originSessionId`) and the `name`/`description`/
 * `metadata` wrapper are dropped; `metadata.originSessionId` becomes a `cc-session:` source.
 * A nested CC `type` is mapped to mage's vocab; a top-level authored `type` is kept as-is.
 * Returns the recovered frontmatter plus the bare session id (for the caller, if needed).
 */
export function recoverCcFrontmatter(fm: NoteFrontmatter): {
  frontmatter: NoteFrontmatter;
  sessionId?: string;
} {
  const rawMeta = (fm as CcFrontmatter).metadata;
  const meta =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>)
      : {};

  // Preserve every NON-CC top-level key verbatim (a groomed note's tags/status/
  // provenance/keywords/unknown-vocab all survive); we re-derive type/created/sources.
  const preserved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!CC_ONLY_KEYS.has(k) && v !== undefined) preserved[k] = v;
  }

  // RECOVER each mage field from the top level OR from under `metadata`. Top-level wins
  // when present; otherwise pull the nested value.
  const recover = (key: string): unknown =>
    preserved[key] !== undefined ? preserved[key] : meta[key];

  const sessionId = typeof meta.originSessionId === "string" ? meta.originSessionId : undefined;
  const created = isoDate(recover("created"));
  const sources = mergeCcSource(recover("sources"), sessionId);

  // Assemble in mage's canonical key order; append any unknown-vocab keys after.
  const out: NoteFrontmatter = {};
  // type: a top-level (authored) type is kept as-is; a nested CC type is mapped.
  out.type =
    typeof preserved.type === "string" && preserved.type.trim()
      ? preserved.type.trim()
      : mapType(typeof meta.type === "string" ? meta.type : undefined);
  const tags = recover("tags");
  if (tags !== undefined) out.tags = tags as NoteFrontmatter["tags"];
  if (created) out.created = created;
  const updated = recover("updated");
  if (updated !== undefined) out.updated = updated as string;
  const lastReviewed = recover("last_reviewed");
  if (lastReviewed !== undefined) out.last_reviewed = lastReviewed as string;
  const status = recover("status");
  if (status !== undefined) out.status = status as NoteFrontmatter["status"];
  const provenance = recover("provenance");
  if (provenance !== undefined) out.provenance = provenance as NoteFrontmatter["provenance"];
  if (sources) out.sources = sources;
  const keywords = recover("keywords");
  if (keywords !== undefined) out.keywords = keywords as string[];

  // Recover any OTHER authored open-vocab keys CC buried under metadata or left at
  // top level, dropping only CC's internal discriminators + the keys handled above.
  const HANDLED = new Set<string>([...MAGE_KEY_ORDER, "node_type", "originSessionId"]);
  for (const [k, v] of Object.entries(meta)) {
    if (!HANDLED.has(k) && !(k in out) && v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(preserved)) {
    if (!HANDLED.has(k) && v !== undefined) out[k] = v; // top-level authored extras win
  }

  return { frontmatter: out, sessionId };
}
