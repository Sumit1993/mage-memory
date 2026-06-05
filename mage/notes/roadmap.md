---
type: plan
tags: [mage/roadmap]
created: "2026-05-29"
updated: "2026-06-05"
last_reviewed: "2026-06-05"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
keywords: [roadmap, v0.1, v0.2, dream, scope, deferred, release, mcp, hub]
---

# mage — roadmap

> Scope line set 2026-05-29 (grill-with-docs session). Decisions: [ADR-0001](../decisions/0001-memory-first-product-supersedes-specshub.md)–0014 — latest: [0011 recursive scan](../decisions/0011-recursive-scan-hub-projects.md), [0012 wings optional](../decisions/0012-wings-optional-convention-standalone-hubs.md), [0013 procedure skills + self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md), [0014 two-gate redaction](../decisions/0014-two-gate-redaction.md). What to mine from agentmemory: [mining map](agentmemory-mining-map.md). Language: [context & glossary](context.md). Founding design research was distilled into these notes; the raw research is author-local and not version-controlled here.

## v0.1 — the durable, portable, navigable knowledge base (the founding value)
- **Fork specshub → mage**: rename `.specshub/`→`mage/`, schema, CLI/package/awareness skill; **carry** modes (in-repo/external/hybrid), metadata, hub registry, commit hygiene, SDD skills (specs = a work type) [ADR-0002].
- **Vault**: `mage/{notes/, work/<slug>/(artifacts/ ignored), decisions/, archive/, INDEX.md, .obsidian/}`; track work+notes, git-ignore `artifacts/` + `.learnings/` [ADR-0003].
- **Note** = just-markdown + suggested `type` + `#wing/room` tag [Q5]; **Obsidian-native** portable `[text](path.md)` links + frontmatter + tags.
- **Capture-by-pointer**: insight/procedure/pointers, `sources:`, not copies [ADR-0004].
- **`mage index`** → hierarchical INDEX (root + per-wing) [ADR-0006].
- **Skills**: awareness + `learn` (explicit, human-confirm) + **one-per-wing** [ADR-0006].
- **Cheap anti-staleness only**: notes carry `last_reviewed`/`provenance.commit`; awareness treats notes as point-in-time ("verify stale notes vs current code"); on-write overlap/contradiction check in `/learn`.
- **Coexistence**: mage canonical; native auto-memory left as-is (no harvest bridge yet) [ADR-0005].

## 0.0.x → 0.1.0 — the self-grooming loop (the path to the milestone)

A 2026-06-05 **mega-grill** folded eight idea-clusters — automated skill creation,
usage/context optimization (mining Microsoft **SkillOpt** + ECC's instinct loop),
secret **redaction**, ECC-style skill **grouping**, **ingest** of existing skills, learn
**automation**, and an **icon/visualization** — into a single horizon. **0.1.0 ships the
full capture → graduate → optimize loop**, all human-committed; nothing is crowned 1.0.
The dependency-ordered build is the [release sequence](plan-release-sequence.md); the
model is [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) (procedure
skills + the loop) + [ADR-0014](../decisions/0014-two-gate-redaction.md) (two-gate redaction).

- **Shipped in 0.0.2** (was "v0.2+ deferred"): recursive scan, multi-home wings,
  hub-project indexing, `link` external awareness, hub generalization —
  [ADR-0011](../decisions/0011-recursive-scan-hub-projects.md) /
  [ADR-0012](../decisions/0012-wings-optional-convention-standalone-hubs.md).
- **Carried into the 0.1.0 path** (no longer "deferred"): full `/dream` healing sweep,
  opt-in auto-capture (observe → connect → distill → promote → **graduate**),
  `mage:learn --from` (prose/transcripts **+ existing skills**), MCP recall, Obsidian
  dashboards — each now slotted in the [release sequence](plan-release-sequence.md).
- **New in this horizon**: the **Procedure skill** (a graduated note), `/mage-optimize`
  (SkillOpt's *rails* — bounded edits, rejected-edit buffer, context-match gate —
  human-confirmed), two-gate redaction, and Claude Code **plugin** distribution
  (the `mage:` namespace keeps skill names clean — `mage:learn`, `mage:specify`, …).

## Deferred past 0.1.0 (unplanned future 0.x — no 1.0)
- **Literal SkillOpt bridge** — export skills+trajectories to the SkillOpt optimizer,
  import `best_skill.md`; a real training loop (model backends, epochs, labeled splits)
  → opt-in, **out-of-core**. mage ships SkillOpt's *rails* in-loop, not its harness
  [ADR-0013].
- **Multi-repo hub graph aggregation + cross-repo `/dream`** — ADR-0012 §2 rejects
  content/graph aggregation; only registry-pointer memory aggregation survives, and it
  needs its own grill [ADR-0010/0012].

## Out of scope (the sharp "no")
- **Multi-agent coordination** — leases / signals / actions / routines / task queues. mage is durable memory, not an orchestration layer [ADR-0010].
- **A server / daemon / vector DB in core** — files-as-truth; vector is at most an opt-in MCP accelerator [ADR-0001/0003/0005/0009].

## Pre-release chores
- npm: `deprecate specshub` → mage (full `unpublish` only if still within npm's 72h window); archive the specshub GitHub repo with a pointer to mage.
- Verify `mage-memory` at publish (npm similarity filter) — exact name + GitHub confirmed free 2026-05-29.

## Relations
- realizes [ADR-0003 — track work, ignore artifacts](../decisions/0003-track-work-ignore-artifacts.md)
- realizes [ADR-0006 — two-layer recall](../decisions/0006-two-layer-recall-per-wing-skills.md)
- v0.2_informed_by [ADR-0007 — mine agentmemory's design](../decisions/0007-mine-agentmemory-design-not-depend.md)
- v0.2_informed_by [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- mining_map [agentmemory mining map](agentmemory-mining-map.md)
- detailed_by [mage v0.1 implementation plan](plan-v0.1.md)
- sequenced_by [release sequence (post-v0.1 → 1.0)](plan-release-sequence.md)
- field_tested_by [migration field notes](migration-field-notes.md)
- decided_by [ADR-0011 — recursive scan; hub projects are wings](../decisions/0011-recursive-scan-hub-projects.md)
- decided_by [ADR-0013 — procedure skills + the self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md)
- gated_by [ADR-0014 — two-gate redaction](../decisions/0014-two-gate-redaction.md)
