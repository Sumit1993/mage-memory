---
type: decision
tags: [mage/decisions]
created: "2026-06-08"
updated: "2026-06-08"
last_reviewed: "2026-06-08"
status: active
provenance:
  repo: mage-memory
  work: grill-promote-0.0.8
sources:
  - src/metrics/rollup.ts
  - src/metrics/context-match.ts
  - src/distill/reader.ts
  - src/distill/watermark.ts
---

# 0019 — `mage promote`: self-grooming (recurrence, graduation, merge/split)

A 2026-06-08 grill locked **self-grooming** — release 0.0.8, the stage that turns
distill's notes ([ADR-0018](0018-mage-distill-observed-scratch-reader.md)) into a
maintained, graduating catalog. distill (0.0.7) writes notes **on first sight**;
promote watches for **recurrence over time** and drives the rest of the ladder:
scratch → note → skill, plus the merge/split/demote housekeeping. The cross-cutting
compute was pre-locked — the context-match rate, the confidence ladder, the single
applier ([ADR-0016](0016-context-match-confidence-ladder-applier.md)); the scratch →
note → skill ladder, bounded edits, the rejected-edit buffer
([ADR-0013](0013-procedure-skills-self-grooming-loop.md)). This ADR fixes the
**mechanics** those left open: what the recurrence tally counts, the thresholds and
their seam/dial, what graduates, merge vs split, and where the counters live.

## Decision

1. **promote is a second deterministic fold over the same scratch — a "tally," distill's
   sibling.** It realizes [ADR-0018](0018-mage-distill-observed-scratch-reader.md) §3's
   forward-commit: a **per-pattern recurrence count** with **its own bookmark**, folding
   *every* closed event (including ones distill skipped) into a tally that **survives the
   raw-event purge**. It reuses the rollup mould verbatim
   ([rollup.ts](../../src/metrics/rollup.ts)): a gitignored `.metrics/promote.json`,
   per-session watermark, idempotent never-regress `Math.max` fold, CLOSED-segments only.
   It is **fold-based/incremental, never backfill-from-raw** (raw events age out). No
   model in the fold ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)).

