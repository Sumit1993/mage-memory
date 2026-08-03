---
type: gotcha
tags:
  - mage/build
created: "2026-07-27"
updated: 2026-07-27
last_reviewed: 2026-07-27
status: active
provenance:
  repo: mage-memory
  work: adr-0041-wave-b-extreme-review
sources:
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
keywords:
  - link-graph
  - harvest
  - genre
  - sources
  - cross-links
  - recall
modified: 2026-07-27T09:11:03.882Z
---
# Gotcha — a link-graph harvest must genre-filter its SOURCES, not just its targets

Wave-B's "Governing decisions" section filtered harvest *targets* to decision genre but iterated
ALL wing notes as *sources*. Decision notes carry the wing tag and cross-link each other densely,
so the ADR-to-ADR graph pulled every accepted ADR into the auto-loaded wing skill — 38 lines,
recreating the exact always-on ADR dump [ADR-0041 §4](../decisions/0041-genre-decides-the-recall-rung.md) exists to retire. Memory-genre sources alone
yield 18; the delta was pure decision-to-decision linkage.

**Rule:** in any dense-cross-linked corpus, one unfiltered side of a link harvest lets the
densest genre dominate the result. Filter both ends. Regression shape that pins it: N fully
cross-linked ADRs + k memory-linked → exactly k harvested. Caught only by the multi-agent
extreme review (schema-tier), after CodeRabbit, an Opus pass, and 1296 green tests all missed it.
