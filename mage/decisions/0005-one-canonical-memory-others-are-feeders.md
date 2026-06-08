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

# 0005 — Exactly one canonical durable memory (mage); native memories are feeders, not rivals

> **Amendment (2026-06-08, distill grill — [ADR-0018](0018-mage-distill-observed-scratch-reader.md)).**
> The **feeder mechanism is cut.** mage no longer harvests other tools' memory stores
> (ECC instincts, Claude `MEMORY.md`): they have their own creation standards and
> lifecycle, harvesting *duplicates* rather than consolidates, and ingesting their
> formats couples mage to third-party schemas ([ADR-0007](0007-mine-agentmemory-design-not-depend.md)).
> The "mage is canonical" core **stands**; what changes is its reach — mage is canonical
> *for what mage captures*, and foreign stores are **independent neighbors, ignored**, not
> demoted feeders to absorb. So below: clause "native auto-memory stays on as a *feeder*
> … `/learn` harvests it", clause "homunculus's *proven algorithm is harvested*", and
> "feeders may hold non-canonical duplicates until harvested" are **superseded** —
> `mage:learn --from` remains only a *generic* doc importer, with no ECC/native special-casing.

The environment runs several memory systems — Claude's native auto-memory (Claude-only, on by default), the ECC `continuous-learning-v2` "homunculus" (wired but inactive), and context-mode (FTS5 session memory). To avoid N competing durable stores that drift and duplicate, **mage is the single canonical, deliberate, portable, cross-agent durable memory; every other system is either disabled or demoted to an ephemeral feeder that `/learn` harvests.**

## Decision
- **mage = canonical** source of truth for durable knowledge.
- **Native auto-memory** stays on as a Claude-side *feeder* (free background capture); not canonical, not portable; `/learn` harvests durable insights from it into mage.
- **Homunculus** is retired for mage's purposes; its proven algorithm is harvested (promote when a pattern recurs across ≥2 contexts at confidence ≥ threshold; instinct→skill evolution). If mage ever enables its own observe-loop, the homunculus's PreToolUse/PostToolUse hooks MUST be disabled (two loops would double-observe).
- **context-mode** remains a session search/scratch tool, never canonical.

## Consequences
- One mental model for "where durable knowledge lives": mage.
- Feeders may hold non-canonical duplicates until harvested — accepted, reconciled lazily.
- Keeping native auto-memory as a feeder (vs disabling) preserves convenient auto-capture as raw material for `/learn`.

## Relations

- see_also [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md)
- see_also [ADR-0007 — mine agentmemory's design, don't depend](0007-mine-agentmemory-design-not-depend.md)
