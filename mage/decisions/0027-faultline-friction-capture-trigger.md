---
type: decision
tags: [mage/decisions]
created: "2026-06-20"
updated: "2026-06-20"
last_reviewed: "2026-06-20"
status: superseded
provenance:
  repo: mage-memory
  work: faultline-friction-trigger
sources:
  - src/distill/faultline.ts
  - src/distill/reader.ts
  - src/commands/nudge.ts
  - src/observe/types.ts
  - src/grooming/thresholds.ts
  - mage/notes/plan-faultline.md
  - mage/decisions/0024-organic-grooming-loop.md
  - mage/decisions/0018-mage-distill-observed-scratch-reader.md
  - mage/decisions/0017-mage-connect-host-hook-adapter.md
  - mage/decisions/0015-mage-observe-capture-schema.md
  - mage/decisions/0009-no-runtime-automation-rides-host-hooks.md
---

# 0027 — Faultline: a friction/derivation capture trigger (prefilter, not miner)

> Status: **SUPERSEDED** by [ADR-0028](0028-prose-keyed-capture.md). The pre-registered gate (§9)
> RAN and **KILLED this detector** (0/62 keeps) — see [Gate outcome](#gate-outcome-2026-06-20--kill).
> This ADR is kept as the honest record of a design that was pre-registered, gated, and falsified;
> the prose-keyed pivot the gate's diagnosis pointed to is ADR-0028. The build lives on the
> documented dead-end branch `feat/faultline-detector` (not wired). Plan:
> [plan-faultline](../notes/plan-faultline.md).

## Context

The 0.0.12 organic loop (ADR-0024) routes capture through a boundary nudge that distills the
just-closed chapter (ADR-0018) and drafts forgotten lessons. Two findings make the *unit and
the trigger* wrong for the knowledge worth keeping:

- **Recurrence is activity, not lessons.** ~93% of the ≥K recurrence signatures are the
  `workflow` lens ("a tool repeated on the same files"). The 0.0.12 proving run confirmed the
  recurrence path mints noise and the chapter-cluster path mints **grab-bags** (every drafted
  cluster scored single-responsibility ≤1 — a whole chapter mashed into one draft).
- **The durable knowledge is EARNED.** Value ≈ **cost to re-derive** − cost-to-read −
  staleness-risk. The expensive-to-re-derive moments are paid in tool-failure chains, human
  corrections, and long grinds — and they are worth capturing the **first** time, not after K
  recurrences. (This is the earned-insight thesis the pivot is anchored to; recurrence and
  access-frequency are explicitly the WRONG value signal.)

**Prior art.** ReasoningBank (Google, ICLR-2026) is the nearest twin: it distills lessons from
both successful and failed trajectories and optimizes for fewer steps next time — but it does so
with an **LLM-as-a-Judge** plus a multi-trajectory contrast (MaTTS), and lists the judge's
reliance as its #1 limitation. mage cannot embed that (ADR-0009) and only ever sees **one**
trajectory, so it cannot know "there was a simpler way" by itself.

**Phase 0 replay** of a deterministic friction detector over real logs (mage's own dev work +
adapted ops/infra transcripts) showed: it **fires and narrows** (arc-span ≪ chapter, fixing the
grab-bag), but **precision is low** (~1 genuine earned-insight per ~2000 ops events, buried in
~30 friction candidates; tool-protocol and hook-block noise dominate). A deterministic classifier
**cannot isolate** the gem. Conclusion: the detector must be a **prefilter / attention-director**,
never an autonomous miner — judgment belongs to the agent.

## Decision

1. **Faultline is a prefilter/nudge-targeter, not a miner.** It deterministically *narrows + ranks*
   a chapter's events into a short candidate list; the **host agent** (or the human at `mage groom`)
   judges whether each is a durable lesson. This **grounds** ADR-0024's "no embedded judge" in
   evidence rather than asserting it.

2. **ADR-0009, clarified.** "No model in the core" forbids a model **inside mage's engine** (no
   egress, no key, no cost, no dependency). It does **not** forbid leaning on the model already in
   the host agent — the nudge → `groom` loop is exactly that, and is the design. The standing rule
   is **lean on the host model opportunistically, depend on it never**: the core stays offline
   (ADR-0021) and degrades gracefully on a harness with no agent (ADR-0024 §7, lossless inline).

