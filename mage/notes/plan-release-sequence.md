---
type: plan
tags: [mage/roadmap]
created: "2026-06-03"
updated: "2026-06-06"
last_reviewed: "2026-06-06"
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

Resequenced 2026-06-06: combined the loop's nine unshipped releases into six coherent
capabilities (ADR-0015/0016 pre-resolved the cross-cutting parts, so several artificial
splits collapsed). **Status** tracks where each release stands.

| Release | Theme | ADRs | Dep | Grill? | Status |
|---|---|---|---|---|---|
| **0.0.2** | Recursive hub scan + wings generalize | 0011, 0012 | — | locked | **shipped** |
| **0.0.3** | Skills ship as a Claude Code **plugin** (`mage:` namespace, bare names); `mage init` prints `/plugin install`; ship `skills` + `.claude-plugin` in `files[]`. **Pulled forward: Redaction Gate 2 (`mage redact`, ADR-0014) + the `mage:learn --from` skill prose** | 0013, 0014 | 0.0.2 | locked | **shipped** |
| **0.0.4** | `mage learn --from` ingest **tooling**: deterministic source enumeration, adopt-in-place skill ingest, **feeder** (ECC/native) skeleton — the runtime helpers behind the skill prose already shipped in 0.0.3 | 0013, 0005, 0004 | 0.0.3 | locked | **shipped¹** |
| **0.0.5** | **`mage observe`** → `.learnings/*.jsonl` (keystone) + **skill-load events** + **Redaction Gate 1** | 0009, 0014, 0013, 0015 | 0.0.4 | locked | **shipped** |
| **0.0.6** | **connect/disconnect** (hook adapter → `settings.local.json`, `id:"mage:*"`) + **context-match metrics, read-only** via `mage skills --metrics` + `mage/.metrics/` rollup (per-turn fold) + keyword-derivation fix | 0009, 0005, 0015, 0016, **0017** | 0.0.5 | locked | **shipped²** |
| **0.0.7** | **distill**: `mage distill --json` reader + `mage:distill` skill over `.learnings/` → notes **on first sight**; feeders **cut**; Gate-2 **pre-commit hook** via `connect` | **0018**, 0015, 0014, 0009 | 0.0.6 | **grilled** | planned |
| **0.0.8** | **self-grooming**: promote-on-recurrence + **note→skill graduation** + `/mage-optimize` auto-reword + full `/dream` healing sweep (**dream applies** graduation/demotion) | 0006, 0013, 0005, 0016 | 0.0.7 | **grill** *(mechanics)* | planned |
| **0.0.9** | **MCP recall** accelerator *(independent track)* | 0009 | 0.0.2 | **grill** | planned |
| **0.0.10** | **polish**: Obsidian dashboards + **icon/visualization** + pre-release chores | 0010, 0013 | — | locked | planned |
| **→ 0.1.0** | **Milestone: portable, self-grooming memory — the cut** | — | all | — | — |

¹ tagged + GitHub-released; npm still at 0.0.3. · *Status legend:* **shipped · next · planned** (add `building`/`grilled`/`built` in flight).
² 0.0.6 **built + dogfooded 2026-06-07** (383 tests; connect/disconnect, read-only context-match metrics via `mage skills --metrics` + `mage/.metrics/` rollup, keyword-derivation fix). Dogfood pulled in a **redaction hardening**: a dedicated `anthropic-key` detector — `sk-ant-` keys were partially leaking past the generic high-entropy detector ([gotcha](redaction-anthropic-key-detector.md)). **Live-connected + real-hook dogfooded 2026-06-07**: the wired hooks auto-fired in a real session — `user_prompt`, `tool_use` (incl. a real `ok:false` Read failure), and a real `skill_load` (wing=mage, trigger_hash + keyword snapshot) all captured correctly; the metrics fold correctly held the `skill_load` until its forward window closes. **Carry-in RESOLVED:** a single tool failure yields exactly **one** event — Claude Code does not double-fire `PostToolUse` + `PostToolUseFailure`, so no dedup is needed. **Shipped: tagged `v0.0.6` + `npm publish` 2026-06-07.**

## Critical path (what gates everything)

`0.0.2 substrate` → **`0.0.5 mage observe`** → `0.0.6 connect + metrics` → `0.0.7 distill` → `0.0.8 self-grooming`.

