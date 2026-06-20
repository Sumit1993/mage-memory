---
type: plan
tags: [mage/grooming, mage/faultline, mage/capture]
created: "2026-06-20"
updated: "2026-06-20"
last_reviewed: "2026-06-20"
status: active
provenance:
  repo: mage-memory
  work: faultline-friction-trigger
sources:
  - src/commands/nudge.ts
  - src/distill/reader.ts
  - src/observe/types.ts
  - mage/decisions/0024-organic-grooming-loop.md
---

# Faultline — friction/derivation capture trigger (Phase 1 plan)

> Status: **BUILT → GATE-KILLED → SUPERSEDED.** Grilled 2026-06-20 → ADR-0027 → built
> (`feat/faultline-detector`, 42 tests) → the pre-registered replay gate **KILLED it (0/62 keeps)**.
> Diagnosis: the tool-transition detector captured friction *position* but not *content*; the real
> lessons live in **correction prose + recurrent-failure strings**. The pivot is
> **[ADR-0028 — prose-keyed capture](../decisions/0028-prose-keyed-capture.md)** (supersedes ADR-0027).
> This note + ADR-0027 are kept as the honest record of a falsified design; **ADR-0028 governs going
> forward.** Gate detail in [ADR-0027 Gate outcome](../decisions/0027-faultline-friction-capture-trigger.md#gate-outcome-2026-06-20--kill).

## Why

mage's recurrence signal is ~93% workflow-lens — "you repeated a tool" — which is
*activity, not lessons* (see [plan-0.0.12](plan-0.0.12-organic-grooming-loop.md) and
[ADR-0024](../decisions/0024-organic-grooming-loop.md)). The durable knowledge worth
storing is **earned**: expensive to re-derive (paid in tool-failures, trial-and-error, or
a human correction), captured the FIRST time, not after K recurrences. The proving run
confirmed the recurrence path mints noise and the distill path mints grab-bags. Faultline
re-aims capture from *recurrence-of-activity* to *friction-of-discovery*.

## The one change

The boundary nudge already does the right SHAPE — `nudgeCmd` (SessionStart `source:compact`)
runs `readDistill` → drafts up to `stagingBudget` lessons into `.mage/staging/` → emits a
one-line `mage:groom` nudge (`src/commands/nudge.ts`). Phase 0 proved two things about it:

1. The **unit is wrong** — `computeDistillClusters` chops at compact/session_end, so each
   cluster is a whole-chapter grab-bag (every proving-run draft scored single-responsibility ≤1).
2. A deterministic detector **cannot decide** what's a durable lesson (~1 real earned insight
   per ~2000 ops events, buried in ~30 friction candidates; tool-protocol + hook-block noise
   dominates).

So Phase 1 is **not** a new mechanism and **not** an autonomous miner. It is two edits to the
signal that already flows through the nudge:

- **Change the unit**: surface **friction arcs** (onset→resolution), not chapters. One arc = one draft.
- **Change the framing**: the draft is an explicitly-labelled **candidate the agent judges/shapes or
  rejects at `mage:groom`** — never a claimed lesson. The detector *narrows + ranks*; the agent decides.

Everything downstream — `.mage/staging/`, `composeDraft`, `lessonCoveringNote` dedup, the reject
ledger, the throttle, `mage:groom` — is **reused unchanged**.

## 1. The detector (`src/distill/faultline.ts`, pure, ADR-0009-clean)

`computeFrictionArcs(events: ObserveEvent[], opts): FrictionArc[]` — a pure fold over the same
closed region `computeDistillClusters` reads.

**Two patterns** (ship both this phase; rank B above A):

- **A. failure→pivot**: a `tool_use{ok:false}` (approach-key `Kf`), then within window `W` tool_uses
  (not crossing a terminator) a `tool_use{ok:true}` whose approach-key `≠ Kf` **and shares a topic**
  with the failure. Same-key success = a retry (drop). Consecutive failures collapse to one arc.
- **B. correction→course-change**: a `user_prompt` immediately after a `tool_use` (the existing
  correction adjacency in `extractSegment`), where the agent's next action changes approach-key.
  **Rank above A** — Phase 0's one real lesson (the WSL/agy gotcha) was correction-driven.

**The approach-key** (the load-bearing primitive): Bash → first non-builtin verb of `detail`; path
tools → `tool:path-stem`. "Same key recurring" = activity (not a trigger); "different key resolves a
failure/correction" = friction.

**Two deterministic filters Phase 0 found necessary:**
- **same-intent topic link** — recovery must share a ≥4-char non-boilerplate token with the failure
  (dropped 58% of dev / 23% of ops false positives).
