// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import starlightLinksValidator from 'starlight-links-validator';

import remarkMermaidPre from './remark-mermaid-pre.mjs';
import remarkRewriteMdLinks from './remark-rewrite-md-links.mjs';

const TRAILING_SLASH = 'always';

export default defineConfig({
  site: 'https://mage-memory.sfun.cloud',
  base: '/',
  trailingSlash: TRAILING_SLASH,
  // Passthrough image service: the text-first spine needs no raster optimisation,
  // and avoiding sharp keeps `astro build` free of a native image dependency (and
  // of sharp's fresh-publish supply-chain cooldown). Re-enable sharp later if a
  // page adds raster illustrations that warrant build-time optimisation.
  image: {
    service: { entrypoint: 'astro/assets/services/noop' },
  },
  markdown: {
    // remarkRewriteMdLinks makes authored `./foo.md` cross-links resolve to real
    // routes on the built site (base + trailingSlash aware); without it they 404.
    remarkPlugins: [
      remarkMermaidPre,
      [remarkRewriteMdLinks, { base: '/', trailingSlash: TRAILING_SLASH }],
    ],
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
      // Fail the build on any broken internal link or invalid #hash. This is the
      // CI guard for the relative-link rewrite (remarkRewriteMdLinks): by the time
      // the validator runs, authored `./foo.md` links are real routes, so a 404
      // means either a bad target or a rewrite bug. Runs inside `astro build`, so
      // the existing per-PR docs.yml build step is the gate (no new CI step).
      plugins: [starlightLinksValidator()],
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
            { label: 'Overview', slug: 'loop/overview' },
            { label: 'Capture (observe)', slug: 'loop/capture' },
            { label: 'The boundary nudge', slug: 'loop/nudge' },
            { label: 'Stage and groom (the lesson path)', slug: 'loop/stage-groom' },
            { label: 'Promote and graduate', slug: 'loop/promote-graduate' },
            { label: 'Autonomy levels', slug: 'loop/autonomy' },
            { label: 'Optimize (context-match)', slug: 'loop/optimize' },
          ],
        },
        {
          label: 'Guides',
          items: [
            {
              label: 'Import an existing notes folder',
              slug: 'guides/import-existing-notes',
            },
            {
              label: 'Pause, disconnect, or uninstall',
              slug: 'guides/uninstall-and-pause',
            },
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
            { label: 'Glossary', slug: 'reference/glossary' },
          ],
        },
      ],
    }),
  ],
});
