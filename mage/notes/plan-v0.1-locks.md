---
type: principle
tags: [mage/plan]
created: "2026-05-29"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
keywords: [naming, brand, mage, npm, package, mage-memory, bin, locks, authority, schema]
---

# mage v0.1 — finalized locks (read alongside PLAN-v0.1.md)

Post-plan decisions that supersede the PLAN "Open implementation questions" and any loose name references elsewhere. **This file is the authority on naming.**

1. **Brand = MAGE** — backronym "**M**emory for **AGE**nts." Product + CLI = `mage`.
2. **npm package = `mage-memory`** (exact `mage` is taken on npm; `mage-memory` is exact-free). **CLI command = `mage`**, via `bin`:
   ```jsonc
   { "name": "mage-memory", "bin": { "mage": "dist/cli.js" } }
   ```
   `npm i -g mage-memory` puts `mage` on PATH; `npx mage-memory` also runs it (single bin). Same name≠command decoupling ECC uses (`name: ecc-universal`, `bin.ecc`).
   - **Wherever another doc calls the npm package `mage`, it means `mage-memory`.** The product + command are `mage`.
   - Data dir = `mage/` (visible — **revised by [ADR-0008](../decisions/0008-visible-mage-dir-for-obsidian.md)**; was `.mage/` in v0.1, un-dotted so the in-repo base opens as an Obsidian vault); metadata schema = `mage.v1`; skills namespaced `/mage:learn`, `/mage:dream`, etc.
   - `src/cli.ts`: `.name("mage")`; help shows `mage`.
3. **MAP.md → DROPPED** (PLAN Open Q#4): the Obsidian graph + hierarchical INDEX cover topology. Remove MAP.md scaffolding from `init`/`scaffoldHubStructure` and any awareness-skill references.
4. **Constitution → a `principle` note** (PLAN Open Q#5): `type: principle` in `notes/`; drop `.specify/memory/`. The `/constitution` skill writes/updates a principle note; awareness read-order references principle notes instead of `constitution.md`.

Build handoff = [PLAN-v0.1](plan-v0.1.md) + this file + [decisions 0001–0006](../decisions/0001-memory-first-product-supersedes-specshub.md) + [context & glossary](context.md).

## Relations
- governs [mage v0.1 implementation plan](plan-v0.1.md)
- see_also [mage roadmap](roadmap.md)
- revised_by [ADR-0008 — visible mage/ dir for Obsidian](../decisions/0008-visible-mage-dir-for-obsidian.md)