3. **New capture unit: the friction arc** (onset → resolution). `FrictionArc` additively extends
   `DistillCluster` (consumers ignore unknown fields) and populates `signals`/`hint` from **only
   the arc span** — this is what fixes the grab-bag. One arc = one draft.

4. **Three triggers** (`computeFrictionArcs`, pure, in `src/distill/faultline.ts`):
   - **A — failure→pivot:** a failing action, then within a window a *different* approach-key
     succeeds and shares a topic. Same-key success = retry (drop).
   - **B — correction→course-change:** a user correction, then the agent changes approach-key.
   - **C — grind/effort-spike:** concentrated effort on **one** topic, **with or without an error**
     (the "extra steps, then the simpler way" case). C ships behind its **own sub-switch** so the
     gate can score A+B against A+B+C and keep whichever earns its glance.

5. **Recall-first detector; precision lives downstream.** The detector is tuned to *admit
   generously* (recall), because precision now lives in **ranking** (get the gem into the surfaced
   top-3) and in **the agent's cull** at groom — not in the detector's admission rule. A missed arc
   is lossless (inline `mage stage` still catches it).

6. **Approach-key + externality are composite-command-aware.** The approach-key is the **first
   substantive verb across pipeline/`&&`/`;` segments** (skip navigational wrappers like
   `cd`/`sudo`/`mkdir`; prefer an external verb when present) — *not* the literal first token, since
   agents increasingly write multi-step commands. Externality is an **OR over the whole command**
   (external if *any* substantive verb is an external CLI). **Two buckets to start** (external CLI
   vs local file/Bash); straddlers (`git`, `npm`) default to **local** so dev-loop noise is not
   amplified. Not a full shell parser — a mis-parse degrades to a coarse key (safe under §5).

7. **Hybrid ranking.** Confidence tiers — *correction > environmental error > generic* — with a
   **cost bonus that can lift a hard grind up a tier**. **Cost = steps × tool-externality** (the
   cost-to-re-derive proxy from the thesis — NOT recurrence or access-frequency). Starting weights
   are provisional; the gate (§8) tunes them until the gem reliably lands in the top-3.

