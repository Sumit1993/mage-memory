---
type: plan
tags: [mage/roadmap]
created: "2026-06-18"
updated: "2026-06-18"
last_reviewed: "2026-06-18"
status: active
provenance:
  repo: mage-memory
  work: docs-site
keywords: [documentation, website, docs-site, astro, starlight, generated-docs, drift, github-pages, onboarding, reference, buildProgram]
---

# mage — hosted documentation website (GRILLED, ready to build)

**Status: GRILLED 2026-06-18 — decisions locked below; ready to build.** Promotes to
[ADR-0026](../decisions/0026-hosted-docs-website.md) (now accepted). A prototype on `feat/docs-site`
(uncommitted) proved the anti-drift mechanism (the drift test catches a tampered value).

## Problem

The operational model is **not answerable from one place**. "When does the nudge run?", "what is M?",
"how does a staged lesson become a note?" require reading code comments (`claude-settings.ts`,
`thresholds.ts`), ADRs, and skill files. Worse, the prose that exists has **already drifted**: the
README's "self-grooming loop" still documents the pre-0.0.12 chain (`observe → distill → promote →
graduate → optimize`) with no `nudge`/`stage`/`groom`/`.staging`, and it never states K=3 or M=5. This
is an onboarding + credibility gap right as 0.1.0 (the announcement) approaches.

## Decisions (grilled 2026-06-18 — locked)

1. **Audience:** new-user-first **public operator manual**, reference-deep. Teaches the model from zero;
   the maintainer's "what is M / when does nudge run" need is satisfied as a subset (the generated
   reference). Humans only — agents already consume `mage/` + `AGENTS.md`.
2. **Slotting:** a **non-versioned parallel track** that *targets* the 0.1.0 **announcement** but does
   **not** gate the code cut. The 0.1.0 tag / a1 bake stay behavior gates. Build now off `main`; publish
   the site when 0.0.12 hits npm so docs match the installable version. "Site live" is a prerequisite
   for *announcing* 0.1.0, not for tagging it.
3. **Stack: Astro Starlight** → static HTML → GitHub Pages (no-server, ADR-0020). Isolated under
   `docs/` with its own `package.json`/lockfile; **never in the published npm package** (`files[]` ships
   `dist/skills/.claude-plugin/assets` only), so the CLI supply chain is untouched. MDX islands cover
   the "interactive" ask (React/Svelte/Vue where useful); Starlight's built-in search/nav/dark-mode/
   code-copy are the v1 interactivity baseline.
4. **IA: the full five-section manual, built spine-first.** Ship `Start → Model → Loop → Reference`
   first (complete + covers the memory need), then add `Scenarios` and deep-concept pages:
   - **Start Here** — What is mage? · Install & Quickstart
   - **The Model** — Notes (insight·procedure·pointers) · The graph (wings & rooms) · Modes & storage
   - **The Self-Grooming Loop** — Overview (lifecycle diagram) · Capture (`observe`) · The boundary
     nudge (when & how) · Stage & groom (the lesson path) · Promote & graduate · Optimize (context-match)
   - **Reference** — Commands · Hooks *(generated)* · Thresholds & the sensitivity dial *(generated)* ·
     The `.mage/` layout · Redaction (two gates)
   - **Scenarios** — Solo in-repo KB · Hub + external projects · A lesson: capture → note · Migrating an old KB
5. **Generation reach (maximal):** facts are generated from the live code, prose stays human.
   - **Thresholds + hooks:** derived from `BASE_THRESHOLDS`/`thresholdsFor` + `MAGE_HOOKS` (prototyped).
   - **Commands:** refactor the CLI so the command registration lives in an **importable
     `buildProgram()`** (own module; `cli.ts` becomes a thin entry that builds + parses — parse path
     unchanged, so no symlinked-bin `import.meta.url` main-check risk). The generator walks
     `program.commands` for the full structured inventory (name, summary, **options**, hidden) →
     drift-tested. Rich per-command **examples are hand-written.**
   - **Hand-written (near-static):** `.mage/` layout, redaction two-gate. **Stamped:** the mage version
     (from `package.json`) into the build.
6. **README:** leave as-is until the site lands, then **fix + slim in one combined pass** — README →
   pitch + quickstart + links; the site owns the deep model/loop/command reference. One drift-tested
   home for depth (no duplication to re-drift).
7. **Hosting + staging:** GH Pages **default project subpath** (`<you>.github.io/mage-memory/`);
   `site`/`base` configured so a custom domain can be added later (CNAME + DNS) without link churn.
   **One hosted site = the latest *published* npm release** — **deploy on release** (release-please tag /
   publish), so a new user reads docs matching what `npm i -g mage-memory` gave them (new-user-first).
   **Unpublished changes are local-preview + CI-validated only** — every PR runs the drift test + an
   `astro build` check, and the maintainer previews with `pnpm dev`; there is **no second hosted site**.
   **Latest-only** (no per-version doc archive). A public **`/next` preview channel is deferred
   post-0.1.0**, added only if external contributors need to see unreleased docs. Escape hatch for an
   urgent prose-only fix between releases: a manual Pages redeploy from the latest release tag.
8. **Diagrams:** **Mermaid** for the technical lifecycle/flow/layout diagrams (text-based, diffable,
   low-maintenance; rendered the lightest clean way — no headless browser in CI) **+ one or two
   hand-designed concept illustrations** on the landing/overview for new-user warmth.
9. **Enforcement:** the **CI drift test is the contract** — no new pre-commit hook (the Gate-2 hook
   stays the only one). The Pages workflow runs `pnpm docs:gen` before deploy as belt-and-suspenders.
   `pnpm docs:gen` fixes a failing drift test.

## Build sequence — 4 focused PRs (all off `main`, rebased after the `.mage/` fold #31 merges)

1. **`buildProgram()` refactor** — extract command registration into an importable builder; `cli.ts`
   becomes a thin entry. Independently valuable (the CLI becomes unit-testable). Guarded by the existing
   CLI tests + the CI `smoke` job (which exercises the symlinked bin). No behavior change.
2. **Generator + drift test** — `src/docs/generated-data.ts` (thresholds + hooks + commands-via-
   `buildProgram`), committed `docs/src/generated/mage-data.json`, vitest drift test, `pnpm docs:gen`.
3. **The Starlight site** — `docs/` sub-project + spine-first content (Start/Model/Loop/Reference) +
   Mermaid diagrams + the GH Pages deploy workflow (**deploy on release**; a separate `astro build`
   check runs on every PR). Scenarios + concept pages follow.
4. **README slim + fix** — pitch + quickstart + links, timed with the site going live.

## Out of scope (v1)

Doc versioning; i18n; a search backend beyond Starlight's built-in (Pagefind); embedding the live
dashboard; auto-generating prose (only *facts* are generated — narrative stays human, like notes);
custom domain (future-proofed, not bought).

## Relations

- extends [release sequence](plan-release-sequence.md) — a 0.1.0 credibility-push track.
- promotes_to [ADR-0026 — a hosted docs website](../decisions/0026-hosted-docs-website.md)
- motivated_by README drift (the pre-0.0.12 loop section) + [ADR-0024](../decisions/0024-organic-grooming-loop.md) (the lesson path the README omits)
- hosts_like [ADR-0020 — no-server, generated artifacts](../decisions/0020-no-server-tiered-dashboards.md)
