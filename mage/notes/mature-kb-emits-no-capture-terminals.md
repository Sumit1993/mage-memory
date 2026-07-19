---
type: gotcha
tags:
  - mage/grooming
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: active
provenance:
  repo: mage-memory
  work: prismalens-soak-groom-2026-07-19
sources:
  - decisions/0030-agent-autonomy-ladder.md
  - decisions/0031-programmatic-provenance-stamp.md
  - notes/phase2-reject-ledger-0.1.0-gate.md
  - cc-session:d8d18f6f-21d4-4679-8b16-531132e1b88d
keywords:
  - keep-rate
  - crown-threshold
  - a1-bake
  - calibration
  - mature-kb
  - capture-terminals
  - soak
  - prismalens
  - 0.1.0
  - gate
  - autonomy
modified: 2026-07-19T06:53:57.173Z
---

# Gotcha — a mature KB emits no capture terminals, so the keep-rate gate cannot calibrate on it

ADR-0031 Phase 2 (merged 2026-07-19, PR #64) measures autonomy quality as a
keep-rate over autonomously-authored notes, counting **only `source === "capture"`
terminals** — `adopt` and legacy notes are excluded by construction, which is
correct and deliberate.

The 0.1.0 a1-bake gate depends on that rate. The same-day prismalens soak showed
the gate has no data path on our best dogfood target:

> distill drained every root, reviewed every substantive user correction, and
> concluded **0 new notes warranted** — every durable lesson had already been
> captured contemporaneously.

That is the KB working correctly. It is also, for the gate, a **zero denominator**:
no captures means no capture terminals, means no keep-rate, means `crownThreshold`
stays uncalibrated indefinitely. ADR-0031 ships the field intentionally unset
(§7) pending data that a mature KB structurally cannot supply.

## The trap

The healthier the KB, the less the gate can measure. Running a longer soak
against prismalens will not fix this — it makes it worse. Calibration signal
lives in the *early* life of a KB, when contemporaneous capture has not yet
saturated the space of durable lessons.

## How to apply

Before treating a1-bake as satisfiable, pick one:

- Bake against a **young** KB (a fresh wing, or a newly-adopted external repo)
  where captures are still landing, and accept that the rate is measured on a
  different population than steady-state use.
- Ship 0.1.0 with `crownThreshold` unset and treat the gate as deferred, stating
  it as a known limitation rather than an open task.

Do **not** read "0 new notes" from a groom as a soak failure or as evidence the
capture pipeline is broken — on a mature KB it is the expected result. Check
whether captures are landing on a *young* target before concluding anything about
capture health.

Related: [[promote-folds-mechanical-tokens]] — the other finding from the same
soak, and [[phase2-reject-ledger-0.1.0-gate]] for the gate itself.
