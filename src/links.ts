/**
 * Link extraction utilities shared across dream.ts and the overlap scanner.
 *
 * Originally private in dream.ts (lines 86–111); lifted here so the overlap
 * scanner (src/scanner/overlap.ts) can reuse the SAME link-extraction logic
 * without duplicating it. dream.ts imports from here — behaviour is unchanged.
 */

/**
 * A `.md` link target plus an optional `#heading` fragment. The fragment is matched but
 * NOT captured: `plan.md#the-autonomy-track` addresses a section of a file whose existence
 * is still decided by `plan.md` alone.
 */
const MD_TARGET = String.raw`([^)\s]+\.md)(?:#[^\)\s]*)?`;
const LINK_RE = new RegExp(String.raw`\]\(${MD_TARGET}\)`, "g");

/**
 * An external target is not a path on disk. `https://github.com/e2b-dev/infra/blob/main/self-host.md`
 * ends in `.md`, but resolving it against the linking note yields nonsense, so it must never
 * reach the exists() check.
 */
function isExternal(target: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

/** All *local* markdown links to `.md` targets, fragment stripped. */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1]?.trim();
    if (target && !isExternal(target)) out.push(target);
  }
  return out;
}

/**
 * An Obsidian wikilink: `[[target]]`, `[[target#heading]]`, `[[target^block]]`,
 * `[[target|alias]]`, `[[dir/target]]`. Only the target is captured. A same-file link
 * (`[[#heading]]`) has an empty target and is deliberately not matched.
 */
const WIKI_TARGET = String.raw`\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?]]`;
const WIKI_RE = new RegExp(WIKI_TARGET, "g");

/** All wikilink targets, alias + fragment stripped. */
export function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(WIKI_RE)) {
    const target = m[1]?.trim();
    if (target) out.push(target);
  }
  return out;
}
