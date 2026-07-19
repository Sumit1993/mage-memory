---
type: note
tags:
  - mage/roadmap
created: "2026-07-12"
last_reviewed: 2026-07-12
status: active
provenance:
  repo: mage-memory
  commit: a170610
sources:
  - src/provenance.ts
  - src/note.ts
  - mage/decisions/0031-programmatic-provenance-stamp.md
  - cc-session:d9b17997-d946-40f3-9aea-84b5b7d99b6c
keywords:
  - 0.1.0
  - gate
  - adr-0031
  - phase-2
  - reject-ledger
  - keep-rate
  - reconciler
  - provenance-source
  - capture-vs-adopt
  - a1-bake
  - autonomy
  - crown-threshold
---

# 0.1.0's last build gate: ADR-0031 Phase 2 — the reject-ledger reconciler (built; bake pending)

**ADR-0031 Phase 2 was the last *build* gate before the 0.1.0 cut — and it is now built** (the
reject-ledger reconciler + `provenance.source` + keep-rate surfaces). Everything else on the
[release path](plan-release-sequence.md#the-autonomy-track--what-010-now-delivers-adr-00290036)
is done or non-gating: the four autonomy ADRs are ratified, 0.0.12 **and** 0.0.13 shipped (npm),
the docs site landed. With Phase 2 built, the only thing between here and the cut is the **bake** —
letting the soak run and reading a real keep-rate. This was the load-bearing piece because it is
what makes the **a1 autonomy bake gate measurable at all.**

## Why it gates the cut

0.1.0's bake gate (from the release sequence) is: *the soak produces durable notes the
maintainer **keeps** — a healthy keep-vs-`git revert` ledger.* That keep-rate is
[ADR-0030](../decisions/0030-agent-autonomy-ladder.md)'s crown signal — the only evidence that
higher autonomy is worth it. **Phase 2 is the code that computes it** — until it existed the gate
was not "failing" but *unfalsifiable*, which is exactly what the soak monitor reported (its dated
chapters read *"Keep-rate not computed"*). With the reconciler landed the keep-rate is computable;
the monitor still needs wiring to read `.mage/metrics/keep-rate.json`. See the
[soak targets](soak-targets.md) note for the monitor's layout, cadence, and where its chapters live.

## Code state (Phase 2 built)

- **Phase 1** (`src/provenance.ts`) stamps `provenance` (`autonomy`/`repo`/`commit`) at the promote
  chokepoint — the *who-wrote-it* half.
- **Phase 2 — built.** `src/grooming/reconcile.ts` classifies each stamped note
  **keep/edited/discard/reject/pending** against git HEAD, accumulates a per-autonomy keep-rate in
  `.mage/metrics/keep-rate.json`, and surfaces it in the nudge line + dashboard Soak tile. No new
  verb (rides `mage nudge`), **no** model, fail-open, idempotent.
- **`provenance.source` (capture|adopt) — added.** The keep-rate counts **only** `source==="capture"`
  terminals, so the one-time 2026-06-27 adopt backfill can no longer be mistaken for fresh capture.

## What remains (the bake, not a build)

None of it blocks on design:
1. **Register the crown-threshold value** — the config field exists (`grooming.crownThreshold`) but is
   deliberately unset (ADR §7: no data to calibrate until the soak runs).
2. **Wire the soak monitor** to read `.mage/metrics/keep-rate.json` so the rate shows in the digests.
3. **Bake** — let the soak run, read a real keep-rate, and the a1 gate becomes a pass/fail.

## Relations

- gates [release sequence — the autonomy track](plan-release-sequence.md)
- realizes_phase_2_of [ADR-0031 — programmatic provenance + the reject-ledger](../decisions/0031-programmatic-provenance-stamp.md)
- measures [ADR-0030 — the autonomy ladder's crown signal](../decisions/0030-agent-autonomy-ladder.md)
- observed_by [soak targets — the read-only monitor](soak-targets.md)