`mage observe` is the keystone: it writes the `.learnings/` scratch and, per
[ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md), must also carry
**skill-load events** so **context-match** is computable. **Its `.jsonl` schema is
load-bearing for the whole loop** (capture *and* optimization) — now locked in
[ADR-0015](../decisions/0015-mage-observe-capture-schema.md), so everything downstream
locks against the right shape. observe ships **next** (locked, no grill); `connect`
makes it auto-fire, so it lands with the read-only metrics that read its data.

`0.0.9 MCP recall` is an **independent track** (recall, not capture) — it needs only
the stable INDEX from 0.0.2 and blocks nothing; slot it in early for cross-agent value
or slip it later without consequence.

The eight 2026-06-05 mega-grill ideas land as: grouping → 0.0.3; ingest skills →
0.0.4; redaction → 0.0.5 (Gate 1) + 0.0.3 (Gate 2); context-match metrics → 0.0.6;
note→skill graduation + optimize/reword (SkillOpt rails) → 0.0.8; automate learn = the
0.0.5–0.0.8 chain; icon/viz → 0.0.10. Highlighting auto skill-creation (idea 2) is the
graduation UX in 0.0.8 + the README.

## Where 0.1.0 cuts

**0.1.0 = the full self-grooming loop, all human-committed.** Founding value (portable
file KB · index · per-wing skills · dream · bulk migration/ingest · MCP recall) plus
the complete capture → graduate → optimize loop ship across 0.0.3–0.0.10 and graduate
to **0.1.0**. The never-auto-commit invariant holds throughout — grooming *writes
files*, the human *commits the diff*. ADR-0006's "promotion deferred until wings
proliferate" trigger is satisfied naturally: wings proliferate across the 0.0.x ladder
before the self-grooming release (0.0.8) lands.

## Release discipline — dogfood before publish

Every release is **used locally before it ships.** `pnpm test` verifies logic in
isolation, but mage's runtime surface — hook-invoked commands reading real stdin, real
`.learnings/` writes, KB/root resolution from a real `cwd`, redaction on real payloads,
file rotation — only reveals bugs when actually run. **Definition of done, per release:**

1. `pnpm test` + `pnpm typecheck` + `pnpm build` green.
2. **Smoke the new capability against real inputs** — e.g. pipe real Claude Code hook
   JSON into `mage observe` and inspect the output; include a **planted secret** (confirm
   Gate-1 redaction) and **malformed input** (confirm it never crashes the host).
