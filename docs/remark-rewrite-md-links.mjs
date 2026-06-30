// Remark plugin: rewrite relative Markdown cross-links (`./foo.md`, `../bar.mdx`,
// `baz.md`) into real Starlight routes that honor `base` + `trailingSlash`.
//
// Why this exists: Astro does NOT rewrite relative `.md`/`.mdx` links to routes.
// With `trailingSlash: 'always'` a link like `./autonomy.md` on the page
// `/mage-memory/loop/nudge/` resolves to `/mage-memory/loop/nudge/autonomy.md`
// — a 404 on the built site (invisible in `astro dev`, which is slug-routed).
// Authoring links as `./autonomy.md` keeps them working in Obsidian / GitHub /
// editor preview (mage's interlinked-notes pitch); this plugin makes the SAME
// links resolve on the published site. It also normalizes `.md` vs `.mdx`
// target-extension mismatches for free, since the slug drops the extension.
//
// Pass `{ base, trailingSlash }` from astro.config.mjs so there is one source of
// truth for both values.

import path from 'node:path';

const DOCS_ROOT_MARKER = path.join('src', 'content', 'docs');

// Anything we must NOT touch: protocol/absolute (`https:`, `mailto:`), site-root
// (`/foo`), or pure in-page anchors (`#section`). Only same-/parent-dir relative
// targets ending in `.md`/`.mdx` (optionally with `#anchor`/`?query`) are rewritten.
const SKIP = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
const MD_TARGET = /^([^#?]*?\.mdx?)([#?].*)?$/i;

export default function remarkRewriteMdLinks(options = {}) {
  const base = String(options.base ?? '').replace(/\/+$/, '');
  const trailingSlash = options.trailingSlash ?? 'always';

  return (tree, file) => {
    const filePath =
      file?.path ??
      (Array.isArray(file?.history) ? file.history[file.history.length - 1] : undefined);
    if (!filePath) return;

    const markerAt = filePath.lastIndexOf(DOCS_ROOT_MARKER);
    if (markerAt === -1) return; // not a docs content file — leave untouched
    const docsRoot = filePath.slice(0, markerAt + DOCS_ROOT_MARKER.length);
    const srcDir = path.dirname(filePath);

    const toRoute = (url) => {
      if (!url || SKIP.test(url)) return url;
      const m = url.match(MD_TARGET);
      if (!m) return url;
      const [, target, suffix = ''] = m;

      // Resolve the relative target against this file's directory, then express
      // it as a slug relative to the docs root with the extension stripped.
      const absTarget = path.resolve(srcDir, target);
      let slug = path
        .relative(docsRoot, absTarget)
        .split(path.sep)
        .join('/')
        .replace(/\.mdx?$/i, '')
        .toLowerCase(); // Starlight lowercases slugs
      // `index` maps to its containing directory (root index -> '').
      slug = slug.replace(/(^|\/)index$/i, '');

      let route = `${base}/${slug}`.replace(/\/{2,}/g, '/');
      if (trailingSlash === 'never') route = route.replace(/\/+$/, '') || '/';
      else if (!route.endsWith('/')) route += '/'; // 'always' (and the safe default)

      return route + suffix;
    };

    walk(tree, (node) => {
      // Inline links and reference-style link definitions both carry a `url`.
      if (node.type === 'link' || node.type === 'definition') {
        node.url = toRoute(node.url);
      }
    });
  };
}

// Dependency-free mdast walker (mirrors remark-mermaid-pre.mjs — keeps the docs
// build free of an extra unist-util-visit dependency).
function walk(node, visitor) {
  visitor(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visitor);
  }
}
