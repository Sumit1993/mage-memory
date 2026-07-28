---
type: plan
tags:
  - mage/roadmap
created: "2026-07-28"
updated: 2026-07-28
last_reviewed: 2026-07-28
status: active
provenance:
  repo: mage-memory
  work: adr-0041-genre-recall-rungs
sources:
  - decisions/0041-genre-decides-the-recall-rung.md
  - decisions/0042-reach-tier-harness-grants.md
  - decisions/0035-decouple-harness-memory-from-notes.md
  - decisions/0039-context-footprint-measure-and-bound.md
  - notes/soak-targets.md
  - notes/npx-mage-runs-the-published-release.md
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
  - cc-session:fcc130b6-ad37-480e-b975-caf13add356c
  - cc-session:cc52271f-c247-4662-ac8c-94699ee8bb4d
keywords:
  - wave-plan
  - genre
  - recall-rung
  - release-gated
  - soak-evidence
  - ratification
  - wave-c
  - connect-external
  - baseline
modified: 2026-07-28T08:56:08.459Z
---

# ADR-0041 wave plan — A, B, C, and the ratification gate

> **Why this note exists.** The three-wave plan lived only in a session log until
> 2026-07-28, which made Wave C effectively invisible — the ADR names waves but
> never enumerates them. This is the durable record of what each wave is, why the
> order is load-bearing, and what evidence ratifies the ADR.

## The shape: three waves gated by releases into soak

**Not parallel tracks.** Each wave changes what the next one migrates, so the
sequencing *is* the point. Within a wave: parallel worktrees and delegation.
Between waves: a release and soak evidence.

```
Wave 0: side-fixes + ADR drafts     (order-independent)
Wave 1: A — curation + ladder       → release → wire into soaks → observe
Wave 2: B — genre first-class       → migration → release → migrate soaks → observe
Wave 3: C — connect/external layers (needs B's fallback rooms to exist)
```

**Why each gate is real:**

- **B after A** — B's migration stamps genre on every existing note. Running it
  before A fixed `CONVENTIONS.md` §6 and drained the PM notes into `work/` means
  stamping notes that are about to move.
- **C after B** — C's fallback path *is* B's rooms. C cannot be tested until B ships.
- **Release, not merge** — the soaks only exercise a **published** release
  ([[npx-mage-runs-the-published-release]]). A merged-but-unreleased wave is
  invisible to them. So every wave ends in a release.

## Wave 0 — parallel, independent

