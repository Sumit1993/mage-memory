---
type: decision
tags: [mage/decisions]
created: "2026-06-20"
updated: "2026-06-20"
last_reviewed: "2026-06-20"
status: superseded
provenance:
  repo: mage-memory
  work: prose-keyed-capture
sources:
  - src/distill/reader.ts
  - src/grooming/signature.ts
  - src/grooming/tally.ts
  - src/grooming/thresholds.ts
  - src/commands/nudge.ts
  - src/observe/types.ts
  - mage/decisions/0027-faultline-friction-capture-trigger.md
  - mage/decisions/0024-organic-grooming-loop.md
  - mage/decisions/0019-mage-promote-self-grooming.md
  - mage/decisions/0018-mage-distill-observed-scratch-reader.md
  - mage/decisions/0009-no-runtime-automation-rides-host-hooks.md
---

# 0028 — Prose-keyed capture: corrections + recurrent failures (supersedes Faultline)

> Status: **SUPERSEDED** by [ADR-0029](0029-digest-to-agent-capture.md). It superseded
> [ADR-0027](0027-faultline-friction-capture-trigger.md)'s tool-transition detector (gate-KILLED
> 0/62); it was then BUILT and run through the same pre-registered gate, which **KILLED it too**
> (0/55) — see [Gate outcome](#gate-outcome-2026-06-20--kill). Kept as the honest record of a second
> pre-registered, gated, falsified design; the digest→agent pivot the diagnosis pointed to is
> ADR-0029. The build lives on the documented dead-end branch `feat/prose-keyed-capture` (not wired).

## Context

ADR-0027 built Faultline — a deterministic detector keyed on the *tool-transition* shape of friction
(approach-key, `tried→worked` pairs, failure→pivot / correction→reset / grind). Its pre-registered
gate ran (replay over 5 ops sessions + 3 mage-dev control; blind strict judges + adversarial refute +
recall) and returned a **decisive KILL: 0/62 confirmed keeps (ops 0/48, control 0/14).**

The diagnosis is the reason for this ADR: Faultline detected the *position* of friction but discarded
its *content*. The durable lessons in real ops work live in **correction prose** and **recurrent
failure strings** — *"copy git history, don't fork"*, app/load separation, `git --no-verify` blocked
across 4 sessions, context-mode intercepting `WebFetch`→`ctx_*` **7×** — none of which leave a
tool-swap signature, so a `tried→worked`-pair detector is *structurally blind* to them. The control's
0/14 proved the judge was sound; recall proved the gems exist and were missed → a **sensor mismatch**,
not a tuning problem.

The key enabling fact: **`src/distill/reader.ts` already extracts this content** — `signals.corrections`
is the user-prompt text of every correction; `signals.failures` is every error string. The distill
path never discarded the prose; Faultline did. Distill's *own* flaw (the earlier proving run) was a
different one: the capture **unit** was a whole-chapter grab-bag, with no recurrence weighting and no
noise filter.

## Decision

1. **Supersede the Faultline tool-transition detector.** The approach-key, `tried→worked` arcs, A/B/C
   patterns, grind, and externality-cost are abandoned for capture. `faultline.ts` is a documented
   dead-end, not wired.

2. **Pivot = fix/narrow the EXISTING distill path, not a new module.** Reuse `reader.ts`'s
   correction/failure extraction; the change is three surgical edits (unit, filter, recurrence), not a
   new sensor.

3. **Capture unit = two CONTENT signals, asymmetric by design:**
   - **Substantive correction — surfaced at ANY frequency.** A human bothering to steer is inherently
     high-signal. The detector surfaces the correction TEXT (one candidate per correction), filtering
     only *obvious* noise (continuation tokens `continue`/`next`/`ok`/`commit`, compaction boilerplate,
     very short prompts). It does NOT try to classify "correction vs next-task" — it can't; it surfaces
     broad and **the agent culls** (ADR-0009).
   - **Recurrent failure — surfaced ONLY when its content recurs ≥K.** A one-off failure is noise
     (Phase 0: ~1 gem per ~2000 events); recurrence *is* the signal.

4. **Failure signature = conservative skeleton normalization.** Lowercase; strip ONLY clearly-variable
   parts (URLs, paths, UUIDs/hashes, long numbers, quoted specifics); keep the error phrase + short
   status codes; cluster by that. **Conservative/precise — miss-don't-manufacture:** for failures
   recurrence is the entire signal, so a too-coarse normalizer that *manufactures* fake recurrence
   poisons the high-precision channel, whereas a missed variant is lossless (inline `mage stage` still
   catches it).

5. **Recurrence counting = KB-wide, cross-session, distinct-chapter, K=3 (tunable).** Cross-session is
   required (`--no-verify` recurred across 4 *sessions*). Counting **distinct chapters** (not raw
   occurrences) is what separates a recurring gotcha from a tight retry loop. K defaults to 3 (mirrors
   `promoteSessions`) in `thresholds.ts`, gate/soak-tunable. Implementation: **reuse/repoint the
   existing recurrence tally** (`signature.ts`/`tally.ts`) — today it counts *tool*-signatures (the
   ~93% workflow-lens noise, ADR-0024); point it at conservative *failure-content* signatures instead.
   This is the recurrence machinery aimed at the right target.

6. **Ranking = a hypothesis the gate adjudicates, NOT a locked principle.** Start: recurrent-failures
   by distinct-chapter count, then cue-corrections (contradiction cues `no`/`don't`/`instead`/
   `actually`/`wrong`/`should`/`rather`), then no-cue corrections; cap = `stagingBudget` (3). We do
   NOT hard-code "failures > corrections" — Faultline hard-coded "corrections > failures" and the gate
   disproved exactly that kind of assumption. Per-type keep-rates from the gate set the real order.

7. **ADR-0009 intact.** The detector surfaces TEXT (correction prose; failure skeleton + count); it
   runs no model. The agent judges/extracts the lesson at `mage:groom`. Reuses `.mage/staging/`,
   `composeDraft`, `lessonCoveringNote` dedup, the reject ledger, the throttle, and the boundary nudge
   unchanged — only the candidate *unit* changes (per-correction / per-recurrent-failure, not
   per-chapter cluster).

8. **Success criterion = the SAME replay gate.** Re-run the gate harness over the same 5 ops sessions +
   control: **keep ≥1/3 → ship behind the flag; <1/5 → kill the deterministic-capture LINE** (don't
   iterate). Per-type keep-rates (corrections vs recurrent-failures) decide which signal earns its slot
   and fix the ranking.

## Consequences

- The boundary nudge surfaces **correction prose + recurrent-failure content** (text the agent can
  shape into a lesson), never tool-pairs.
- Two *existing* paths change — the distill reader (narrow unit + correction noise-filter) and the
  recurrence tally (repointed from tool-signatures to failure-content). **No new mechanism**; mage
  stays model-free and offline (ADR-0009/0021).
- The Faultline detector + its 42 tests are a **documented negative result** (kept on
  `feat/faultline-detector` for reference, not shipped). The gate methodology + harness
  (`~/ai-context/mage-prove-20260619/`) are the reusable assets and the standing bar.
- If the gate re-run fails (<1/5) on a corpus where the gems *demonstrably exist*, the deterministic
  boundary-capture line is killed rather than iterated — corrections fall to the **inline** path
  (ADR-0024 inline-primary; the agent knows in-flow when it was corrected).

## Gate outcome (2026-06-20) — KILL

The prose-keyed capture was BUILT (`src/distill/prose.ts` — `failureSkeleton`, the correction
noise-filter + contradiction cues, `correctionCandidates`, `recurrentFailures` distinct-chapter ≥K,
ranking; 33 unit tests) and replayed through the SAME gate as Faultline (harness:
`~/ai-context/mage-prove-20260619/prose-gate-replay.mts`) over the SAME 5 ops + 3 control sessions:
55 candidates (ops 37 / control 18; 53 corrections [34 cued] + **2 recurrent-failure gems** — the
`--no-verify` hook block and the context-mode `curl/wget→ctx_*` redirect, both invisible to Faultline),
judged blind + strict + adversarially refuted + per-session recall (a 68-agent workflow).

- **0/55 confirmed keeps — ops 0/37, control 0/18, corrections 0/53, recurrent-failures 0/2.** A
  decisive KILL (bar was ≥1/3 ship, <1/5 kill). Per §8's pre-registration this **kills the
  deterministic boundary-capture LINE** (don't iterate the deterministic selector).
- **Control 0/18 validates the judge** (strict, not lenient); even the 2 real gems were rejected as
  self-documenting (the error message states the rule → re-derivation cost ≈ 0).
- **Diagnosis (triangulated with Faultline's 0/62):** the prose key surfaced cheap conversational
  *steering* (scoping questions, product direction) and starved the failure/command stream where the
  real lessons live. Recall found the gems the surfaced set missed — every one a **single-session
  friction/derivation ARC in the failure + external-command stream** (a WebFetch→curl→render→PNG
  pipeline; a 6-command npm/GH name+identity recon; the act_runner empty-token fix; GitHub-Free blocks
  branch-protection; an f-string-in-heredoc trap). External commands got **no candidate at all**; the
  cross-session K=3 gate starved single-session and variant-split gems. The recall agents (models
  reading the digest) FOUND the gems → the bottleneck is deterministic SELECTION of a purely-semantic
  property (durability), which a model-free core cannot do.
- The detector is a documented dead-end (`feat/prose-keyed-capture`, not wired); the gate methodology +
  harness are the reusable assets. The pivot is **[ADR-0029](0029-digest-to-agent-capture.md)**
  (deterministic narrowing → digest → host-agent judgment).

## Relations

- **superseded_by** [ADR-0029](0029-digest-to-agent-capture.md) — the digest→agent pivot (deterministic
  narrowing + host-model judgment) the gate's diagnosis pointed to; same model-swept gate is its bar.
- **supersedes** [ADR-0027](0027-faultline-friction-capture-trigger.md) — the tool-transition detector,
  killed by its own pre-registered gate.
- **amends** [ADR-0024](0024-organic-grooming-loop.md) — same organic loop (inline-primary + boundary
  nudge + no embedded judge); changes only what the nudge surfaces.
- **relates_to** [ADR-0018](0018-mage-distill-observed-scratch-reader.md) — the distill reader is
  reused and narrowed (the correction/failure extraction is its `signals`).
- **amends** [ADR-0019](0019-mage-promote-self-grooming.md) — repoints the recurrence tally from
  tool-signatures to failure-content signatures.
- **constrained_by** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) — no model in core;
  the detector surfaces text, the agent judges.
