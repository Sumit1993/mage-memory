---
type: plan
tags:
  - mage/roadmap
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: active
provenance:
  repo: mage-memory
  work: adr-0039-soak
sources:
  - decisions/0039-context-footprint-measure-and-bound.md
  - decisions/0011-recursive-scan-hub-projects.md
  - decisions/0012-wings-optional-convention-standalone-hubs.md
  - decisions/0004-capture-insight-not-copies.md
  - notes/soak-targets.md
  - src/metrics/footprint.ts
  - src/commands/index-cmd.ts
  - cc-session:254aa0ba-a431-4d8f-8bc5-c50d001180c5
keywords:
  - footprint
  - soak
  - hub
  - multi-wing
  - wing-index
  - unbounded
  - pointer-leverage
  - inert-metric
  - line-cap
  - crossover
  - handoff
modified: 2026-07-19T18:06:46.460Z
---

# Footprint soak (0.0.14) — what held, and two shape assumptions that did not

**Handoff.** `mage footprint` (ADR-0039) shipped in 0.0.14 having only ever run against
`mage-memory` itself. The first external soak — the two targets in
[soak-targets](soak-targets.md) — validated the headline design and found **two gaps, both
caused by assumptions that hold for a single-wing, file-citing KB and not for the others.**

Nothing here is a regression: the instrument reports *truthfully* in every case. On hubs it
reports truthfully **about the wrong file.**

## Measured, 2026-07-19, `mage@0.0.14`

| KB | shape | bytes | lines | B/entry | binding | state |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `mage-memory` | 1 wing, 79 notes | 14,629 / 25,600 (57%) | 116 / 200 (58%) | 182 | lines (just) | ok |
| `sreforge-memory` | 1 wing, 61 entries | 9,962 / 25,600 (39%) | 119 / 200 (60%) | 160 | **lines, clearly** | ok |
| `prismalens-docs-hub` | **3 wings**, 84 notes | 1,038 / 25,600 (4%) | 16 / 200 (8%) | — | neither (see §1) | ok |

Reproduce: `cd <kb> && mage footprint`. Read-only.

## ✅ What held — the two-dimensional budget

ADR-0039 §4 enforces **bytes AND lines**, `state` being the worse of the two, on the argument
that Claude Code truncates at ~25,600 B *or* 200 lines and that a byte-only meter would go green
into a line-shaped cliff. The predicted crossover was **175.1 B/entry**.

**`sreforge` confirms it on data mage never saw.** At **160 B/entry** it sits below the
crossover and is **line-bound at 60% while bytes read 39%**. A byte-only meter would have
reported *"39%, plenty of room"* and stayed green until the host silently truncated. The
crossover arithmetic also ranks the three KBs correctly (182 → marginally byte-side; 160 →
clearly line-side).

This was the single most contested decision in the ADR. It was right, and the evidence is
external.

## ⚠️ Gap 1 — the budget is inert on multi-wing hubs (the important one)

On `prismalens-docs-hub` the meter reads **4%, `ok`**, and that number describes almost nothing:

```
MEMORY.md                       1,038 B   <- the CAPPED surface: a 3-wing map, no notes
_index.prismalens-platform.md  21,943 B   <- on-follow, 76 notes, ~5.5K est. tokens
```

In hub / multi-wing mode `index-cmd` renders `MEMORY.md` as a **wings map**; the per-note lists
live in `_index.<wing>.md`. ADR-0039 §4 caps *the auto-memory file*, and §7's degradation tiers
only ever touch it. So on a hub:

- the capped surface is **structurally near-empty** and can never approach its cap;
- the wing indexes — where all the content is, and what an agent following the map actually
  opens — are **bounded by nothing**;
- tiers never fire, `doctor` never warns, and the KB can grow indefinitely while the meter
  reports 4%.

The report *does* disclose the wing index under "Not in the total", so this is a misleading
headline rather than a hidden cost. But the cap is attached to a **filename** when what matters
is **the file the agent actually loads**, and those differ by KB shape.

**Open design question (wants a grill, then an ADR amendment):**

1. Should the cap follow the *loaded* surface rather than a fixed filename — i.e. in hub mode
   govern `MEMORY.md + the wing index being followed`?
2. If so, `on-follow` stops being a constant rule and becomes **shape-dependent** — for a
   single wing it is a duplicate of `MEMORY.md` (correctly excluded, §4's original reasoning);
   for a hub it is the primary payload (wrongly excluded).
3. Or: leave the budget alone and bound `_index.<wing>.md` **separately**, since a wing index is
   read wholesale once opened. This is probably simpler and avoids making the total conditional.
4. Either way §7's tiers need a target on hubs, or a hub has no degradation path at all.

## ⚠️ Gap 2 — pointer leverage is inert on 2 of 3 real KBs

| KB | measurable pointers |
| --- | --- |
| `mage-memory` | 243 / 307 (79%) |
| `prismalens-docs-hub` | 2 / 92 (2%) |
| `sreforge-memory` | 0 / 24 (0%) |

**Not a bug** — verified by reading the sources. `sreforge` notes cite almost entirely
`cc-session:` refs, which are genuinely unmeasurable, and one absolute path into a *different*
hub. There is nothing there to measure.

But it means the metric designed as the honest savings-adjacent number
([ADR-0039 §2](../decisions/0039-context-footprint-measure-and-bound.md)) **only works on KBs
whose notes cite repo files** — which turned out to be the authoring KB and not the others. The
sample it was validated on was the sample that suits it.

**Disposition — decide, don't drift:** either (a) accept it as a mage-memory-shaped metric and
say so in the output when coverage is near zero (e.g. suppress the section rather than print
`0 / 24 (0%)`, which reads like a defect), or (b) drop it. Printing a near-zero ratio with no
explanation is the worst of the three.

### Minor bug found alongside

**Absolute-path sources are mishandled.** `join(root, "/abs/path")` resolves to `<root>/abs/path`,
so an absolute source (seen in `sreforge`) is counted **dead** rather than measurable or
out-of-scope. Small, self-contained fix in `src/metrics/footprint.ts`.

## Not gaps

- **Yield / trend read "insufficient data"** on all three — correct, and the intended behaviour
  ([ADR-0039 §Consequences](../decisions/0039-context-footprint-measure-and-bound.md)): they
  need ~30 sessions and must never render zeros. External KBs have no sampler history yet
  because 0.0.14 only just shipped.

## Suggested order

1. **Grill Gap 1** — it is the one that lets a real KB grow past a real cliff unwarned, and hubs
   are a first-class shape ([ADR-0011](../decisions/0011-recursive-scan-hub-projects.md),
   [ADR-0012](../decisions/0012-wings-optional-convention-standalone-hubs.md)).
2. **Decide Gap 2** — cheap, and the current output actively misleads on two of three KBs.
3. **Fix the absolute-path bug** — trivial, can ride either.
4. **Re-soak after each** — this pass took minutes and found what months of self-hosting did not.

## Relations

- follows [ADR-0039 — measure the context footprint](../decisions/0039-context-footprint-measure-and-bound.md)
- soak layout and targets in [soak-targets](soak-targets.md)
- hub shape per [ADR-0011](../decisions/0011-recursive-scan-hub-projects.md) /
  [ADR-0012](../decisions/0012-wings-optional-convention-standalone-hubs.md)
- pointer leverage rests on [ADR-0004 — capture insight, not copies](../decisions/0004-capture-insight-not-copies.md)