| Work | State |
|---|---|
| Plugin packaging allowlist (kills the 556MB plugin cache) | **not built** — filed as [#96](https://github.com/Sumit1993/mage-memory/issues/96) |
| `noteSizeCap`: wire or delete | **done** — wired in #94; `src/doctor/genre-tells.ts` is its first importer |
| ADR-B draft | **done** — became [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md) |
| ADR-C draft | **never written** — see Wave C below, [#104](https://github.com/Sumit1993/mage-memory/issues/104) |

## Wave A — curation + the better-home ladder

`CONVENTIONS.md` teaches the ladder; doctor gains read-only genre-tell
annotations; the home KB is curated by hand.

- #93 — CONVENTIONS teaches the better-home ladder
- #94 — read-only genre-tell annotations; `noteSizeCap` gains its first importer
- #95 — home-KB genre curation

**Released in 0.0.15 (#97)** and wired into both soaks.

## Wave B — genre first-class

Genre becomes the thing recall filters on. `INDEX.md`/`MEMORY.md` carry
memory-genre lines only, plus a single governance line pointing at `decisions/`;
wing skills grow a Governing-decisions section.

- #98 — INDEX/MEMORY carry memory-genre lines only + governance line
- #99 — wing skills list governing decisions

Merged after a 14-agent extreme review (9 confirmed findings, 0 refuted, 2 real
blockers fixed and re-verified). **Merged but unreleased** — sits in release PR
[#100](https://github.com/Sumit1993/mage-memory/pull/100) (0.0.16), deliberately
held for an overnight A-only observation window.

Soak curation PRs, applied row-for-row against approved manifests:
`prismalens-docs-hub#15` and `sreforge-memory#6`.

## Wave C — connect / external layers

**Not started.** No ADR, no spec. Tracked at
[#104](https://github.com/Sumit1993/mage-memory/issues/104).

Scope as far as it was designed: the grilled **config format + question flow**
for `connect`/external layers. This is the one part of ADR-0041 that is genuinely
taste-critical because users touch it directly — which is why the grill was
queued for a fresh session rather than the tail of the 2026-07-27 wave day.

Unblocks the moment 0.0.16 lands and the soaks pick it up.

> [ADR-0042](../decisions/0042-reach-tier-harness-grants.md) (the reach tier) is
> **adjacent, not a substitute** — a separate grill on the same day, about harness
> grants rather than the config surface.

## The ratification gate

From [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md) — the ADR stays
`status: proposed` until this is satisfied; ratification rides the Wave-B release.

**Yield:**
- After migration, `MEMORY.md` ≤ **~20%** of the host auto-memory budget, with
  **zero** document-genre lines.
- Soak recall quality (prismalens, sreforge) does not regress over the
  observation window.
- Groom's keep-rate calibration unblocks — the
  [[mature-kb-emits-no-capture-terminals]] hypothesis was that *documents were
  polluting the judgment pool*.

**KILL if:** memory-genre recall demonstrably misses governing constraints that
the forty always-on ADR lines used to catch (measured by soak steering
corrections), **or** the closed vocabulary forces real knowledge into
`unclassified` at any meaningful rate.

## Baseline — measured 2026-07-28, before 0.0.16

Installed `mage --version` → **0.0.15**, so the soaks are still on the *pre-filter*
contract. The home KB was regenerated with the **local** build, which is why only
it shows the post-filter shape.

| KB / file | lines | bytes | `decisions/` links | governance line |
|---|--:|--:|--:|:--:|
| home `mage/MEMORY.md` (post-filter, after #101) | **59** (56 before #101; 117 before Wave B) | 5,666 | 1 | yes |
| prismalens `projects/prismalens-platform/MEMORY.md` | 115 | 13,035 | 25 | no |
| sreforge `MEMORY.md` | 136 | 11,629 | 29 | no |
| sreforge `projects/sreforge/MEMORY.md` | 115 | 12,921 | 27 | no |

Zero governance lines is the reliable tell for "generated before #98".

**Reading these numbers in a hub:** the top-level `INDEX.md` of a multi-wing hub
is a **wing roster** (~945 bytes — small by design); the note lines live in
`_index.<wing>.md`, and the heavy recall file is the per-project `MEMORY.md`. A
small top-level `INDEX.md` is *not* evidence the filter landed.

## Deferred out of the waves

| Item | Home |
|---|---|
| path-collision decision nudge | FT-22 |
| falsify-on-commit for doc-genre notes | FT-23 |
| per-work-style type maps via template wings | FT-24 |
| capture-side recurrence guard | FT-25 |
| central hub by derivation (`~/.mage/hubs/<slug>`) | FT-26 |
| plugin cache bloat | [#96](https://github.com/Sumit1993/mage-memory/issues/96) |
| worktree propagation research | [#103](https://github.com/Sumit1993/mage-memory/issues/103) |
| Wave C grill + ADR-C | [#104](https://github.com/Sumit1993/mage-memory/issues/104) |
| `HarnessAdapter` seam | [ADR-0036](../decisions/0036-defer-harness-adapter-seam.md) revisit trigger |

## What is left, in order

1. Merge #100 → 0.0.16 publishes. This is the ratification event.
2. Merge the soak curation PRs (`prismalens-docs-hub#15`, `sreforge-memory#6`).
3. Regenerate the soak indexes on 0.0.16 and re-measure against the baseline above.
4. Flip [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md) and
   [ADR-0042](../decisions/0042-reach-tier-harness-grants.md) to `accepted` if the
   gate holds.
5. Grill Wave C in a fresh session ([#104](https://github.com/Sumit1993/mage-memory/issues/104)).

## Relations

- Governed by [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md),
  amending [ADR-0035](../decisions/0035-decouple-harness-memory-from-notes.md)
- Companion to [ADR-0039](../decisions/0039-context-footprint-measure-and-bound.md)
  and [plan-footprint-soak-findings](plan-footprint-soak-findings.md)
- Soak targets: [[soak-targets]]
- Release ordering: [plan-release-sequence](plan-release-sequence.md)
