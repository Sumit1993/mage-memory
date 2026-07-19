---
type: decision
tags:
  - mage/decisions
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: accepted
provenance:
  repo: mage-memory
  work: adr-0038-promote-rung-review
sources:
  - decisions/0029-digest-to-agent-capture.md
  - decisions/0028-prose-keyed-capture.md
  - decisions/0019-mage-promote-self-grooming.md
  - decisions/0016-context-match-confidence-ladder-applier.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - notes/promote-folds-mechanical-tokens.md
  - https://github.com/Sumit1993/mage-memory/issues/71
  - src/grooming/promote.ts
  - src/grooming/signature.ts
  - src/grooming/tally.ts
  - src/distill/digest.ts
  - cc-session:d8d18f6f-21d4-4679-8b16-531132e1b88d
keywords:
  - promote
  - note-proposal-rung
  - graduate
  - note-read-usage
  - failure-skeleton
  - digest-annotation
  - annotate-never-sort
  - deterministic-selection
  - killed-pattern
  - recurrence
  - adr-0029-deferral
  - keyword-fold
modified: 2026-07-19T08:09:20.741Z
---

# 0038 — promote's note-proposal rung is deleted; graduate repoints to note-read usage; recurrence becomes a digest annotation

> **Status: accepted (ratified 2026-07-19).** Output of a 2026-07-19 grill, re-run after the
> first pass mis-framed the problem. Resolves the review that
> [ADR-0029](0029-digest-to-agent-capture.md) §7 deferred: *"`mage promote`'s deterministic
> note-PROPOSAL ladder is the **same** killed selection pattern; flagged **suspect + deferred**
> for its own review (it was never gated directly)."* This is that review, arriving with field
> evidence from [issue #71](https://github.com/Sumit1993/mage-memory/issues/71).

## Context

A full `mage:groom` across four prismalens roots (hub + platform + io + engine) on 2026-07-19
produced **~115 recurrence buckets and 0 durable proposals**. Every bucket was mechanical fold
noise: tool names (`toolsearch`, `workflow`), filename leaves (`llm` from `llm.ts`), and ADR
numbers (`adr`, `0019`).

The first diagnosis was that the fold's token filter had drifted — `DENOISE`
(`signature.ts:60-70`) denylists only the 13 *classic* Claude Code built-ins plus ~20 generic
filenames, so every tool added since walks straight through. That reading led to a candidate
design (origin-tagged tokens + inverse document frequency over the local corpus) and, in the
first grill, to a decision to delete two of the four lenses.

**That whole direction was invalid**, and the codebase says so. Two pre-registered replay gates
had already killed deterministic candidate-selection — Faultline **0/62**
([ADR-0027](0027-faultline-friction-capture-trigger.md)), prose-keyed **0/55**
([ADR-0028](0028-prose-keyed-capture.md)) — with clean controls, so those were measurements of
detector yield, not judge artifacts. [ADR-0029](0029-digest-to-agent-capture.md) drew the
conclusion explicitly: *"stop trying to make a deterministic core **decide** what a lesson is,"*
and recorded the third independent confirmation of *"~1 gem per ~2000 events, no deterministic
classifier isolates it."*

`distill` was pivoted to digest→agent on that finding. **`promote` was not** — §7 scoped it out
and flagged it suspect. Every refinement considered in the first grill was an attempt to build a
better deterministic selector of a purely semantic property, which is the one move the gates
forbid. Issue #71's ~115 noise buckets are not a tuning failure; they are the predicted output of
a pattern already measured as broken.

Two further facts, established while mapping the blast radius, shaped the decision:

- **ADR-0029's carve-out describes a design that was never built.** It protected note→skill
  graduation as *"graduating already-human-confirmed notes by continued usage — a different
  signal."* The code graduates on `stat.sessions >= graduateSessions` (`promote.ts:139`) — the
  *same* `tally.signatures` recurrence counts, behind the *same* K pre-filter (`:130`), bound to
  a note by `coveringNote`'s coarse wing + single-keyword overlap (`covering-note.ts:26-40`).
  There is no usage signal in that path. Graduation is the killed pattern with a higher threshold.
- **`coveringNote` inverts in role** once the note rung goes. Today it is a *suppression gate*,
  where a false positive merely skips a proposal. As the sole selector binding a signature to a
  note, a false positive **mints a skill from the wrong note**.

## Decision

> **Reading this as a state record.** Every numbered decision below is **ratified**. They
> are NOT all shipped. This ADR is the decision; the [Sequencing](#sequencing) section is
> the delivery plan, and each item carries its PR. At the time of writing only **§1** and
> **§6** are in the tree — `mage promote` still folds the keyword tally, still accepts
> `--seen`, and still reports `deferred`. Treat §2–§5, §7 as *decided, not done* until the
> sequencing table says otherwise.

| § | Decision | Lands in |
|---|---|---|
| 1 | Delete the note-proposal rung | **PR 1 (shipped)** |
| 2 | Graduate repoints to note-read usage | PR 2 |
| 3 | Delete the keyword fold | PR 2 |
| 4 | Cross-session recurrence keyed on `failureSkeleton` | PR 3 |
| 5 | Annotate, never sort | PR 3 |
| 6 | Keep the `mage promote` name + manifest shape | **PR 1 (shipped)** |
| 7 | One store, re-versioned | PR 2 |

**1. The note-proposal rung is deleted.** `mage promote` no longer proposes new notes from
recurrence. `noteProposalFor` (`promote.ts:44-51`), the `rung: "note"` branch, and the
`promoteSessions` (K) gate at `:130` go. `mage:groom` Phase 2 — ~70 lines built entirely around
this rung, including the `--seen` disposition protocol and the draft-through-`mage:learn` flow
(`skills/groom/SKILL.md:191-254`) — is removed with it. Recurrence never again *selects* what
becomes a note.

**2. Graduate repoints to note-read usage.** A note graduates on the count of **distinct chapters
in which the note's file was read**, folded from `tool_use` events that already carry `paths`.
This makes ADR-0029's "continued usage" true for the first time. The weak link the gates found —
a deterministic core deciding *what is a lesson* — is absent here: the lesson was human-confirmed
when the note was written, and the core only counts whether it gets used, which is exactly what a
deterministic core is good at. It also dissolves the `coveringNote` inversion, since the note is
identified by the path read, not by fuzzy keyword overlap.

**Correctness requirement — self-reference exclusion.** Note reads made while the agent is
executing a mage capture skill (`mage:groom` Phase 1's overlap-check, `mage:learn`) **MUST** be
excluded from the fold, or grooming inflates the very counts that trigger graduation and the loop
feeds itself. This is a correctness condition, not an implementation detail.

*Scope corrected 2026-07-19 (post-ratification, before PR 2):* an earlier draft also named
`coveringNote` scanning and `mage dream` as pollution sources. **They are not.** Observe events
come only from Claude Code hooks (`settings.ts:64-80`), so capture sees the *agent's* tool calls
only; the CLI reads notes via Node `fs` inside its own process and is invisible to the stream.
The exposure is exactly one case: agent `Read` calls during skill execution.

`ToolUseEvent` (`observe/types.ts:109-121`) carries no active-skill field, and there is no
`skill_unload` event, so a grooming context can be *opened* (`SkillLoadEvent.skill`) but never
exactly closed. **Chapter-level exclusion** is therefore the rule: if a chapter contains a mage
capture-skill load, no note read in that chapter counts. It is coarse and it costs the genuine
reads in grooming sessions — accepted deliberately, because this signal mints skills, so
under-counting delays a graduation while over-counting creates a wrong one. Fail toward the
recoverable error. The chapter unit already exists in `tally.ts`; no new tuning constant, and no
capture-side schema change, is required.

**3. The keyword fold is deleted.** `signature.ts`'s four lenses, `toolBody`, `DENOISE`, and the
`${wing}::${keywords.join(",")}` key (`:324`) are removed. Issue #71's ~115 noise buckets are not
fixed; they **cease to exist**.

**4. Cross-session recurrence returns keyed on `failureSkeleton`, corrections excluded.** This is
[ADR-0028](0028-prose-keyed-capture.md) §5's decision, which ADR-0029 §7 preserved and deferred to
a "clean v2." `failureSkeleton` (`digest.ts:80`) normalizes away URLs, timestamps, paths, UUIDs,
hex ids, quoted specifics and long numbers, so the same error in two sessions collapses to the
same key — stable identity by construction. Corrections are excluded on two grounds: they scored
**0/53** in the ADR-0028 gate, the worst performer measured; and prose paraphrase makes their
counts *wrong* rather than merely absent, which is worse in a digest whose contract is plain facts.

**5. Annotate, never sort.** The recurrence figure is rendered as a fact — *"this bit you in N
prior chapters"* — in the same class as the existing intra-chapter dedup count and the
contradiction cue. It **MUST NOT** reorder the digest. ADR-0029 §5 chose chronological order
deliberately, because *"the gems were single-occurrence"* and frequency-sorting *"would bury the
one-shot gems that matter most."* The BANNER's *"nothing below is ranked by importance"* stays
literally true: a factual annotation is not a ranking; sorting by it would be.

**6. `mage promote` keeps its name and manifest shape.** `mage:graduate` already calls
`mage promote --json` and already filters to `action: "graduate"`
(`skills/graduate/SKILL.md:44-46`), so preserving the command name and `proposals[]` shape means
that skill needs no rewrite — only two stale cross-references. The name is now wrong (nothing is
"promoted" into a note any more); that debt is booked in Consequences rather than paid with a
breaking CLI change mid-rebuild.

**7. One store, re-versioned; `tally.ts`'s engine survives.** Both new folds (note-reads,
failure-skeletons) persist in `.mage/metrics/promote.json` under one per-session offset, so they
cannot drift out of lockstep. **The chapter and offset machinery was never the bug** — the
never-regress `Math.max` offset folding only `[prevFold.offset, closedCount)` (`tally.ts:183-200`,
`:226`) is correct and idempotent. Only the *key* was wrong. Bump `PROMOTE_VERSION`;
`normalizeTally` (`:93`) already resets on mismatch, and old counts are uninterpretable under the
new keys, so discarding them is the only honest option.

## Consequences

- **"Up to 38 eligible to graduate" becomes 0** on the day PR 2 lands, and must be re-earned from
  live `.learnings` against a stricter signal — many of those 38 will never return. This is
  correct: they were minted by the mechanism being deleted. It will read as a large regression on
  the dashboard. **Do not "fix" it by lowering `graduateSessions`.**
- **`mage:groom` loses Phase 2 entirely.** Grooming becomes first-sight capture plus routing;
  recurrence stops being a thing the human dispositions in batches.
- **Naming debt.** `mage promote` only graduates. Every future reader will be misled until someone
  renames it. Cheapest moment for that rename was this rebuild; it was deliberately declined.
- **`promoteSessions` (K) is orphaned**, and the sensitivity dial collapses to scaling
  `graduateSessions` alone. `promotionBudget` and `deferred` become vestigial — graduate proposals
  dedupe per note relPath, so a 5-budget cannot bind.
- **Corrections lose cross-session recurrence outright.** A repeated correction will not be
  counted across sessions. Accepted on the 0/53 gate evidence; revisit only with a stable identity
  for prose, which no design here provides.
- **A new capture dependency**: graduate now depends on `tool_use.paths` being populated for note
  reads. If a future harness stops reporting paths, graduate silently goes to zero — fail-open in
  the wrong direction. Worth a doctor check.
- **`isCovered` (`covering-note.ts:38-40`) likely loses its last non-test caller**; `coveringNote`
  itself survives only if something still needs signature→note mapping.
- Dashboard copy (`dashboard/nudges.ts:79-80`, `:172`) and `climbingFrom`
  (`dashboard/collect.ts:32,110,288`) describe the deleted rung and must be repointed; the dream
  applier's note-creation refusal (`dream/applier.ts:48-54`) becomes dead defensive code, harmless
  to keep.

### Sequencing

Three PRs, ordered so `main` is never broken — graduate keeps riding the old tally through PR 1:

1. Delete the note rung + `mage:groom` Phase 2 + this ADR. Noise stops immediately; graduate still works.
2. Note-read fold + graduate repoint + `PROMOTE_VERSION` bump + delete the keyword fold. The reset lands here, isolated.
3. `failureSkeleton` cross-session fold + the digest annotation. Additive.

## Relations
- resolves [ADR-0029 — digest-to-agent capture](0029-digest-to-agent-capture.md) §7's deferred promote review
- supersedes the note-proposal ladder of [ADR-0019 — mage promote: self-grooming](0019-mage-promote-self-grooming.md)
- preserves [ADR-0028 — prose-keyed capture](0028-prose-keyed-capture.md) §5's failure-skeleton repoint
- ethos_from [ADR-0027 — faultline](0027-faultline-friction-capture-trigger.md) — deterministic selection of a semantic property does not work
- constrained_by [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) — the folds stay model-free and offline; judgment stays in the host agent
- relates_to [ADR-0016 — context-match, the confidence ladder, and the single applier](0016-context-match-confidence-ladder-applier.md) — context-match cannot serve un-graduated notes, which is why note-reads are a new fold
- evidenced_by [promote folds mechanical tokens](../notes/promote-folds-mechanical-tokens.md)
