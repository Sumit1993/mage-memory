---
type: reference
tags: [mage/roadmap]
created: "2026-06-01"
updated: "2026-07-27"
last_reviewed: "2026-07-27"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/rohitg00/agentmemory
  - https://github.com/iii-hq/iii
keywords: [agentmemory, iii, server-inverse, obsidian-ui, mining, roadmap]
---

# Mining agentmemory's design into mage — conclusions

The execution of [ADR-0007](../decisions/0007-mine-agentmemory-design-not-depend.md). agentmemory
is mage's **architectural inverse** — a server (iii engine, MCP with ~53 tools, vector DB, React
viewer), every capability server-shaped. Mining means adopting the **idea** in
files/git/deterministic/Obsidian form, never porting the mechanism. *(Compressed 2026-07-27 —
the full capability-by-capability translation table lives in this file's git history; re-verify
against their CHANGELOG before acting on any verdict.)*

## Conclusions that stuck

- **mage already had the files-native analog for most of it** (v0.1 was designed by mining this
  repo); the genuinely new mineable ideas were few.
- **Obsidian is the UI for free** — their React viewer is the right call for a database store,
  irrelevant for a vault store.
- **Adopted, re-shaped:** per-harness adapter-installer → `mage connect` (ADR-0009) ·
  auto-capture → deterministic stage + agent distill (ADR-0009) · privacy filter → the redaction
  gates · dashboard → no-server generated `dashboard.html` (ADR-0020) · their eval harness
  *shape* → the planned `mage-evals/` (publish honest R@K/MRR/token-cost + skill-fire F1; their
  "22K vs 1.9K tokens" framing is a whole-file-paste strawman).
- **Rejected:** server-sharing, multi-agent leases/signals (ADR-0010), any daemon/vector-DB in
  core (ADR-0007/0009); vector recall, if ever, is an opt-in MCP accelerator.

## Resist (porting these would betray the thesis)

Silent capture-everything (contradicts ADR-0004 + the human-confirm gate) · a server of record ·
coordination primitives (ADR-0010 — orchestration, not memory).

## Relations

- implements [ADR-0007 — mine agentmemory's design, don't depend](../decisions/0007-mine-agentmemory-design-not-depend.md)
- detailed_by [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md) ·
  [ADR-0010](../decisions/0010-durable-memory-not-coordination-layer.md)
- informs [mage roadmap](../work/roadmap.md)
