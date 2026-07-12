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

# 0.1.0 is gated on ADR-0031 Phase 2 — the reject-ledger reconciler (unbuilt)

**The one thing standing between 0.0.13 and the 0.1.0 cut is [ADR-0031](../decisions/0031-programmatic-provenance-stamp.md)
Phase 2.** Everything else on the [release path](plan-release-sequence.md#the-autonomy-track--what-010-now-delivers-adr-00290036)
is done or non-gating: the four autonomy ADRs are ratified, 0.0.12 **and** 0.0.13 shipped
(npm), the docs site landed. The remaining tail is the ADR-0035 normalization hardening plus
this — and this is the load-bearing one, because it is what makes the **a1 autonomy bake gate
measurable at all.**

## Why it gates the cut

0.1.0's bake gate (from the release sequence) is: *the soak produces durable notes the
maintainer **keeps** — a healthy keep-vs-`git revert` ledger.* That keep-rate is
[ADR-0030](../decisions/0030-agent-autonomy-ladder.md)'s crown signal — the only evidence that
higher autonomy is worth it. **Phase 2 is the code that computes it.** Without it the gate is
not "failing" — it is *unfalsifiable*. The soak digests say exactly this, two chapters running
(`~/ai-context/mage-soak/2026-07-01.md`, `2026-07-10.md`): *"Keep-rate not computed."* See
[soak targets](soak-targets.md).

## Verified code state (HEAD a170610, v0.0.13)

- **Phase 1 = built.** `src/provenance.ts` stamps `provenance` (`autonomy`/`repo`/`commit`) at
  the promote chokepoint. The `Provenance` type (`src/note.ts`) carries `repo`/`commit`/`work`/`autonomy`.
  Attribution is reliable — the *who-wrote-it* half is done.
- **Phase 2 = zero code.** Confirmed by scan: **no** reconciler command/verb in `src/commands/`;
  **no** keep/edited/discard/reject/pending classification of *committed* notes against git HEAD
  (every `discard`/`reject` hit is grooming *draft* disposition → `staged-rejects.json`, a
  different ledger); **no** per-autonomy keep-rate metric; **no** crown threshold registered.
- **`provenance.source` does not exist.** So the soak's *capture-vs-adopt split* is impossible —
  the ~14 "autonomous-era writes" are dominated by the one-time 2026-06-27 adopt backfill and
  cannot be separated from fresh capture. Adding `source` (capture|adopt) is part of P2's remit.

## What Phase 2 must deliver (ADR-0031 §7)

A boundary-fired (SessionStart) deterministic pass: snapshot stamped-uncommitted notes → diff vs
git HEAD + working tree → classify **keep/edited/discard/reject/pending** → accumulate a
per-autonomy-level keep-rate under `.mage/metrics/` → surface in the nudge line + dashboard. It is
self-contained (needs only Phase 1's stamp + git; **no** write-side pending-ledger, **no** new
`mage ledger` verb, **no** model — [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)).
Plus: add `provenance.source`, and register the **crown threshold** as a config act *before*
measurement (not hardcoded — no data to calibrate yet).

**Bottom line:** bounded, unblocked, self-contained build — instrumentation + bake time, not a
design problem. Nothing else on the critical path is waiting on design.

## Relations

- gates [release sequence — the autonomy track](plan-release-sequence.md)
- realizes_phase_2_of [ADR-0031 — programmatic provenance + the reject-ledger](../decisions/0031-programmatic-provenance-stamp.md)
- measures [ADR-0030 — the autonomy ladder's crown signal](../decisions/0030-agent-autonomy-ladder.md)
- observed_by [soak targets — the read-only monitor](soak-targets.md)
