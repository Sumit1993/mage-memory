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
sources:
  - https://github.com/Sumit1993/specshub
---

# 0002 — mage forks specshub (clean copy, fresh history) and reorients

mage reuses specshub's already-memory-shaped machinery — in-repo/external/hybrid **modes**, `metadata.json` detection, the **hub registry**, **commit hygiene**, path resolution, the CLI scaffolding (commander/tsup/vitest), and the SDD **skills** (specs become one note *type*) — rather than rebuilding greenfield. We take it as a **clean file copy into a fresh repo (no git history)** because specshub's history is noisy (orphan-commit/force-push churn), then rename (`.specshub/`→`.mage/`, `specshub.v1`→`mage.v1`, package/CLI/awareness skill) and add the memory layer (note schema, index generator, wing/room-as-tags, `learn`/`dream`, Obsidian-native authoring).

## Considered options
- **Greenfield** — psychologically clean, but discards working, well-grilled plumbing to re-solve solved problems; specshub's architecture is the *same* file+git+hub+metadata foundation mage independently arrived at.
- **Fork-and-reorient** (chosen) — ~60–70% of plumbing carries; reorientation is additive + cosmetic renames.

## Consequences
- Must consciously **prune spec-era assumptions** (naming + the "SDD is the center" framing in skill bodies) so the fork doesn't smuggle in the old identity.
- Fresh git history; specshub stays archived for reference.

## Relations

- depends_on [ADR-0001 — memory-first product supersedes specshub](0001-memory-first-product-supersedes-specshub.md)
- see_also [mage v0.1 implementation plan](../notes/plan-v0.1.md)