- **tool-protocol drop** — reclassify `ok:false` whose error is a harness protocol rule ("File has not
  been read yet", "String to replace was not found", schema-mismatch) as NON-failures. These are never
  domain lessons (the dominant ops noise).

**Ranking** (so the nudge surfaces the strongest, not all): `correction (B) > external/env-error
failure > generic failure`. External/env = error matches `403|401|5xx|permission|ECONNREFUSED|
ENOTFOUND|hook error|timed out|command not found|...`. Cap surfaced = `stagingBudget` (already 3).

**`FrictionArc` = the capture unit** (additively extend `DistillCluster`, consumers ignore unknown
fields per `observe/types.ts`): `pattern` (`failure-pivot|correction-reset`), `onset`/`resolution`
event refs, `tried` (abandoned approach-key), `worked` (resolving key), `topic`, `cost` (events-in-span
= re-derivation-cost proxy — the thesis value fn, NOT access frequency), plus the existing
`signals`/`hint` populated from ONLY the arc span (this is what fixes the grab-bag).

## 2. Integration (small diff to `nudge.ts`)

- Add `computeFrictionArcs` beside `computeDistillClusters`; gate via a `thresholds.ts` flag
  (`frictionArcs: boolean`, `W`, `frictionCap`) — same seam as `MIN_CHAPTER_WORK_EVENTS`, soak-tunable.
- In `nudgeCmd`, when the flag is on, the cluster source becomes ranked friction arcs (capped), not
  chapter clusters. `draftCluster` works as-is (an arc IS a narrow cluster).
- **Reframe `clusterToDraft`** for arcs: the banner becomes *"⚑ Friction candidate (you tried `{tried}`,
  `{worked}` worked) — is there a durable lesson here? Shape or reject at `mage:groom`."* Body = the
  arc-span signals only. This makes the "you judge" contract explicit in the artifact.
- Recurrence `distill`/`promote` path and `hasRepeatedTool` are **untouched** (kept for the recurrence
  K/M rung).

## 3. What this phase explicitly does NOT do (deferred)

- **No autonomous "this is a lesson" claim.** The human-in-loop `mage:groom` confirm + commit is unchanged.
- **No verification/recheck yet.** The arc captures `tried`+`worked` (which makes a future
  `mage verify-lesson` possible — replay `worked` still succeeds, `tried` still fails). The durable/
  `volatile:` split + `recheck:` field + the read-only command classifier are **Phase 2/3**.
- **No MCP / new agent surface.** Agent-agnostic capture rides the **documented `mage observe`
  stdin contract** (make it a stable public interface + a one-page "wire your harness" doc); the
  Claude-Code hook is just the first adapter. A read-only MCP recall resource is later/optional.

## 4. Honest success criterion (set by Phase 0, not aspirational)

Success is **NOT** "the detector is right." It is: at a compact boundary, the agent is shown a **short
ranked list (≤3) of friction candidates instead of thousands of raw events**, and finds the real lesson
in it often enough to be worth one glance — then shapes it via the existing LESSON path. The detector's
job is attention-direction; judgment stays with the agent (ADR-0024 "no embedded judge", now grounded).

## 5. Build order + tests

1. `faultline.ts` + `FrictionArc` type + thresholds flag. Unit tests: failure-pivot fires only on
   different-key+linked success; retry/unlinked/tool-protocol all drop; correction-reset; arc-span ⊂
   chapter; overlap = outermost-wins.
2. Wire into `nudge.ts` behind the flag; reframe the arc draft text. Test: arc drafts are single-arc
   (span < chapter); dedup/reject/throttle still hold; flag off = today's behaviour byte-for-byte.
3. Soak behind the flag on a real KB; compare staged-draft single-responsibility vs chapter drafts
   (the proving-run's failing metric). Promote the flag default only if it visibly improves.

## 6. Open risks (carried from Phase 0)

- Approach-key precision (Bash `curl X` vs `curl -L X` collapse) — conservative miss-not-invent; a
  missed arc falls through to inline `mage stage` (lossless).
- `ok:false` semantics vary by harness (Bash exit-codes vs is_error) — the `mage observe` adapter must
  normalize; document it in the public contract.
- Nudge fatigue — the `stagingBudget` cap + throttle already bound it; rank well so the ≤3 shown are
  the strongest.

## The evidence (Phase 0)

A pure-function replay of `computeFrictionArcs` over existing `.mage/learnings` logs (mage's own dev
work) AND adapted raw transcripts from ops/infra projects (sreforge SRE, prismalens, todo-app):

- **Fires + fixes the grab-bag**: 114 arcs on dev logs (3.8/chapter), arc-span median ~2 events vs
  chapter median ~500–1700; the approach-key separated pivots (114) from retries (26).
- **But precision is low**: the same-intent link dropped 58% (dev) / 23% (ops) as incidental; even the
  survivors were ~all dev-loop incidents (dev) or operational iteration + tool-protocol + hook-blocks
  (ops). On ops work the real earned-insight seam exists (`gh api` branch-protection "may 403 on free
  plan") but is ~1 gem per ~2000 events — a deterministic classifier cannot isolate it.
- **Conclusion**: the detector is a prefilter/nudge-targeter; judgment belongs to the agent. This is the
  reframe above.

## Pointers

- [plan-0.0.12-organic-grooming-loop](plan-0.0.12-organic-grooming-loop.md) — the loop this extends.
- [ADR-0024](../decisions/0024-organic-grooming-loop.md) — "no embedded judge"; Phase 0 grounds it.
- `src/commands/nudge.ts` — the integration point (`readDistill` swap).
- `src/distill/reader.ts` — `computeDistillClusters` (the chapter-cluster grab-bag this replaces).
- `src/observe/types.ts` — the `ObserveEvent` / `ToolUseEvent {ok, error_summary, detail, paths}` schema.
