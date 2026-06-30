// Remark plugin: rewrite ```mermaid code fences into an accessible figure
//   <figure class="mage-diagram" role="img" aria-label="<caption>">
//     <pre class="mermaid" data-mage-mermaid>...graph source...</pre>
//     <figcaption><caption></figcaption>
//   </figure>
//
// The client script (src/mermaid.client.js) then renders the <pre> in the
// browser via mermaid.run(). This avoids rehype-mermaid's default `img` strategy,
// which would pull in playwright / headless chromium at BUILD time — forbidden here.
//
// Accessibility / search (a11y review): a client-rendered Mermaid SVG has no alt
// text, is invisible with JS off, and is opaque to full-text search. The wrapper
// fixes all three: `role="img"` + `aria-label` give screen readers a single
// labelled image (instead of reading raw mermaid syntax), the visible
// <figcaption> describes the diagram for sighted and no-JS readers, and both the
// caption prose and the retained source text are indexed by Pagefind.
//
// Author a caption in the fence info string after the language, e.g.:
//   ```mermaid The self-grooming loop: work -> capture -> groom -> notes.
// With no caption it falls back to a generic "Diagram" label (still better than
// exposing raw syntax to assistive tech).

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export default function remarkMermaidPre() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || node.lang !== 'mermaid') return;
      const caption = (node.meta || '').trim();
      const label = caption || 'Diagram';
      const pre = `<pre class="mermaid" data-mage-mermaid>${escapeHtml(node.value)}</pre>`;
      const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
      const html = `<figure class="mage-diagram" role="img" aria-label="${escapeAttr(label)}">${pre}${figcaption}</figure>`;
      parent.children[index] = { type: 'html', value: html };
    });
  };
}

// Tiny inline tree walker so we add no extra dependency (unist-util-visit ships
// with Astro's remark stack, but inlining keeps this plugin self-contained).
function visit(node, type, visitor) {
  const walk = (n, index, parent) => {
    if (n.type === type) visitor(n, index, parent);
    if (Array.isArray(n.children)) {
      // Iterate over a snapshot so in-place replacement is safe.
      const kids = n.children.slice();
      for (let i = 0; i < kids.length; i++) {
        walk(kids[i], i, n);
      }
    }
  };
  walk(node, null, null);
}
