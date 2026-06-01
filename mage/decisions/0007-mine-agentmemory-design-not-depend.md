---
type: decision
tags: [mage/decisions]
created: "2026-05-31"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/rohitg00/agentmemory
---

# 0007 — Mine agentmemory's design; don't depend on it

[rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) is a **server-based memory store-of-record** (the iii engine on :3111, auto-capture via hooks, hybrid BM25+vector+KG retrieval, Ebbinghaus decay/consolidation, multi-agent `connect` wiring, a `MEMORY.md` bridge). That is the architectural **inverse** of mage (files-of-record, no server, human-curated). We adopt its proven *ideas* — decay, supersession, consolidation, prune, re-verify, multi-agent connection, an always-loaded summary bridge — into mage's own files-native `/dream` layer on mage's schedule, and we explicitly **do not take it as a runtime dependency**.

## Considered options

- **Depend on agentmemory** (embed or call its engine) — rejected: it's a server store-of-record; depending on it adds a daemon + database, inverts ownership of the canonical store, and breaks mage's files-as-truth thesis (ADR-0001/0003/0005).
- **Ignore it** — rejected: its decay/consolidation/multi-agent algorithms are well-shaped and worth porting.
- **Mine the design, don't depend** (chosen) — port the ideas into mage's own file-based mechanisms.

## Consequences

- The mined ideas land in **v0.2 `/dream`** (per ROADMAP), not v0.1: Ebbinghaus-style decay scoring, supersession, consolidation, prune, and re-verify against changed source.
- v0.1's note model is already **forward-compatible**: `status` (active|stale-suspect|superseded|archived), `last_reviewed`, `provenance.{repo,commit,work}`, and `sources:` are exactly the substrate `/dream` will consume — no schema migration needed later.
- v0.1 already ships the cheap slice of this thinking: **supersede-don't-overwrite** and **verify-don't-trust** guidance in the `mage` (awareness) and `mage-learn` skills.
- agentmemory's always-loaded `MEMORY.md` bridge is realized natively in mage as `INDEX.md` + `AGENTS.md` + the awareness skill — no separate bridge file.
- If mage ever adds an auto-capture observe-loop, the homunculus hooks (ADR-0005) must be disabled to avoid double-observing; the same constraint applies to any agentmemory-derived capture loop.

## Relations

- depends_on [ADR-0005 — one canonical memory](0005-one-canonical-memory-others-are-feeders.md)
- depends_on [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md)
- informs [mage roadmap — v0.2 /dream](../notes/roadmap.md)