2. **The pattern key is a deterministic `(wing + tags)` signature; recurrence counts
   DISTINCT SESSIONS, not raw hits.** "Came up in 3 separate sessions" is signal; "3 times
   in one chatty session" is not — so each signature counts **at most once per session**
   (the rollup is already per-session-keyed). The tally covers **all four lenses,
   including user corrections** — using the same deterministic keyword derivation observe
   already does (the keyword-snapshot machinery of
   [ADR-0015](0015-mage-observe-capture-schema.md) §3 / context-match's predicate). The
   signature is **coarse on purpose**: the deterministic fold *buckets*, and the
   `mage:promote`/dream judgment skill *refines* ("are these three really the same
   lesson?") at proposal time — the same reader-counts / skill-judges split as distill.

3. **Corrections ARE recurrence-counted (correcting ADR-0018's first-sight framing).**
   ADR-0018 §4 made corrections first-class for distill; this ADR additionally counts
   **repeated** corrections in promote. They have no exact semantic key, but they have a
   *rough* `(wing + tags)` key — enough for the deterministic fold to bucket, with
   judgment cleaning it up at review. So "you keep steering me about X" surfaces, while
   the no-model-in-core line holds (the model only judges the surfaced bucket). Capturing
   the agent's final reply (the [ADR-0015 amendment](0015-mage-observe-capture-schema.md))
   sharpens the antecedent a correction reacts to.

4. **One tally feeds both ladder rungs.** The "is there already a covering note?" test
   reuses the context-match predicate ([context-match.ts](../../src/metrics/context-match.ts):
   note frontmatter `keywords`/`wing`/`paths` vs the event's signals):
   - **scratch → note (the catch-net):** a signature recurring in **≥ K distinct sessions**
     with **no covering note** → propose a new note. distill's first-sight still handles
     striking one-offs; promote catches the slow-burn that was never striking enough.
   - **note → skill (graduate):** a note **corroborated in ≥ M distinct sessions** → propose
     graduation. The corroboration count *is* the recurrence of the note's `(wing+tags)`.

5. **Only procedural notes (Playbook / Gotcha) graduate to skills; recurrence — not
   context-match — gates graduation.** A skill is **auto-loaded** into context, so it must
   be **actionable and proven** — you auto-load a *procedure*, not a *fact*. Principle /
   Reference / Interface notes stay notes. Graduation gates on **note-type + recurrence**,
   because a not-yet-graduated note emits no `skill_load` and therefore has **no
   context-match data** — context-match only exists *after* graduation, where it governs
   **reword / demote** ([ADR-0016](0016-context-match-confidence-ladder-applier.md) §1/§3).
   The lifecycle is clean: **recurrence drives scratch → note → skill; context-match drives
   reword and skill → note demote.**

6. **merge and split are first-class applier (dream) operations.** The applier's note set
   gains **split** alongside supersede / consolidate / prune / archive
   ([ADR-0016](0016-context-match-confidence-ladder-applier.md) §4):
   - **Merge** — when a new lesson's tags overlap an existing note in the same wing,
     **prefer update/merge over a new file** (distill's UPDATE-vs-NEW, made merge-biased).
     This is the single explicit lever that keeps the base **small early**.
   - **Split** — break a note in two when **any** of: it grows past a **size cap**; a
     **slice inside it recurs on its own** (that slice has earned its own note/skill —
     graduation-adjacent); or it has **drifted into two incoherent topics** (its tags no
     longer hang together).
   - **"Small early → split later" is EMERGENT, not a mode.** Early, little has recurred →
     few cross K → few notes, kept folded by merge; later, slices each accrue their own
     recurrence → split fires. No special early-consolidation state to build or reason
     about — only the merge-on-overlap preference is explicit.

7. **Thresholds: a seam + a human dial now; the auto-tuner is a deferred opt-in rung.**
   The fixed numbers won't fit every user (heavy / light / dev / researcher / creative),
   so:
   - **Seam (build now):** every constant — `K ≈ 3` sessions, `M ≈ 5` sessions, the note
     size cap, the demote rate-floor (provisional `< 0.4` reword / `< 0.2` demote over
     `≥ M` loads, inherited from [ADR-0016](0016-context-match-confidence-ladder-applier.md) §1),
     the bounded-edit budget ("textual learning rate", N edits per optimize pass) — lives
     in **one module**, not scattered. Provisional, tunable without touching logic.
   - **Dial (build now):** a single human **"sensitivity"** setting (`low | normal | high`,
     default `normal`) that scales the seam together. Human-set, no AI; covers the
     heavy-vs-light taste split. It is a **choice, not derived data**, so it lives in the
     **tracked** KB config (`metadata.json`), portable across machines.
   - **Auto-tuner (deferred, opt-in):** dream adjusting the seam from usage is the *hardest*
     automation to trust (self-modifying governance — "why did mage start spamming
     notes?"), so it is **not** in 0.0.8 (trust-first, [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)).
     When built it must tune on the **accept/reject signal** (the rejected-edit buffer /
     approval-recurrence the ladder already defines), **never** raw volume or a guessed
     persona, and write to the **gitignored** metrics (never tracked → no git churn,
     [ADR-0016](0016-context-match-confidence-ladder-applier.md) §2). Counting **distinct
     sessions** already absorbs much of the heavy/light variance.

8. **0.0.8 ships at Rung A (propose-only); per-user adaptation is the accept/reject ladder,
   not persona detection.** Everything promote / graduate / merge / split / optimize emits
   is a **proposal** the human confirms — and the confirm **is** the git commit, so
   *never-auto-commit* holds. The confidence ladder
   ([ADR-0016](0016-context-match-confidence-ladder-applier.md) §3) loosens a mutation
   *class* to auto-**write** (still human-commits) only on the human's **approval track
   record** (≥ K approvals), **GENERATED-only**, **reversible + low-blast**; the
   rejected-edit buffer ratchets it back on rejection. That feedback loop *is* the
   per-persona adaptation — a heavy accepter gets more, sooner; a cautious rejecter gets
   less — with nobody labeling a persona.

9. **Storage: three tiers (matches [ADR-0016](0016-context-match-confidence-ladder-applier.md) §2).**
   New gitignored `.metrics/` siblings of the rollup + distill bookmark:
   - **`promote.json`** — the recurrence tally (per `(wing+tags)` signature, distinct-session
     counts) + its own per-session bookmark. The purge-surviving second counter.
   - **`proposals.json`** — pending suggestions not yet dispositioned (`note? · graduate? ·
     merge? · split? · reword?`) — the gitignored proposal queue
     ([ADR-0016](0016-context-match-confidence-ladder-applier.md) §4).
   - **`rejected.json`** — the rejected-edit buffer: what the human said no to, so mage backs
     off and doesn't re-pester (the "back off" half of the accept/reject loop).

   The **dial** is the lone *tracked* addition (`metadata.json`); the **defaults** live in
   code (the seam). Nothing auto-commits — the commit stays the human gate. *(Build may
   stage promote-tally → graduate → optimize-reword → full dream sweep internally; it ships
   as one release.)*

## Considered options

- **Corrections are first-sight only, never recurrence-counted** — rejected: misses "you
  keep correcting me about X." A coarse `(wing+tags)` bucket + judgment-at-review counts
  them without a model in the fold.
- **Persona detection / per-profile presets** — rejected: the accept/reject ladder adapts
  to any user without labeling one; a single sensitivity dial covers the residual taste.
- **Auto-tune the thresholds in 0.0.8** — rejected/deferred: self-modifying governance is
  the hardest thing to trust; ship the seam + dial, make the tuner an opt-in rung that
  keys on accept/reject (not volume).
- **A special "early consolidation" mode** — rejected: small-early emerges from the counts;
  only the merge-on-overlap preference is explicit.
- **Graduate any note type** — rejected: a skill is auto-loaded, so only actionable proven
  Playbook/Gotcha notes graduate; you auto-load a procedure, not a fact.
- **Gate graduation on context-match** — rejected: a pre-graduation note emits no
  `skill_load`, so it has no context-match data; recurrence gates graduation, context-match
  governs reword/demote afterward.
- **Backfill recurrence by re-reading raw events** — rejected: raw events purge; the tally
  is fold-based/incremental (ADR-0018 §3 forward-commit).
- **Store counts in note frontmatter / a tracked config (ECC's `confidence:`)** — rejected:
  metrics never enter git ([ADR-0016](0016-context-match-confidence-ladder-applier.md) §2);
  gitignored siblings, with the human *dial* the only tracked knob.
- **Don't capture the agent's reply** — rejected: the reply is the antecedent a correction
  reacts to; bounded to final-reply-only + redacted (the [ADR-0015 amendment](0015-mage-observe-capture-schema.md)).

## Consequences

- New gitignored artifacts: `.metrics/promote.json` (tally + bookmark), `proposals.json`
  (queue), `rejected.json` (buffer). One **tracked** addition: the sensitivity **dial** in
  `metadata.json`. A new **thresholds seam** module in code holds every provisional constant.
- [ADR-0015](0015-mage-observe-capture-schema.md) is **amended**: a new `assistant_msg`
  event (final reply per turn, redacted). An observe/capture change — verify at build that
  the end-of-turn hook hands over the final reply (the same real-session check that resolved
  the `PostToolUseFailure` carry-in).
- The applier (dream) gains **split**; it is the single serialized writer for promote /
  graduate / merge / split / reword, enforcing the §3 ceilings.
- Lifecycle is locked end-to-end: **recurrence** gates scratch → note → skill; **context-match**
  gates reword and skill → note demote.
- The **accept/reject ladder** is the per-user adaptation; auto-tuning the seam is a deferred
  opt-in rung. distill (0.0.7) is unchanged — promote is a second consumer of its scratch.
- Satisfies [ADR-0006](0006-two-layer-recall-per-wing-skills.md)'s "promotion deferred until
  wings proliferate" trigger — wings have proliferated across the 0.0.x ladder, so the
  promotion engine that ADR judged premature is now built.

## Relations

- realizes [ADR-0013 — procedure skills + the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) — the promote/graduate/optimize rungs (§1/§3/§4) + dream-as-applier (§6)
- extends [ADR-0016 — context-match, the confidence ladder, the applier](0016-context-match-confidence-ladder-applier.md) — the recurrence tally feeds the ladder; adds merge/split to the applier
- builds_on [ADR-0018 — mage distill](0018-mage-distill-observed-scratch-reader.md) §3 — the second-consumer purge-surviving tally it forward-committed
- amends [ADR-0015 — the capture schema](0015-mage-observe-capture-schema.md) — adds the `assistant_msg` event
- amends [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md) — builds the promotion engine it deferred
- gated_by [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md) — the Gate-2 block the applier honours
- rides [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) — Rung A now; auto-tuner a deferred opt-in
- mines ECC `continuous-learning-v2` (recurrence model) + Microsoft SkillOpt (rejected-edit buffer, bounded edits, held-out gate)
- sequenced_by [release sequence](../notes/plan-release-sequence.md)
