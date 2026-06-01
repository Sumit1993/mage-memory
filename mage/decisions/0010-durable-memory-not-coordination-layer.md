---
type: decision
tags: [mage/decisions]
created: "2026-06-01"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/rohitg00/agentmemory
---

# 0010 — mage is durable memory, not a multi-agent coordination layer

agentmemory ships multi-agent **coordination** primitives — exclusive action leases (`memory_lease`), inter-agent messaging (`memory_signal_send/read`), work items with dependencies (`memory_action_*`), a priority `memory_frontier`/`memory_next`, and workflow routines. Mining its *memory* design ([ADR-0007](0007-mine-agentmemory-design-not-depend.md)) makes these tempting to mine too. We explicitly **do not**. mage is durable, curated, navigable memory — full stop. Coordinating *what agents do next* is a different product: a task queue / orchestration layer, which needs a shared live runtime and inverts files-as-truth.

## Considered options

- **Add coordination primitives** (leases / signals / actions / routines) — rejected: they require a server-mediated shared runtime (a queue with exclusive leases can't be a pile of git-synced files without races), which contradicts [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) (no runtime) and [ADR-0001](0001-memory-first-product-supersedes-specshub.md)/0003/0005 (files-as-truth). It also dilutes the identity into "memory + orchestration."
- **Stay pure memory** (chosen) — one thing, done sharply.

## Consequences

- mage's identity is unambiguous: durable, navigable, self-maintaining **memory**. The explicit *no* stops "add agent coordination" from resurfacing every few months.
- "Shared across agents" means the **git-synced files + per-wing skills** (a shared substrate every agent reads), **not** live agent-to-agent coordination. Coordination, if ever needed, is the host harness's or a separate tool's job — mage stays the memory underneath it.
- The legitimate "shared across many things" roadmap item is **multi-repo hub graph aggregation** (v0.2+) — aggregating *memory* across repos, not *coordinating agents*. Keep that distinction crisp.

## Relations

- depends_on [ADR-0001 — memory-first product](0001-memory-first-product-supersedes-specshub.md)
- see_also [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- see_also [agentmemory mining map](../notes/agentmemory-mining-map.md)
- informs [mage roadmap](../notes/roadmap.md)
