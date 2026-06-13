---
type: decision
tags: [mage/decisions]
created: "2026-06-13"
updated: "2026-06-13"
last_reviewed: "2026-06-13"
status: active
provenance:
  repo: mage-memory
  work: 0.0.10-coherence-tiers-sdd
sources:
  - skills/
  - .claude-plugin/plugin.json
  - .claude-plugin/marketplace.json
  - README.md
---

# 0022 — Remove the spec-kit-derived SDD skills

mage shipped seven spec-driven-development (SDD) skills carried over from the
specshub fork — `mage:specify`, `mage:clarify`, `mage:plan`, `mage:tasks`,
`mage:implement`, `mage:analyze`, `mage:constitution` (~1085 lines under
`skills/`). The founding fork decisions ([ADR-0001](0001-memory-first-product-supersedes-specshub.md),
[ADR-0002](0002-fork-and-reorient-specshub.md)) **named this prune and deferred it**:
the reorientation from specshub to mage made the memory loop the product, and the SDD
workflow was kept only as inherited scaffolding.

By 0.0.10 the SDD skills had become dead weight and an active drag on coherence:

- **Stale + broken.** They reference `.specify/...` paths that mage no longer
  scaffolds, and their `.specify/`-based artifact layout never matched mage's
  `work/<slug>/` work units.
- **Isolated from the memory loop.** They are forward-authoring (greenfield intent)
  commands with no tie to capture → distill → promote → graduate; they do not read or
  write the `.learnings/`/notes substrate that defines mage.
- **Identity blur.** Advertising "spec-driven development" alongside "self-maintaining
  knowledge base" muddies the memory-first positioning the project is built on.

## Decision

1. **Delete all seven SDD skill directories** under `skills/`
   (`specify`, `clarify`, `plan`, `tasks`, `implement`, `analyze`, `constitution`).
   The kept skills are the memory loop: `learn`, `distill`, `promote`, `graduate`,
   `optimize`, plus `guide`. `ATTRIBUTION.md`'s spec-kit section is converted to
   **historical** (the MIT credit is retained for releases 0.0.1–0.0.9, which shipped
   the adapted work); the `vercel-labs/skills` attribution there is untouched.

2. **Strip the SDD advertising** from every surface: `.claude-plugin/plugin.json`
   and `.claude-plugin/marketplace.json` descriptions, and the two README mentions
   (the install blurb and the skills table). The marketplace/plugin blurbs now describe
   only capture + the self-grooming loop + `guide`.

3. **The `Spec`/`Plan`/`Tasks` note *types* stay.** Removing the SDD *skills* (the
   workflow commands) does not remove a user's ability to author spec/plan/tasks *notes*
   — those remain in the note-type vocabulary ([context.md](../notes/context.md)). What
   goes is the bundled greenfield workflow, not the note classification.

## Consequences

- `mage skills` reads `skills/` dynamically (no hard-coded list), so installs simply
  carry six skills instead of thirteen; no code change is required for the removal.
- The memory-first identity sharpens: every shipped skill now serves the
  capture → curate → graduate loop or explains it (`guide`).
- A consumer who relied on `mage:specify …` loses it. This is acceptable — the skills
  were stale and unsupported; spec-kit itself remains available upstream.

## Relations

- completes [ADR-0001](0001-memory-first-product-supersedes-specshub.md) / [ADR-0002](0002-fork-and-reorient-specshub.md) (the deferred prune)
- part_of [0.0.10 coherence plan](../notes/plan-0.0.10-coherence.md) (Decision 10)
