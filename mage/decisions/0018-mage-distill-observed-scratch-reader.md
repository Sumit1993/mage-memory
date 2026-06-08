---
type: decision
tags: [mage/decisions]
created: "2026-06-08"
updated: "2026-06-08"
last_reviewed: "2026-06-08"
status: active
provenance:
  repo: mage-memory
  work: grill-distill-0.0.7
sources:
  - src/ingest.ts
  - src/metrics/rollup.ts
  - src/commands/connect.ts
  - skills/learn/SKILL.md
  - ~/.claude/skills/continuous-learning-v2/agents/observer.md
---

# 0018 — `mage distill`: the observed-scratch reader (capture, on first sight)

A 2026-06-08 grill locked **distill** — release 0.0.7, the stage that turns the
keystone `.learnings/*.jsonl` ([ADR-0015](0015-mage-observe-capture-schema.md)) into
durable notes. observe (0.0.5) writes the scratch; connect (0.0.6) makes it auto-fire
and reads the read-only metrics; **distill reads the scratch and proposes notes.** This
ADR fixes distill's command surface, what it emits, how it stays idempotent, how it
chunks and dedups, where redaction blocks, and what it deliberately leaves out. The
*compute* it shares with 0.0.8 (context-match, recurrence) is
[ADR-0016](0016-context-match-confidence-ladder-applier.md); the schema it reads is
[ADR-0015](0015-mage-observe-capture-schema.md). Grilled against ECC
`continuous-learning-v2`'s observer (a separate Haiku daemon).

## Decision

1. **distill is a deterministic *reader* + a judgment *skill*** ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)'s
   determinism line). `mage distill --json` is **plumbing**: it reads mage's own
   `.learnings/*.jsonl`, groups un-distilled events into **candidate clusters**, attaches
   salient signals, and emits compact JSON — no model. `mage:distill` is the **judgment
   skill**: the host agent reads the clusters and drafts notes. This mirrors the existing
   `mage ingest --json` → `mage:learn --from` split. It is a **dedicated** command, not an
   `ingest` overload: `ingest` enumerates an arbitrary *foreign* dir (a `.jsonl` is an
   opaque `transcript`); `distill` reads mage's *own* ADR-0015 schema with a watermark.

2. **distill writes human-confirmed notes on *first sight*; recurrence is 0.0.8.** A
   single striking insight earns a note the first time it is seen — recurrence is the
   wrong gate for a cheap, reversible note. So 0.0.7 is a complete, independently-useful
   pass: read → cluster → draft → overlap-check → redact → human-confirm → **write the
   note**. The *automatic* recurrence-surfacing, **note→skill graduation**, and the
   [ADR-0016](0016-context-match-confidence-ladder-applier.md) §4 proposal queue are all
   **0.0.8** — they operate *on the notes distill produces*.

