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

# 0004 — Capture insight, procedure, and pointers — not copies of sources

mage deliberately does **not** store copies of external sources (blog posts, Notion docs, tickets, code). Those are already canonical; copying them only creates a lossy, staleness-prone mirror. Instead a note captures the reusable **insight** (verbatim — don't oversimplify what you figured out), the **procedure** (how to do it faster; the bad commands to avoid and why), and **pointers** (`sources:` — URL / ticket / `file:line` with when-to-use context) that send you straight to the canonical source next time. The goal is *do it faster / make fewer mistakes next time*, not *archive what we read*.

## Considered options
- **Copy or summarize sources into notes** — offline-durable, but a lossy mirror that drifts from the canonical source and bloats the graph.
- **Insight + procedure + pointers** (chosen) — store the *method* and the *path*; reference the content.

## Consequences
- New procedural/wayfinding note types join the suggested vocab: **playbook** (how to do X faster), **gotcha** (what not to do + why), **pointer/reference** (where X lives), **trail** (the path that connected ticket→PR→code→doc).
- `sources:` is first-class on notes (pointers, not copies).
- Pointers can rot → `/dream` re-verifies them (dead-link/moved detection) like code claims; **at-risk or ephemeral sources** are snapshotted into `artifacts/` as a fallback receipt (point to canonical; cache only the fragile).
- `/learn` distills "the reusable how/where/what-not" and captures pointers, rather than copying source content.
- Surfacing procedural/`gotcha` notes by `#wing` is the "nudge" that reduces repeated mistakes (e.g., bad CLI calls) and speeds navigation to the right source.

## Relations

- see_also [ADR-0003 — track work, ignore artifacts](0003-track-work-ignore-artifacts.md)
- informs [ADR-0007 — mine agentmemory's design, don't depend](0007-mine-agentmemory-design-not-depend.md)
- see_also [mage language & glossary](../notes/context.md)
