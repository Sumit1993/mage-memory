// Native Claude Code memory note → mage note schema-map (ADR-0032 §Gate-0, ADR-0033).
//
// PURE + deterministic (no fs, no redact, no model). The Gate-0 PreToolUse hook
// runs this together with `redact()` over a native CC memory write, so the file
// lands as a well-formed mage draft at the docs-root inbox before it ever touches
// disk. It reuses `composeDraft` — the SAME builder `mage stage` uses — so a
// commandeered CC capture and a CLI `mage stage` draft are shaped identically.
//
// It sets ONLY type / tags / created / body / sources. status, last_reviewed, and
// provenance.repo/commit/autonomy are stamped later at the promote chokepoint
// (`mage groom --accept`, ADR-0031) — never here.

import { composeDraft, slugify } from "../../grooming/staging.js";
import type { NoteFrontmatter } from "../../note.js";

/** A Claude Code auto-memory note's frontmatter (CC v2.1.x — observed shape). */
export interface CcMemoryFrontmatter {
  /** kebab slug, e.g. "wsl-rancher-container-gotchas". */
  name?: string;
  /** one-line human summary — mage has no field for it, so it folds into the body. */
  description?: string;
  metadata?: {
    /** constant discriminator "memory" — dropped, never mapped to a mage type. */
    node_type?: string;
    /** open vocab, e.g. "project" | "reference". */
    type?: string;
    /** the CC session UUID — kept as a `cc-session:` source pointer. */
    originSessionId?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface CcMemoryNote {
  frontmatter: CcMemoryFrontmatter;
  body: string;
}

/** Context the CC note can't carry — supplied by the adapter (ADR-0032 §2: wing is best-guessed). */
export interface SchemaMapContext {
  /** the docs-root primary wing, prepended as the note's tag (groom confirms it). */
  wing?: string;
  /** ISO date; defaults to today() inside composeDraft. */
  created?: string;
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
function deKebab(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * Map a parsed CC memory note to a mage note (frontmatter + H1 body + slug),
 * routing through the same `composeDraft` builder as `mage stage`.
 */
export function mapCcMemoryToMageNote(
  cc: CcMemoryNote,
  ctx: SchemaMapContext = {},
): { frontmatter: NoteFrontmatter; body: string; slug: string } {
  const fm = cc.frontmatter ?? {};
  const name = (fm.name ?? "").trim();
  const title = deKebab(name) || "Untitled memory note";
  const description = (fm.description ?? "").trim();

  // `description` has no mage field → fold it into the body lead so the human
  // summary survives recall (the INDEX line is auto-derived from title + keywords).
  const linked = rewriteWikilinks(cc.body ?? "");
  const body = description ? `${description}\n\n${linked}` : linked;

  const draft = composeDraft({
    title,
    type: mapType(fm.metadata?.type),
    wing: ctx.wing,
    body,
    created: ctx.created,
  });

  const sessionId =
    typeof fm.metadata?.originSessionId === "string" ? fm.metadata.originSessionId : undefined;
  const frontmatter: NoteFrontmatter = {
    ...draft.frontmatter,
    ...(sessionId ? { sources: [`cc-session:${sessionId}`] } : {}),
  };

  return { frontmatter, body: draft.body, slug: slugify(name || title) };
}
