// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import remarkMermaidPre from './remark-mermaid-pre.mjs';

// GitHub Pages: project subpath today, future-proofed for a custom domain.
// Repo Sumit1993/mage-memory -> https://sumit1993.github.io/mage-memory/
export default defineConfig({
  site: 'https://sumit1993.github.io',
  base: '/mage-memory',
  // Trailing-slash 'always' keeps base-aware relative links predictable on Pages.
  trailingSlash: 'always',
  // Passthrough image service: the text-first spine needs no raster optimisation,
  // and avoiding sharp keeps `astro build` free of a native image dependency (and
  // of sharp's fresh-publish supply-chain cooldown). Re-enable sharp later if a
  // page adds raster illustrations that warrant build-time optimisation.
  image: {
    service: { entrypoint: 'astro/assets/services/noop' },
  },
  markdown: {
    remarkPlugins: [remarkMermaidPre],
  },
  integrations: [
    starlight({
      title: 'mage',
      description:
        'Durable, self-maintaining memory for AI coding agents: portable git-backed markdown notes you own, navigable as an Obsidian graph.',
      logo: {
        src: './src/assets/mage-mark.svg',
        alt: 'mage',
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/brand.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Sumit1993/mage-memory',
        },
      ],
      // Override Starlight's <head> to bundle + load the client-side Mermaid
      // init (Vite bundles the <script> in MermaidHead.astro; no headless
      // browser, no build-time render).
      components: {
        Head: './src/components/MermaidHead.astro',
      },
      sidebar: [
        {
          label: 'Start Here',
          items: [
            { label: 'What is mage?', slug: 'index' },
            { label: 'Install and Quickstart', slug: 'start/quickstart' },
          ],
        },
        {
          label: 'The Model',
          items: [
            { label: 'Notes', slug: 'model/notes' },
            { label: 'The graph: wings and rooms', slug: 'model/graph' },
            { label: 'Modes and storage', slug: 'model/modes' },
          ],
        },
        {
          label: 'The Self-Grooming Loop',
          items: [
            { label: 'The self-grooming loop', slug: 'loop/overview' },
            { label: 'Capture (observe)', slug: 'loop/capture' },
            { label: 'The boundary nudge', slug: 'loop/nudge' },
            { label: 'Stage and groom (the lesson path)', slug: 'loop/stage-groom' },
            { label: 'Promote and graduate', slug: 'loop/promote-graduate' },
            { label: 'Autonomy levels', slug: 'loop/autonomy' },
            { label: 'Optimize (context-match)', slug: 'loop/optimize' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Commands', slug: 'reference/commands' },
            { label: 'Hooks', slug: 'reference/hooks' },
            {
              label: 'Thresholds and the sensitivity dial',
              slug: 'reference/thresholds',
            },
            { label: 'The .mage/ layout', slug: 'reference/layout' },
            { label: 'Redaction (two gates)', slug: 'reference/redaction' },
          ],
        },
      ],
    }),
  ],
});
