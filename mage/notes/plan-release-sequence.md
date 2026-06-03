---
type: plan
tags: [mage/roadmap]
created: "2026-06-03"
updated: "2026-06-03"
last_reviewed: "2026-06-03"
status: active
provenance:
  repo: mage-memory
  work: backlog-sequence-plan
keywords: [release, sequence, backlog, dependency, grill, 1.0, capture-chain, mcp, dream-sweep, promotion]
---

# mage — release sequence (post-v0.1 → 1.0)

The [roadmap](roadmap.md) lists *what* is deferred; this note sequences it into small,
dependency-ordered releases and marks which need a design **grill** before they can be
built. Ordering axes: **hard dependency first, then design-locked-before-grill** (ship
the concrete things cheaply; don't build a grill-gated feature until its design is
locked). Detail for each item lives in its ADR — this is the map, not a copy.

## The sequence

| Release | Theme | ADRs | Dep | Size | Grill? |
|---|---|---|---|---|---|
| **0.0.2** | Recursive hub scan + wings generalize *(in-flight)* | 0011, 0012 | — | L | locked |
| **0.0.3** | Bulk-migration distill: `/mage-learn --from <dir>` | 0005, 0004 | 0.0.2 | M | locked |
| **0.0.4** | Dream report tuning (orphans/reference notes) | 0007 | 0.0.2–3 | S | locked |
| **0.0.5** | MCP recall accelerator *(independent track)* | 0009 | 0.0.2 | L | **grill** |
| **0.0.6** | Stage step: `mage observe` → `.learnings/*.jsonl` | 0009 | 0.0.2 | M | **grill** |
| **0.0.7** | Connect step: Claude Code hook adapter | 0009, 0005 | 0.0.6 | L | **grill** |
| **0.0.8** | Distill step: `/mage-learn` ingest `.learnings/` + transcript/native feeders | 0005, 0009, 0004 | 0.0.6 | M | **grill** |
| **0.0.9** | Promote-on-recurrence gate (closes stage→distill→promote) | 0006, 0005, 0009 | 0.0.6, 0.0.8 | L | **grill** |
| **0.0.10** | Full `/dream` healing sweep (judgment layer) | 0007, 0005, 0009 | 0.0.4, 0.0.9 | XL | **grill** |
| **0.0.11** | Obsidian dashboards + pre-release chores | 0010 | — | S | locked |

## Critical path (what gates everything)

`0.0.2 substrate` → **`0.0.6 mage observe`** → `0.0.7 connect` / `0.0.8 distill` → `0.0.9 promote` → `0.0.10 dream sweep`.

`mage observe` is the keystone: it writes the `.learnings/` scratch (today a reserved-but-empty
hole — gitignored, scan-skipped, nothing writes it), and connect/distill/promote all consume
what it stages. **Its `.jsonl` schema is load-bearing for the whole capture chain**, so observe
must be grilled before anything downstream locks against the wrong shape.

`0.0.5 MCP recall` is an **independent track** (recall, not capture) — it needs only the stable
INDEX from 0.0.2 and blocks nothing; slot it in early for cross-agent value while the capture-chain
grills proceed, or slip it later without consequence.

## Where 1.0 cuts

**1.0 = the durable-memory + recall core**, not the full capture loop. Founding value (portable
file-based KB · index · per-wing skills · dream report · bulk migration · MCP recall) ships through
~0.0.5 + the 0.0.11 chores and is independently shippable. The auto-capture chain (0.0.6–0.0.10) is
grill-heavy and **trigger-gated** — ADR-0006 explicitly defers the promotion engine until wings
proliferate — so let it mature across 0.x point releases and graduate to 1.x rather than blocking 1.0.

## Grills to run (one per grill-gated release)

- **0.0.5 MCP** — transport (stdio vs Streamable HTTP), tool surface (search/get over INDEX+grep), the no-vector-in-core boundary.
- **0.0.6 observe** — cross-harness hook payload → normalized `.jsonl` schema (load-bearing), redaction/privacy filter.
- **0.0.7 connect** — `.claude/settings.json` merge/uninstall contract (GEN marker), per-harness event→observe mapping, homunculus disable-on-loop interlock.
- **0.0.8 distill** — JSONL path layout, long-session chunking/token budget, dedup vs INDEX overlap-check, redaction, locate/slice as CLI-helper vs in-skill, native-memory reconciliation policy.
- **0.0.9 promote** — what "recurrence"/"confidence" mean in a no-LLM files store, threshold + human-confirm→auto loosening ladder, GENERATED-clobber vs bespoke-authored-skill tension, confirm the wing-proliferation trigger has fired.
- **0.0.10 dream sweep** — decay scoring formula, re-verify-against-source trigger, consolidate merge heuristics, prune→archive-vs-delete policy (no ADR locks these).

## Deferred past 1.0 (own ADR required)

- **Multi-repo hub graph aggregation + cross-repo `/dream`** — ADR-0012 §2 *rejects* cross-repo
  content/graph aggregation (Obsidian can't span repos; links wouldn't be graph edges). The only
  surviving, ADR-0010-blessed form is read-only memory aggregation that follows registry pointers
  *without merging graphs* — XL, no ADR, needs its own grill on the sync model. Post-1.0 epic.

## Open ownership question (settle in the 0.0.9 grill)

note↔skill **demotion**: detect candidates in the deterministic `promote-cmd` pass (0.0.9), but
*apply* through the `/dream` sweep's human-confirm mutation layer (0.0.10) — dream already owns
supersede/prune file mutations (ADR-0006 §27 says dream does not manage skills in v1; this is the
v0.2 revisit). Recommend dream-as-applier to avoid two mutation paths into the skill catalog.

## Relations

- sequences [mage roadmap](roadmap.md)
- detailed_by [ADR-0011 — recursive scan; hub projects are wings](../decisions/0011-recursive-scan-hub-projects.md)
- detailed_by [ADR-0012 — wings optional; standalone hubs](../decisions/0012-wings-optional-convention-standalone-hubs.md)
- feeders_from [ADR-0005 — one canonical memory; others are feeders](../decisions/0005-one-canonical-memory-others-are-feeders.md)
- recall_from [ADR-0006 — two-layer recall](../decisions/0006-two-layer-recall-per-wing-skills.md)
- mines [ADR-0007 — mine agentmemory's design](../decisions/0007-mine-agentmemory-design-not-depend.md)
- rides [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- field_tested_by [migration field notes](migration-field-notes.md)
