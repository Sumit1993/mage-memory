// Remark plugin: rewrite ```mermaid code fences into a raw HTML node
//   <pre class="mermaid" data-mage-mermaid>...graph source...</pre>
//
// The client script (src/mermaid.client.js) then renders these in the browser
// via mermaid.run(). This avoids rehype-mermaid's default `img` strategy, which
// would pull in playwright / headless chromium at BUILD time — forbidden here.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function remarkMermaidPre() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || node.lang !== 'mermaid') return;
      const html = `<pre class="mermaid" data-mage-mermaid>${escapeHtml(node.value)}</pre>`;
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
