---
type: decision
tags: [mage/decisions]
created: "2026-06-18"
updated: "2026-06-18"
last_reviewed: "2026-06-18"
status: accepted
provenance:
  repo: mage-memory
  work: docs-site
sources:
  - src/grooming/thresholds.ts
  - src/claude-settings.ts
  - src/cli.ts
  - README.md
  - mage/notes/plan-docs-site.md
  - mage/decisions/0020-no-server-tiered-dashboards.md
  - mage/decisions/0024-organic-grooming-loop.md
---

# 0026 — A hosted documentation website, generated from code

**Status: accepted (drafted + GRILLED 2026-06-18). The locked decisions — audience, slotting, stack,
IA, generation reach, README, hosting, sequencing, diagrams — live in
[plan-docs-site](../notes/plan-docs-site.md).**

## Context — the model isn't answerable from the docs

mage's operational model is spread across code comments (`claude-settings.ts`, `thresholds.ts`), 25
ADRs, and skill files, with no single readable reference. "When does the nudge fire?", "what is M?",
"how does a staged lesson become a note?" each require a code dive. And the prose that exists has
**already drifted**: the README's self-grooming-loop section documents the *pre-0.0.12* chain
(`observe → distill → promote → graduate → optimize`) with no `nudge`/`stage`/`groom`/`.staging`, and
it never states K=3 or M=5. With 0.1.0 (the announcement) approaching, this is an onboarding +
credibility gap — and the drift itself proves hand-written prose can't be the only mechanism.

## Decision

Build a **hosted documentation website** whose **volatile facts are generated from the live code and
guarded by a drift test** — so the reference cannot silently diverge from the implementation.

1. **A static docs site — Astro Starlight** — under `docs/`, isolated with its own
   `package.json`/lockfile, built to static HTML and **hosted on GitHub Pages** (default project
   subpath; no server — on-brand with ADR-0020). New-user-first, navigable, illustrated (Mermaid +
   a couple of designed pieces); narrative + scenarios authored by hand.
2. **Code → data → site.** A pure builder (`src/docs/generated-data.ts`) derives the threshold + dial
   tables (from `BASE_THRESHOLDS`/`thresholdsFor`) and the hook table (from `MAGE_HOOKS`); the **command
   inventory** (names, summaries, options, hidden flags) comes from an importable **`buildProgram()`**
   (the CLI's command registration extracted into its own module — `cli.ts` stays a thin build+parse
   entry, so the parse path is unchanged and there is no symlinked-bin main-check risk). All of it
   lands in a committed `docs/src/generated/mage-data.json` the site renders. **Only facts are
   generated; prose + per-command examples stay human** (the same rule as notes — capture insight,
   not copies).
3. **Drift fails CI.** A vitest test re-derives the data from `src/` and fails if the committed JSON is
   stale; `pnpm docs:gen` regenerates it. A threshold/hook/command change that skips regeneration breaks
   the build, not the reader's trust.

**Principle:** *the docs site states no load-bearing number, hook, or command that isn't derived from
(or checked against) the code it documents. Drift is a failing test, not a discovery six weeks later.*

## Why

- **Single source of truth, mechanically enforced.** The maintainer's requirement was explicit:
  "based on real code so that drifts are small." A generator + CI test delivers that; citations or
  discipline don't.
- **Fits the house style.** The repo is test-heavy (900+ tests, CI-gated) and no-server (ADR-0020);
  a drift test and a static, self-contained site are both idiomatic here.
- **Separates concerns cleanly — four distinct surfaces.** ADRs are the *why* (decision record); the
  **docs site** is the *how it works* (the product manual); the **README** is the *pitch + quickstart*
  that links to the site; the **Dashboard** (ADR-0020) stays a *per-KB generated view of one KB's
  contents* — NOT product docs. Naming the four stops the conflation that let the README drift, and
  keeps "docs site" from blurring into the glossary's `Dashboard`/`Index`.

## Consequences

- **Positive:** the model is answerable in one navigable place; the facts can't drift past CI; 0.1.0
  gets an announceable docs surface.
- **Cost:** a second toolchain (Astro/Starlight deps) — accepted only because it is **fully isolated
  under `docs/`** so the published CLI's supply chain is untouched; a new CI deploy workflow; ongoing
  authoring of the narrative/scenario pages.
- **Neutral:** generation covers *facts*, not narrative — the lifecycle prose, scenarios, and
  illustrations are still written and maintained by hand (bounded, like the notes themselves).

## Alternatives considered

- **A single `docs/` markdown file with code citations.** Rejected for the website requirement
  (interactive/navigable/illustrated) and because citations make drift *visible*, not *blocked*.
- **Expand the README in place.** Rejected: an already-long README grows unwieldy, and a flat README
  isn't the navigable, example-rich surface asked for (it's also where the drift happened).
- **Hand-write everything, no generator.** Rejected: it is exactly the failure mode that produced the
  stale README loop section.
- **VitePress / Docusaurus** instead of Starlight — considered and rejected in the grill (2026-06-18):
  VitePress is leaner but Vue-only for components; Docusaurus is the heaviest config/deps. Starlight
  won on best batteries-included docs theme + MDX islands (incl. React) for the new-user-first goal.
- **Generate the command table by parsing `mage --help` text, or only name-set-check it** — rejected in
  the grill for the **maximal** option: the `buildProgram()` refactor yields the full structured
  inventory (incl. options) and makes the CLI unit-testable, worth the one-time entry-point change.
- **Custom domain / doc versioning at launch** — deferred: default GH Pages subpath, latest-only;
  `site`/`base` are future-proofed so a domain can be added later without link churn.
- **A second hosted "next" site for unpublished docs** — rejected for v1 (grilled 2026-06-18): one
  hosted site tracks the latest *published* release (**deploy on release**), so new users read docs
  matching what they installed. Unpublished docs are CI-validated (drift test + `astro build` per PR)
  and previewed locally (`pnpm dev`) — not hosted. A `/next` channel is a post-0.1.0 option.

## Relations

- **detailed_by** [plan-docs-site](../notes/plan-docs-site.md) — the 9 locked grill decisions (audience,
  slotting, stack, IA, generation reach, README, hosting, sequencing, diagrams) + the 4-PR build sequence.
- **hosts_like** [ADR-0020](0020-no-server-tiered-dashboards.md) — no-server, generated static artifact
  rendered for humans.
- **documents** [ADR-0024](0024-organic-grooming-loop.md) — the lesson path (nudge → stage → groom) the
  current README omits; the site's lifecycle page is its operator-facing rendering.
- **relates_to** [ADR-0021](0021-offline-no-telemetry-local-signal.md) — static, offline, no phone-home.