8. **Portable detector.** Harness-specific knowledge — the tool-protocol drop list (e.g. Claude
   Code's "File has not been read yet"), the environmental-error patterns (`403|permission|
   ECONNREFUSED|…`), and the externality verb-list — lives **outside** `faultline.ts`, supplied as
   parameters. Claude Code's lists live in the adapter (ADR-0017), where harness coupling already
   lives; another harness brings its own; **no lists → the detector still runs, coarser** (graceful
   degradation). **No `ObserveEvent` schema change** is needed for Phase 1 (the detector reads the
   existing `error_summary`/`detail`/`ok`/`paths` and applies the passed-in patterns).

9. **A pre-registered validation GATE, run BEFORE flipping any default.** Faultline must be
   *killable by data*:
   - **Bar:** the agent **keeps ≥1 in 3** surfaced candidates (and arc drafts beat chapter drafts
     on single-responsibility — the proving run's failing metric). **Kill if <1 in 5.**
   - **Replay can kill; only live can crown.** The verdict comes first from a **replay** of the
     detector over a corpus (cheap, decisive). A replay PASS only flips the flag on for real use;
     final default-on waits for the live reject-ledger to confirm.
   - **Corpus integrity:** multi-project ops/infra logs (where earned insight lives) **plus mage's
     own dev logs as a negative control**; a **tune/holdout split** (verdict on the held-out half
     only — no grading on our own homework); a **strict, blind, thesis-anchored judge calibrated
     against the control** (tighten until it keeps ~nothing on dev-loop noise, then measure ops);
     and an **agent-derived gold set** for a recall sanity-check (does the top-3 contain the lessons
     we know are there), human-spot-checked.

10. **Build order — detector first.** Build `computeFrictionArcs` + ranking + the replay gate
    first. **Only on a PASS** do we wire it into the live nudge, by **reusing the existing draft-3
    front-end** (swap the cluster source to ranked arcs; reword the draft banner to a *"⚑ friction
    candidate — you judge"* frame). Everything downstream (`.mage/staging/`, `composeDraft`, the
    `lessonCoveringNote` dedup, the reject ledger, the throttle, `mage:groom`) is **reused
    unchanged**. The recurrence `distill`/`promote` path is untouched.

## Consequences

- The boundary nudge surfaces **narrow, ranked friction candidates** instead of chapter grab-bags,
  and the artifact reads as a **candidate the agent judges**, never a claimed lesson.
- mage stays **model-free in its core and offline** (ADR-0009/0021 intact) — now with the explicit
  "lean on the host model, never embed/require one" reading.
- One new **pure module** (`faultline.ts`) + thresholds flags (`frictionArcs`, the C sub-switch,
  window `W`, cap); no schema change; the whole staging/groom pipeline is reused.
- The ship/kill decision is **falsifiable and pre-registered** — Faultline can be killed by the
  replay before it ever ships a default, not kept alive on vibes.
- **Deferred (Phase 2/3):** the richer inline-list picker (the agent picks from a ranked list
  instead of mage drafting 3); verification/recheck (the arc records `tried`+`worked`, enabling a
  future `mage verify-lesson` and a `volatile:`/`recheck:` durable-vs-decaying split); a read-only
  recall surface. Agent-agnostic capture continues to ride the documented `mage observe` stdin
  contract — the Claude-Code hook is just the first adapter.

## Gate outcome (2026-06-20) — KILL

The pre-registered gate (§9) ran as a replay over 5 ops/infra sessions (sreforge ×3, prismalens,
todo-app) + 3 mage-dev control sessions, chapter-windowed at cap:3, with 62 surfaced candidates
judged by blind, strict, thesis-anchored agents, every keep adversarially refuted, plus a
per-session recall check (a 68-agent workflow; harness in `~/ai-context/mage-prove-20260619/`):

- **0/62 confirmed keeps — ops 0/48, control 0/14, every pattern 0.** A decisive KILL (bar was
  ≥1/3 ship, <1/5 kill).
- **Control 0/14 validates the judge** (it wasn't lenient); **recall confirmed the gems exist and
  were missed** → a SENSOR mismatch, not a threshold/judge artifact.
- **Diagnosis:** Faultline detected friction *position* but discarded *content* — it emitted
  `tried→worked` tool-pairs with `topic:null` + boilerplate hints. The real earned lessons live in
  **correction prose + recurrent-failure strings** (context-mode WebFetch→`ctx_*` recurred 7×;
  `git --no-verify` hard-blocked across 4 sessions; "copy git history not fork"; app/load
  separation) — which leave NO tool-swap signature, so a `tried→worked`-pair detector is
  structurally blind to them. Topic extraction was also broken (cwd noise).
- The detector code is a documented dead-end (not wired); the gate methodology + harness are the
  reusable assets. The pivot is **[ADR-0028](0028-prose-keyed-capture.md)**.

## Relations

- **superseded_by** [ADR-0028](0028-prose-keyed-capture.md) — the prose-keyed pivot (corrections +
  recurrent failures) the gate's diagnosis pointed to; same gate is its success criterion.
- **extends** [ADR-0024](0024-organic-grooming-loop.md) — changes what the boundary nudge surfaces
  (friction arcs, not chapter clusters) and **grounds** its "no embedded judge" in Phase 0 evidence.
- **relates_to** [ADR-0018](0018-mage-distill-observed-scratch-reader.md) — replaces the
  chapter-cluster grab-bag as the *nudge's* capture unit; `computeDistillClusters` itself stays for
  the recurrence/distill path.
- **constrained_by** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) — no model in the
  engine, clarified: lean on the host agent's model, never embed or require one.
- **constrained_by** [ADR-0021](0021-offline-no-telemetry-local-signal.md) — offline / no egress.
- **relates_to** [ADR-0017](0017-mage-connect-host-hook-adapter.md) — harness-specific pattern and
  verb lists live in the adapter, keeping the detector portable.
- **relates_to** [ADR-0015](0015-mage-observe-capture-schema.md) — the detector reads the existing
  `ToolUseEvent` schema; no schema change for Phase 1.