3. **Idempotency: a per-session offset watermark, CLOSED-only, advanced on explicit
   disposition.** distill keeps a bookmark — `Record<session, offset>` in
   `mage/.metrics/distill.json` (gitignored, derived, sibling of the context-match
   rollup; same never-regress `Math.max` rule). The reader offers only events from
   **closed** segments (up to the last `compact`/`session_end`) — the in-flight session
   is never half-distilled, mirroring the metrics fold scoring only CLOSED windows.
   `mage distill --json` is a **pure read**; `mage distill --seen <session>:<offset>`
   advances the watermark **after** the human dispositions a batch (keep / skip). An
   interrupted run does not advance, so a re-run safely re-offers — the overlap-check
   (§6) dedupes anything already written. Advancing past *reviewed-and-skipped* events is
   distill's negative memory (no separate rejected-buffer in 0.0.7).
   - **Slow-burn evidence is NOT solved by a wider window.** Evidence for one pattern can
     straddle the bookmark (a faint signal in session A, another next week). You cannot
     re-read across it — raw events age-purge. The bridge is a **separate persistent
     tally** (the rollup pattern), a *second consumer with its own bookmark* that folds
     every closed event — including ones distill skips — into a per-pattern count that
     survives purge. That consumer is **0.0.8 promote**; distill's bookmark moving past a
     faint signal does no harm because promote already counted it. **Forward-commit:**
     0.0.8 recurrence is **fold-based/incremental, never backfill-from-raw**.
   - **Accepted boundary:** events that age-purge from `.learnings/` *before* distill runs
     are lost (observe's purge is not watermark-aware). distill is periodic/opt-in; run it
     within the purge window. Coupling purge to the watermark is a later refinement.

4. **The reader chunks mechanically; the skill reasons over four balanced lenses.** The
   reader chops un-distilled events at **`compact`/session boundaries** (the natural
   "chapters", and already the closed-window unit) and attaches cheap signals; the agent
   is free to split/merge. The judgment lenses (ported from ECC's observer, **rebalanced**
   so distill is not error-fix-dominant):

   | Lens | Signal in the schema | mage note-type |
   |---|---|---|
   | **① User corrections & nudges** *(first-class)* | a `user_prompt` following an agent action — "no, do it this way", "actually I meant…", a steer | `principle` / `gotcha` — standing intent |
   | **② Error → fix** | `tool_use` `ok:false` then a fix | `gotcha` |
   | **③ Repeated workflow** | the same tool sequence ≥N times | `playbook` |
   | **④ Tool / approach preference** | a consistent tool choice | `playbook` / `principle` |

   The reader surfaces all four signals — crucially it flags a **`user_prompt` adjacent to
   a preceding `tool_use`** (the "agent did X → human reacted" shape) so the correction
   lens has scaffolding, not just the failure lens. Direct human feedback is the
   highest-signal durable knowledge; the `mage:distill` prose and its worked example lead
   with a *user correction*, not a stack trace.

5. **Bound a huge chapter by salience-filter, then cap with a logged spill.** A long
   stretch with no `compact` can be one giant chapter. The reader keeps only the *salient*
   events (the four signals; ADR-0015 §4's "salient extract, not transcript") and drops
   routine ones; only if the salient set is still too large does it cap and spill the rest
   to the next run, **`log()`-ing that it capped** (no silent truncation).

6. **Dedup is two-stage: a deterministic pre-filter, then a model merge.** A batch emits
   many candidates, so two new dedup problems arise — duplicates *within* the batch, and
   candidates that restate an *existing* note. **(a) Deterministic, free:** `INDEX.md`
   already lists keywords per note; cluster candidates sharing keywords/wing/touched-paths,
   and for each candidate pull only the INDEX lines whose keywords intersect — not the
   whole index. **(b) Model, on the narrow set:** merge within a cluster, then make the
   existing `mage:learn` call — UPDATE / NEW / **supersede** a contradicted note. The
   pre-filter keys on the *same dimensions* (keywords/wing/paths) as context-match, reusing
   machinery the codebase has.

7. **Redaction Gate 2 sits at two levels; 0.0.7 adds the blocking one.** distill is the
   release that mass-produces *tracked* notes from raw scratch — the moment a miss is most
   likely. **Level 1 (reused):** inline `mage redact` per draft in the skill (note-write
   boundary; judgment-tier, skippable). **Level 2 (new):** a **blocking git `pre-commit`
   hook** (`mage redact --check --staged`) installed by `mage connect`, deterministic and
   un-skippable at the actual tracked write — the only gate that also protects a future
   auto-distill rung. Policy is [ADR-0014](0014-two-gate-redaction.md) §2: **block** a
   high-confidence *live secret*, **warn** low-confidence PII, with `git commit
   --no-verify` as the human escape hatch. The installer uses connect's discipline
   (refuse-don't-clobber an existing hook, idempotent by marker, `.bak` first) and is
   **independently toggleable** (the safety net without auto-capture). This realizes
   ADR-0014's amendment (Gate 2 as a mage-installed pre-commit hook).
   - **Gate 2 is SCOPED to the knowledge base, not the whole repo.** Per ADR-0014 §2
     the protected surface is the tracked, *shared* KB — the notes/skills mage authors
     under the **docs root** (`mage/` in-repo, or the hub root) — because that is the
     only surface mage writes to and the only seam where a distilled secret becomes
     public. So `mage redact --check --staged` scans only staged files **under the docs
     root**; application source (`src/`, **including a redaction tool's own
     secret-shaped test fixtures**) is out of scope by design — mage is not a general
     repo secret-scanner ([ADR-0010](0010-durable-memory-not-coordination-layer.md);
     that is gitleaks' job). A hub scans everything (the repo *is* the KB); a repo with
     no mage KB is a no-op gate. This scoping is also what lets **mage run its own
     Gate-2 hook** (it scans `mage/`, never the `src/` fixtures) — surfaced by the build
     dogfood ([gotcha](../notes/gate2-blocks-own-redaction-fixtures.md)).

8. **distill works on mage's own artifacts only — no feeders.** mage reads the
   `.learnings/` *it* created; foreign memory stores (ECC instincts, Claude `MEMORY.md`)
   are **ignored, not harvested** — they have their own creation standards and lifecycle,
   harvesting *duplicates* rather than consolidates, and ingesting their formats couples
   mage to third-party schemas ([ADR-0007](0007-mine-agentmemory-design-not-depend.md):
   *don't depend*). `mage:learn --from <dir>` stays a **generic** doc importer (any folder
   → notes by pointer); the `feeder-ecc`/`feeder-native` special-casing (classification +
   lower-confidence lane + reconciliation) is **removed**. This **amends
   [ADR-0005](0005-one-canonical-memory-others-are-feeders.md)** (the "demote others to
   feeders that `/learn` harvests" clause) and **[ADR-0013](0013-procedure-skills-self-grooming-loop.md)
   §5** (its ECC/native-feeder half), and **strengthens**
   [ADR-0017](0017-mage-connect-host-hook-adapter.md) §5 ("`mage connect` fully ignores
   ECC"). mage stays canonical *for what mage captures*; other tools are independent
   neighbors, not rivals to absorb.

9. **distill is a separate `mage:distill` skill sharing learn's pipeline.** `learn` and
   `distill` fire at different moments (`learn` = "capture this one finding now",
   user-typed; `distill` = "mine the accumulated record", *nudged* at `PreCompact`/
   session-end), so distill gets its **own trigger** — and 0.0.8 a cleanly
   context-matchable target. DRY is preserved by sharing the *pipeline*, not the skill:
   both funnel into the same back half (classify → overlap-check → Gate 2 → confirm →
   write); `mage:distill` carries only the front half (trigger, the four lenses, the
   reader invocation, batch dedup, the `--seen` commit).

10. **Auto-distill is a deferred opt-in rung, not forbidden.** ADR-0009 rejects a
    *persistent mage-owned daemon as the core* — it does **not** forbid a separate model
    process; it defers it ("automation is a stated goal once trust builds", line 45;
    "opt-in auto-capture observe-loop", line 53). 0.0.7 is **Rung A** (human-confirmed,
    rides the host agent — the trusted core). A later opt-in rung may fire a
    background/headless model that auto-distills by consuming the **same**
    `mage distill --json` manifest + watermark. The deterministic reader is the seam that
    keeps that door open; the determinism line (judgment in a *model*, never the CLI) holds
    regardless of *which* model runs it.

## Considered options

- **Reuse `mage:learn --from .learnings/` verbatim** — rejected: treats the schema'd event
  log as an opaque transcript; no watermark, re-distills already-seen events.
- **Withhold notes until recurrence (distill incomplete without promote)** — rejected:
  0.0.7 would ship a dead-end; notes are cheap and worth keeping on first sight.
- **Optimistic auto-advance of the watermark** — rejected: an interrupted run silently
  loses un-reviewed events; advance only on explicit disposition.
- **Model-clustering inside the reader (ECC's daemon model)** — rejected: smuggles a
  reasoner into the CLI (ADR-0009); semantic clustering is the skill's job. mage has the
  richer schema (compact/session/user_prompt) ECC lacks, so the reader can chop
  mechanically where ECC could only batch ~20 raw observations.
- **Keep feeders (harvest ECC/native)** — rejected: couples to foreign formats, duplicates
  rather than consolidates, expands the trust surface; "ignore foreign artifacts" already
  half-canon (ADR-0017 §5).
- **distill as a mode of `mage:learn`** — rejected: no distinct trigger, bloats learn's
  focus; a separate skill sharing the pipeline is cleaner.

## Consequences

- One new plumbing command (`mage distill --json` / `--seen`), one new skill
  (`mage:distill`), and a new gitignored watermark (`mage/.metrics/distill.json`).
- `mage connect` gains the opt-in blocking `pre-commit` redaction hook (`mage redact
  --check --staged`, a new mode of `mage redact`).
- `src/ingest.ts` loses `feeder-ecc`/`feeder-native` classification; `skills/learn/SKILL.md`
  loses its feeder lane; ADR-0005 / 0013 §5 get amendment banners.
- 0.0.8 builds recurrence on a **separate incremental tally**, not by re-reading raw
  events; note→skill graduation operates on distill's notes.
- The reader + watermark are the seam a later opt-in auto-distill rung consumes.

## Relations

- realizes [ADR-0013 — procedure skills + the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) — the distill rung of scratch → note → skill
- reads [ADR-0015 — the capture schema](0015-mage-observe-capture-schema.md)
- shares_compute_with [ADR-0016 — context-match, ladder, applier](0016-context-match-confidence-ladder-applier.md) — 0.0.8's recurrence tally
- gated_by [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md) — realizes the Gate-2 pre-commit hook
- rides [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) — Rung A now, auto-distill a deferred opt-in
- amends [ADR-0005 — one canonical memory; others are feeders](0005-one-canonical-memory-others-are-feeders.md) — feeders cut
- amends [ADR-0013 §5](0013-procedure-skills-self-grooming-loop.md) — ECC/native feeder half removed
- strengthens [ADR-0017 — mage connect](0017-mage-connect-host-hook-adapter.md) §5 — fully ignore foreign observers
- mines ECC `continuous-learning-v2` (observer daemon, the four pattern lenses)
- sequenced_by [release sequence](../notes/plan-release-sequence.md)
