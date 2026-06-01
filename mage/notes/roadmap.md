---
type: plan
tags: [mage/roadmap]
created: "2026-05-29"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
keywords: [roadmap, v0.1, v0.2, dream, scope, deferred, release, mcp, hub]
---

# mage — roadmap

> Scope line set 2026-05-29 (grill-with-docs session). Decisions: [ADR-0001](../decisions/0001-memory-first-product-supersedes-specshub.md)–0010 — latest: [0008 visible mage/ dir](../decisions/0008-visible-mage-dir-for-obsidian.md), [0009 no-runtime/auto-capture](../decisions/0009-no-runtime-automation-rides-host-hooks.md), [0010 not-a-coordination-layer](../decisions/0010-durable-memory-not-coordination-layer.md). What to mine from agentmemory: [mining map](agentmemory-mining-map.md). Language: [context & glossary](context.md). Founding design research was distilled into these notes; the raw research is author-local and not version-controlled here.

## v0.1 — the durable, portable, navigable knowledge base (the founding value)
- **Fork specshub → mage**: rename `.specshub/`→`mage/`, schema, CLI/package/awareness skill; **carry** modes (in-repo/external/hybrid), metadata, hub registry, commit hygiene, SDD skills (specs = a work type) [ADR-0002].
- **Vault**: `mage/{notes/, work/<slug>/(artifacts/ ignored), decisions/, archive/, INDEX.md, .obsidian/}`; track work+notes, git-ignore `artifacts/` + `.learnings/` [ADR-0003].
- **Note** = just-markdown + suggested `type` + `#wing/room` tag [Q5]; **Obsidian-native** portable `[text](path.md)` links + frontmatter + tags.
- **Capture-by-pointer**: insight/procedure/pointers, `sources:`, not copies [ADR-0004].
- **`mage index`** → hierarchical INDEX (root + per-wing) [ADR-0006].
- **Skills**: awareness + `learn` (explicit, human-confirm) + **one-per-wing** [ADR-0006].
- **Cheap anti-staleness only**: notes carry `last_reviewed`/`provenance.commit`; awareness treats notes as point-in-time ("verify stale notes vs current code"); on-write overlap/contradiction check in `/learn`.
- **Coexistence**: mage canonical; native auto-memory left as-is (no harvest bridge yet) [ADR-0005].

## v0.2+ — deferred
- Full **`/dream` batch sweep** (decay / supersede / re-verify / consolidate / prune) — only the cheap read-time + on-write parts ship in v0.1. Mines agentmemory's design (decay/consolidation/connect/bridge) without depending on it [ADR-0007].
- **Opt-in auto-capture** — runtime-less, via host hooks: `mage connect <agent>` installs per-harness hooks → `mage observe` stages to `.learnings/` (deterministic) → agent distills via `/learn` → promote on recurrence ≥2× [ADR-0009]. Plus **note↔skill promotion engine** + **homunculus-algorithm harvest** [ADR-0005/0006].
- **`/learn --from <transcript>`** — agent-driven import-harvest of session transcripts (e.g. `~/.claude/projects/*.jsonl`) into distilled notes; the feeder path [ADR-0005]. (Distillation is judgment ⇒ a skill, never a deterministic `mage import`.)
- **MCP** search/recall accelerator — standardizes *recall* across agents, **not** capture [ADR-0009].
- **Obsidian dashboards** via Dataview/Bases plugins (the graph + wing colors already ship; richer dashboards are plugin-rendered, not mage-generated markdown).
- **Multi-repo hub graph aggregation + cross-repo `/dream`** (basic hub mode carries from specshub; the cross-repo graph/sync waits).

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
