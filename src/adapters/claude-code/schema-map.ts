// Native Claude Code memory shape → mage primitives (ADR-0032/0033/0035).
//
// PURE + deterministic helpers (no fs, no redact, no model) for translating CC's
// memory conventions into mage's: `mapType` for the type vocab, `rewriteWikilinks`
// for CC's `[[name]]` link form, `deKebab` for a readable title from a slug. Shared by
// the fresh-capture ingest path (inbox.ts `mapInboxNote`) and the durable-boundary
// normalizer (flatten.ts). ADR-0035 retired the write-time CC→mage frontmatter mapper
// that once lived here — CC re-normalizes frontmatter after the hook, so the mapping
// happened at the durable boundary instead.

import { slugify } from "../../grooming/staging.js";

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
