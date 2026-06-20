// Client-side Mermaid for Starlight — NO headless browser, NO build-time render.
//
// A remark plugin (remark-mermaid-pre.mjs) rewrites ```mermaid fences into
//   <pre class="mermaid" data-mage-mermaid>...</pre>
// at build time. This script renders them in the browser and re-runs on
// Starlight's view transitions (astro:page-load) and theme changes, so diagrams
// survive client-side navigation and follow light/dark.

import mermaid from 'mermaid';

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'default' : 'dark';
}

let initialised = false;

function renderAll() {
  const nodes = Array.from(
    document.querySelectorAll('pre.mermaid[data-mage-mermaid]'),
  );
  if (nodes.length === 0) return;

  // Restore the raw graph source so a re-render (e.g. theme flip) starts clean.
  for (const el of nodes) {
    if (el.dataset.mageSource == null) {
      el.dataset.mageSource = el.textContent || '';
    } else {
      el.textContent = el.dataset.mageSource;
      el.removeAttribute('data-processed');
    }
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: currentTheme(),
  });
  initialised = true;

  void mermaid.run({ nodes });
}

// First load + every client-side page navigation.
document.addEventListener('astro:page-load', renderAll);

// Re-render when the Starlight theme select flips light <-> dark.
const themeObserver = new MutationObserver((records) => {
  for (const r of records) {
    if (r.attributeName === 'data-theme' && initialised) {
      renderAll();
      return;
    }
  }
});
themeObserver.observe(document.documentElement, { attributes: true });
