---
type: decision
tags: [mage/decisions]
created: "2026-05-29"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
---

# 0003 — Track work units and notes; git-ignore only artifacts and scratch

mage commits the durable knowledge — `notes/`, `decisions/`, `INDEX.md`, `metadata.json`, `.obsidian/`, **and work units' working content** (`work/<slug>/*.md`) — so it travels across machines and to the hub, honoring the founding goal (knowledge that doesn't get lost). Only **`work/<slug>/artifacts/`** (raw/large/binary materials) and **`.learnings/`** (pre-promotion scratch) are git-ignored — durable on disk (never `/tmp`) but local, to keep the repo free of binaries and noise. Rule: anything in an `artifacts/` dir is ignored; everything else is tracked.

## Considered options
- **Git-ignore all of `work/`** — keeps the repo clean of in-progress work, but specs/investigations wouldn't travel or reach the hub, regressing the founding "don't lose durable knowledge" goal.
- **Track work, ignore only artifacts** (chosen) — working knowledge is durable+shareable; only bulky/raw evidence stays local.

## Consequences
- Three layers: **work units** = lab-notebook (task-scoped, tracked); **artifacts** = raw materials (local, ignored); **notes** = encyclopedia (topic-scoped graph, tracked, `/dream`-maintained). Distillation flows notebook → encyclopedia.
- Committing in-progress work adds some history/PR noise; `/dream` archives closed/stale work units to mitigate.
- Git-ignored artifacts don't travel; a committed note citing one may dangle on another machine (it captures the key content verbatim, and an artifact can be force-added if it must travel).

## Relations

- see_also [ADR-0004 — capture insight, not copies](0004-capture-insight-not-copies.md)
- see_also [mage roadmap](../notes/roadmap.md)