3. **Run it for real in this repo** — mage dogfoods on its own `mage/` KB. From 0.0.6
   (`connect`) this is automatic; before that, wire one temporary hook by hand (which
   also pre-validates connect's payload→event mapping). Remove the temp hook after.
4. Only then tag + `npm publish`.

## Grills to run (remaining: 2 — 0.0.8 self-grooming + 0.0.9 MCP)

The 2026-06-06 observe grill ([ADR-0015](../decisions/0015-mage-observe-capture-schema.md)
+ [ADR-0016](../decisions/0016-context-match-confidence-ladder-applier.md)) pre-resolved
the cross-cutting decisions (schema, context-match window/predicate, rollup storage,
the confidence ladder, the dream-as-applier boundary, the command-tier taxonomy), so
every remaining grill is now scoped to *mechanics only* — what each release still has to
decide, below.

- **0.0.5 observe** — **GRILLED ✓ + locked** ([ADR-0015](../decisions/0015-mage-observe-capture-schema.md)/[ADR-0016](../decisions/0016-context-match-confidence-ladder-applier.md)); also landed the [ADR-0014](../decisions/0014-two-gate-redaction.md) redaction reframe + [CONVENTIONS §10](../../CONVENTIONS.md). **Build next, no grill.**
- **~~0.0.6 connect~~ — GRILLED 2026-06-06** → [ADR-0017](../decisions/0017-mage-connect-host-hook-adapter.md) (+ amends [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)'s interlock; CONVENTIONS §10 updated). Locked: `mage connect`/`disconnect` write `id:"mage:*"` hooks to `settings.local.json` (per-repo, `--user` for global; idempotent, `.bak`-safe, refuse-on-malformed); **full-ignore ECC** (no interlock — coexist + feeder); dual-mode CLI via a shared `resolveInteractive` (non-TTY ⇒ non-interactive), generalized to init/link/unlink; hook block = 6 observe events (incl. PostToolUseFailure) + `Stop` `mage skills --metrics --quiet`; read-only context-match via **`mage skills --metrics`** over a persistent `mage/.metrics/` rollup (Option B, per-turn fold); keyword-derivation noise fixed at capture; "dream tuning" dropped. **Carry-in still open:** verify whether Claude Code fires *both* `PostToolUse` and `PostToolUseFailure` for one failure (dedupe if so) — confirm during the build's real-session dogfood.
- **~~0.0.7 distill~~ — GRILLED 2026-06-08** → [ADR-0018](../decisions/0018-mage-distill-observed-scratch-reader.md) (amends [ADR-0005](../decisions/0005-one-canonical-memory-others-are-feeders.md) + [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) §5). Locked: distill = deterministic `mage distill --json` reader + `mage:distill` judgment skill (separate from `learn`, shares its pipeline); **notes on first sight** (recurrence/graduation → 0.0.8); per-session **offset watermark** in `.metrics/distill.json` (CLOSED-only, explicit `--seen` advance); chunk by `compact`/session boundary; **four balanced lenses** (user-corrections **first-class**, error→fix, repeated-workflow, tool-preference); salience-filter→cap-with-logged-spill; **two-stage dedup** (deterministic keyword/wing/path pre-filter → model merge); Redaction **Gate 2 = inline `mage redact` + a blocking `pre-commit` hook** via `mage connect`; **feeders cut** (own `.learnings/` only; `--from` stays a generic importer); auto-distill is a **deferred opt-in rung** (ADR-0009 lines 45/53), not forbidden.
- **0.0.8 self-grooming** *(mechanics)* — the cross-cutting is locked (ADR-0016: ladder, applier, held-out gate, context-match). Residual: recurrence/confidence **thresholds** (K, M, rate-floor), the bounded-edit budget ("textual learning rate"), rejected-edit buffer storage, the note→skill graduation **trigger**, decay scoring, consolidate heuristics, prune→archive-vs-delete. *(Build may stage promote→optimize→sweep even though the plan combines them.)*
- **0.0.9 MCP** — transport (stdio vs Streamable HTTP), tool surface (search/get over INDEX+grep), the no-vector-in-core boundary. *(Independent — grill anytime.)*

## Deferred past 0.1.0 (unplanned future 0.x — no 1.0 crowned, own ADR/grill required)

- **Literal SkillOpt bridge** — export skills + trajectories to Microsoft's SkillOpt
  optimizer, import `best_skill.md` back. A real training loop (two model backends,
  epochs, labeled splits) → opt-in, **out-of-core**, like the MCP accelerator. mage
  ships SkillOpt's *rails* in 0.0.8, not its harness. [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md)
- **Multi-repo hub graph aggregation + cross-repo `/dream`** — ADR-0012 §2 *rejects*
  cross-repo content/graph aggregation (Obsidian can't span repos). The only surviving,
  ADR-0010-blessed form is read-only memory aggregation that follows registry pointers
  *without merging graphs* — XL, needs its own grill on the sync model.

## Relations

- sequences [mage roadmap](roadmap.md)
- detailed_by [ADR-0013 — procedure skills + the self-grooming loop](../decisions/0013-procedure-skills-self-grooming-loop.md)
- detailed_by [ADR-0014 — two-gate redaction](../decisions/0014-two-gate-redaction.md)
- detailed_by [ADR-0015 — mage observe capture schema](../decisions/0015-mage-observe-capture-schema.md)
- detailed_by [ADR-0016 — context-match, the confidence ladder, and the single applier](../decisions/0016-context-match-confidence-ladder-applier.md)
- detailed_by [ADR-0017 — mage connect: the host hook adapter](../decisions/0017-mage-connect-host-hook-adapter.md)
- detailed_by [ADR-0018 — mage distill: the observed-scratch reader](../decisions/0018-mage-distill-observed-scratch-reader.md)
- detailed_by [ADR-0011 — recursive scan; hub projects are wings](../decisions/0011-recursive-scan-hub-projects.md)
- detailed_by [ADR-0012 — wings optional; standalone hubs](../decisions/0012-wings-optional-convention-standalone-hubs.md)
- feeders_from [ADR-0005 — one canonical memory; others are feeders](../decisions/0005-one-canonical-memory-others-are-feeders.md)
- recall_from [ADR-0006 — two-layer recall](../decisions/0006-two-layer-recall-per-wing-skills.md)
- mines [ADR-0007 — mine agentmemory's design](../decisions/0007-mine-agentmemory-design-not-depend.md)
- rides [ADR-0009 — no runtime; automation rides host hooks](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](../decisions/0010-durable-memory-not-coordination-layer.md)
- field_tested_by [migration field notes](migration-field-notes.md)
