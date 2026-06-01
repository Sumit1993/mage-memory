---
type: reference
tags: [mage/roadmap]
created: "2026-06-01"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/rohitg00/agentmemory
  - https://github.com/iii-hq/iii
keywords: [agentmemory, iii, server-inverse, obsidian-ui, import-harvest, consolidation, auto-capture, dream, feeder, connect, mining, roadmap]
---

# Mining agentmemory's design into mage — files-native translation map

The concrete execution of [ADR-0007](../decisions/0007-mine-agentmemory-design-not-depend.md): a capability-by-capability map of what to mine from agentmemory, re-expressed in mage's idiom. Go to the `sources:` repo for mechanism detail — this note captures only the **translation + verdicts** (it moves fast; re-verify against their CHANGELOG before acting).

> Credit: agentmemory and the iii engine beneath it are well-engineered prior art. mage mines their *ideas* with respect and diverges by **design goals** (curated files, no server) — a different set of trade-offs for a different use, not a claim to be better.

## Insight

agentmemory is mage's **architectural inverse**: a server (iii engine `:3111/:3112`, MCP server with ~53 tools, LLM-compression pipeline, vector DB, React viewer `:3113`). Every capability is *server-shaped*. So mining means adopting the **idea** in files/git/deterministic/Obsidian form — never porting the mechanism (which would re-introduce the daemon+DB ADR-0007 rejected).

Two findings worth keeping:
1. **mage already has the files-native analog for most of it** — because v0.1 was itself designed by mining this repo. The genuinely *new* mineable ideas are few.
2. **Obsidian is a structural fit for mage.** agentmemory builds a polished server+React UI — a sensible choice when the store is a database. mage's store is an Obsidian vault, so it inherits a UI for free (graph, backlinks, search, tags). A different trade-off born of a different storage choice — user-owned and offline, with no live viewer to run — not a better team.

## Translation map

| agentmemory (server) | mage-native form | verdict |
|---|---|---|
| `connect` — **server-sharing**: one daemon fanned into N agents | mage has no server to share; the shared substrate is git-synced files + skills | **reject** (server-sharing half) |
| `connect` — **adapter-installer**: per-harness native hook/config writer | `mage connect <agent>` writes each host's native hook config → `mage observe`; the delivery vehicle for auto-capture. No universal hook standard → N bespoke adapters, Claude Code first | **adopt** → [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md) |
| multi-agent leases / signals / actions / routines | — (a task queue; needs a shared live runtime) | **reject** → [ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md) |
| `import-jsonl` — ingest raw transcripts | **`/learn --from <transcript>`**: the *agent* (not a CLI) reads the transcript and distills candidate notes (human-confirm), per capture-by-pointer — judgment ⇒ must be a skill, not `mage import` | adopt (ADR-0005 feeder) |
| 4-tier consolidation: Working→Episodic→Semantic→Procedural + decay | *already mage's layering*: `work/`+`artifacts/` → `notes/` → playbook/gotcha + per-wing skills; `/dream` is the decay/consolidate engine | already have; name it |
| automatic capture (silent hooks, capture-everything, LLM-compress) | runtime-less: host hook → `mage observe` stages to `.learnings/` (deterministic) → agent distills via `/learn` (judgment) → promote on recurrence ≥2× | adopt, re-shaped → [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md) |
| privacy filter (strip secrets pre-store) | redact secrets before writing any note (`/learn` + import + `mage observe`) | adopt — cheap |
| complete UI (React viewer + server) | Obsidian *is* the UI: wing-colored `graph.json` (shipped, free). Richer dashboards = Obsidian plugins (Dataview/Bases) **later** — not mage-generated markdown | graph: have; dashboard: defer to Obsidian plugins |
| MEMORY.md bridge (bidirectional sync) | realized natively as `INDEX.md` + `AGENTS.md` + awareness skill | already have |
| BM25+vector+graph search (RRF) | deterministic INDEX + grep + Obsidian search; vector = optional **MCP accelerator** (standardizes *recall*, not capture) | keep deterministic; vector = v0.2 MCP |
| git snapshots / versioning | notes are git-tracked — free | already have |

## Resist (porting these would betray the thesis)

- **Silent capture-everything** — contradicts capture-by-pointer (ADR-0004) and the curated/human-confirm gate. agentmemory's auto-capture is a *feeder mage harvests* (ADR-0005), re-shaped into the deterministic-stage / agent-distill split of ADR-0009 — never a silent LLM firehose.
- **A server / daemon / vector DB in core** — ADR-0001/0003/0005/0007/0009. Vector search, if ever, is an opt-in MCP accelerator, not the store.
- **Multi-agent coordination primitives** (leases/signals/actions) — ADR-0010. Orchestration, not memory.

## Placement

- **v0.1-cheap** (before first publish): privacy-redaction helper · read-only `mage dream` health report (stale / superseded-but-active / dangling / orphans). *(The dashboard rendering is deferred to Obsidian plugins.)*
- **v0.2+**: auto-capture via host hooks ([ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md): `mage connect`/`mage observe` + the stage→distill→promote loop) · `/learn --from <transcript>` import-harvest · full `/dream` (decay/consolidate/re-verify/prune) · vector/MCP recall accelerator · Obsidian dashboard via Dataview/Bases.
- **Not mage**: multi-agent coordination ([ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md)); any server-of-record.

## Relations

- implements [ADR-0007 — mine agentmemory's design, don't depend](../decisions/0007-mine-agentmemory-design-not-depend.md)
- detailed_by [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- detailed_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- informs [mage roadmap](roadmap.md)
- see_also [mage — context & glossary](context.md)
