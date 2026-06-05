---
type: plan
tags: [mage/roadmap]
created: "2026-06-03"
updated: "2026-06-05"
last_reviewed: "2026-06-05"
status: active
provenance:
  repo: mage-memory
  work: mega-grill-skill-loop
keywords: [release, sequence, backlog, 0.1.0, self-grooming, procedure-skill, redaction, skillopt, observe, optimize, promotion]
---

# mage — release sequence (0.0.x → 0.1.0)

The [roadmap](roadmap.md) lists *what* is in scope; this note sequences it into small,
dependency-ordered releases and marks which need a design **grill** before they can be
built. The **horizon is capped at 0.1.0 — no 1.0 is crowned** (a 2026-06-05 mega-grill
decision). 0.1.0 ships the **full self-grooming loop**: portable KB · index · per-wing
skills · dream · recall **plus** capture → graduate → optimize. Detail for each item
lives in its ADR — this is the map, not a copy.

Ordering axes: **hard dependency first, then design-locked-before-grill** (ship the
concrete things cheaply; don't build a grill-gated feature until its design is locked).

## The sequence

| Release | Theme | ADRs | Dep | Grill? |
|---|---|---|---|---|
| **0.0.2** | Recursive hub scan + wings generalize *(shipped)* | 0011, 0012 | — | locked |
| **0.0.3** | Skills ship as a Claude Code **plugin** (`mage:` namespace, bare names); `mage init` prints `/plugin install`; ship `skills` + `.claude-plugin` in `files[]`. **Pulled forward: Redaction Gate 2 (`mage redact`, ADR-0014) + the `mage:learn --from` skill prose** *(shipped)* | 0013, 0014 | 0.0.2 | shipped |
| **0.0.4** | `mage learn --from` ingest **tooling**: deterministic source enumeration, adopt-in-place skill ingest, **feeder** (ECC/native) skeleton — the runtime helpers behind the skill prose already shipped in 0.0.3 | 0013, 0005, 0004 | 0.0.3 | locked |
| **0.0.5** | Dream tuning + **context-match metrics, read-only** (flag reword/demote — no auto-edit) | 0007, 0013 | 0.0.4 | locked |
| **0.0.6** | MCP recall accelerator *(independent track)* | 0009 | 0.0.2 | **grill** |
| **0.0.7** | `mage observe` → `.learnings/*.jsonl` (keystone) + **skill-load events** + **Redaction Gate 1** | 0009, 0014, 0013 | 0.0.2 | **grill** |
| **0.0.8** | Connect: host hook adapter | 0009, 0005 | 0.0.7 | **grill** |
| **0.0.9** | Distill: `mage:learn` ingest `.learnings/` + native/ECC feeders | 0005, 0009, 0004 | 0.0.7 | **grill** |
| **0.0.10** | Promote-on-recurrence + **note→skill graduation** + confidence ladder | 0006, 0013, 0005 | 0.0.7, 0.0.9 | **grill** |
| **0.0.11** | `/mage-optimize`: auto-reword (bounded edits + rejected-edit buffer + held-out-style gate) | 0013 | 0.0.5, 0.0.10 | **grill** |
| **0.0.12** | Full `/dream` healing sweep (judgment layer; **dream applies** graduation/demotion) | 0007, 0013, 0005 | 0.0.5, 0.0.11 | **grill** |
| **0.0.13** | Obsidian dashboards + **icon/visualization** + pre-release chores | 0010, 0013 | — | locked |
| **→ 0.1.0** | **Milestone: portable, self-grooming memory — the cut** | — | all | — |

## Critical path (what gates everything)

`0.0.2 substrate` → **`0.0.7 mage observe`** → `0.0.8 connect` / `0.0.9 distill` → `0.0.10 promote + graduate` → `0.0.11 optimize` → `0.0.12 dream sweep`.

`mage observe` is the keystone: it writes the `.learnings/` scratch and, per
[ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md), must also carry
**skill-load events** so **context-match** is computable. **Its `.jsonl` schema is
load-bearing for the whole loop** (capture *and* optimization), so observe must be
grilled before anything downstream locks against the wrong shape.

`0.0.6 MCP recall` is an **independent track** (recall, not capture) — it needs only
the stable INDEX from 0.0.2 and blocks nothing; slot it in early for cross-agent value
or slip it later without consequence.

The eight 2026-06-05 mega-grill ideas land as: grouping → 0.0.3; ingest skills →
0.0.4; redaction → 0.0.7 (Gate 1) + 0.0.4 (Gate 2); context-match metrics → 0.0.5;
note→skill graduation → 0.0.10; optimize/reword (SkillOpt rails) → 0.0.11; automate
learn = the 0.0.7–0.0.10 chain; icon/viz → 0.0.13. Highlighting auto skill-creation
(idea 2) is the graduation UX in 0.0.10 + the README.

## Where 0.1.0 cuts

**0.1.0 = the full self-grooming loop, all human-committed.** Founding value (portable
file KB · index · per-wing skills · dream · bulk migration/ingest · MCP recall) plus
the complete capture → graduate → optimize loop ship across 0.0.3–0.0.13 and graduate
to **0.1.0**. The never-auto-commit invariant holds throughout — grooming *writes
files*, the human *commits the diff*. ADR-0006's "promotion deferred until wings
proliferate" trigger is satisfied naturally: wings proliferate across the 0.0.x ladder
before the promote/optimize releases (0.0.10–0.0.11) land.

## Grills to run (one per grill-gated release)

- **0.0.6 MCP** — transport (stdio vs Streamable HTTP), tool surface (search/get over INDEX+grep), the no-vector-in-core boundary.
- **0.0.7 observe** — cross-harness hook payload → normalized `.jsonl` schema **incl. skill-load events** (load-bearing for context-match), Redaction Gate 1 filter.
- **0.0.8 connect** — `.claude/settings.json` merge/uninstall contract (GEN marker), per-harness event→observe mapping, homunculus disable-on-loop interlock.
- **0.0.9 distill** — JSONL path layout, long-session chunking/token budget, dedup vs INDEX overlap-check, Redaction Gate 2, native-memory reconciliation policy.
- **0.0.10 promote + graduate** — "recurrence"/"confidence" in a no-LLM files store, the human-confirm→auto loosening ladder, GENERATED-clobber vs bespoke-authored-skill tension, the note→skill graduation trigger.
- **0.0.11 optimize** — the bounded-edit budget ("textual learning rate"), rejected-edit buffer storage, the held-out-style gate **without labels** (using context-match), how `/mage-optimize` hands mutations to dream.
- **0.0.12 dream sweep** — decay scoring, re-verify-against-source trigger, consolidate heuristics, prune→archive-vs-delete, and **dream-as-applier** of graduation/demotion (single mutation path, ADR-0013 §6).

## Deferred past 0.1.0 (unplanned future 0.x — no 1.0 crowned, own ADR/grill required)

- **Literal SkillOpt bridge** — export skills + trajectories to Microsoft's SkillOpt
  optimizer, import `best_skill.md` back. A real training loop (two model backends,
  epochs, labeled splits) → opt-in, **out-of-core**, like the MCP accelerator. mage
  ships SkillOpt's *rails* in 0.0.11, not its harness. [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md)
- **Multi-repo hub graph aggregation + cross-repo `/dream`** — ADR-0012 §2 *rejects*
  cross-repo content/graph aggregation (Obsidian can't span repos). The only surviving,
  ADR-0010-blessed form is read-only memory aggregation that follows registry pointers
  *without merging graphs* — XL, needs its own grill on the sync model.

## Relations

- sequences [mage roadmap](roadmap.md)
- detailed_by [ADR-0013 — procedure skills + the self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md)
- detailed_by [ADR-0014 — two-gate redaction](../decisions/0014-two-gate-redaction.md)
- detailed_by [ADR-0011 — recursive scan; hub projects are wings](../decisions/0011-recursive-scan-hub-projects.md)
- detailed_by [ADR-0012 — wings optional; standalone hubs](../decisions/0012-wings-optional-convention-standalone-hubs.md)
- feeders_from [ADR-0005 — one canonical memory; others are feeders](../decisions/0005-one-canonical-memory-others-are-feeders.md)
- recall_from [ADR-0006 — two-layer recall](../decisions/0006-two-layer-recall-per-wing-skills.md)
- mines [ADR-0007 — mine agentmemory's design](../decisions/0007-mine-agentmemory-design-not-depend.md)
- rides [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- field_tested_by [migration field notes](migration-field-notes.md)
