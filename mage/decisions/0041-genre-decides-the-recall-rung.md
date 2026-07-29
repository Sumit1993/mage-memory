---
type: decision
tags:
  - mage/decisions
created: "2026-07-27"
updated: 2026-07-29
last_reviewed: 2026-07-29
status: proposed
provenance:
  repo: mage-memory
  work: adr-0041-genre-recall-rungs
sources:
  - decisions/0035-decouple-harness-memory-from-notes.md
  - decisions/0033-recall-import-bounded-index.md
  - decisions/0038-promote-note-rung-deleted-graduate-on-usage.md
  - decisions/0039-context-footprint-measure-and-bound.md
  - research sweep 2026-07-27 — external survey of 14 memory systems, Pocock skills layering, internal genre audit (local artifacts; every load-bearing number is inlined under Context)
  - prismalens-docs-hub genre audit handoff 2026-07-27 (local artifact; its better-home ladder is reproduced in CONVENTIONS.md by the Wave-1 PR)
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
keywords:
  - genre
  - recall-rung
  - one-store-three-paths
  - closed-type-vocabulary
  - type-genre-map
  - index-exclusion
  - governance-line
  - lifecycle-verbs
  - annotate-never-sort
  - migration-manifest
modified: 2026-07-27T07:41:55.456Z
---

# 0041 — Genre decides the recall rung: one store, three recall paths (amends ADR-0035)

> **Status: proposed (grilled 2026-07-27; ratification rides the Wave-B release).**
> Amends [ADR-0035](0035-decouple-harness-memory-from-notes.md) — keeps its store,
> splits its recall. Companion to [ADR-0033](0033-recall-import-bounded-index.md)
> and [ADR-0039](0039-context-footprint-measure-and-bound.md).

## Context

A three-way audit (2026-07-27: prismalens handoff, an external survey of 14 memory
systems, and an internal audit of this KB) found that **"memory" was doing double
duty** — memory-as-*store* (everything mage keeps) and memory-as-*recall-tier*
(what arrives unbidden each session). ADR-0035 correctly unified the store; nothing
split the recall. The result at home: genuine memories are **8.7% of KB bytes**,
`MEMORY.md` consumes **56% of the host auto-memory budget**, and **72% of its
entries point at documents** — decision records, plans, current-truth prose — that
are *consulted*, never *recalled*.

The external survey found every mature system draws this boundary with two cuts:
**who authored it** (instruction vs recollection — already solved here: instructions
live in `skills/`, a separate scanner-skipped store) and **whether it has a
done-state** (completable → ticket/plan; never-completes → memory). It also found
the two-store shape recurring inside single products (beads: issue graph +
`bd remember`; Claude Code: CLAUDE.md + auto memory) — the genres refuse to merge.

Constraints honored: [ADR-0035](0035-decouple-harness-memory-from-notes.md) §1
(one store) and §4 (no write-time tollbooth) stand; [ADR-0038](0038-promote-note-rung-deleted-graduate-on-usage.md)
(mechanical checks annotate, never sort); [ADR-0011](0011-recursive-scan-hub-projects.md)
(folders are conventions — classification must ride frontmatter);
[ADR-0003](0003-track-work-ignore-artifacts.md) (`artifacts/` is gitignored, so
displaced bodies must stay committed notes).

## Decision

1. **One store, three recall rungs.** ADR-0035 §1 is untouched: notes are memories,
   one unified store. What splits is recall:
   - **Rung 1 — skill (context-triggered):** proven procedures, graduated per
     [ADR-0038](0038-promote-note-rung-deleted-graduate-on-usage.md); per-wing skills
     per [ADR-0006](0006-two-layer-recall-per-wing-skills.md).
   - **Rung 2 — index line (always loaded):** one line per **memory-genre** note in
     `INDEX.md`/`MEMORY.md`, bounded by [ADR-0039](0039-context-footprint-measure-and-bound.md).
   - **Rung 3 — on demand:** the note body, reached by search, links, or the
     Obsidian graph. Every note lives here; non-memory genres live *only* here.

2. **Genre is derived from a closed `type:` vocabulary — never stored as a second
   field.** One field, one source of truth; no `type`/`genre` contradictions. The
   map lives in **one exported constant in `src/scanner/` that the scanner imports**
   (named importer mandatory — see the gotcha
   [[unreachable-constant-reports-a-false-state]]):

   | `type:` | genre | recall rung | lifecycle verb |
   |---|---|---|---|
   | `gotcha` `procedure` `pointer` `principle` `feedback` `reference` `note` | **memory** | 2 (and 1 when graduated) | edit-in-place |
   | `decision` | **decision** | 3 | supersede/amend, never edit |
   | `plan` `tasks` | **work** | 3 | complete-and-archive |
   | `spec` `doc` | **doc** | 3 | expire-on-falsification |
   | anything else | **unclassified** | 3 | — (doctor annotates; never rejected) |

   `reference → memory` is deliberate: a pointer note done right is the charter
   ([ADR-0004](0004-capture-insight-not-copies.md) — insight + procedure +
   **pointers**). Oversized references are an authoring failure handled by
   curation and doctor annotation, not by reclassifying the type.

3. **Per-KB extension, bounded.** `metadata.json` may carry a `genres` key mapping
   **new type strings onto the four existing genres** (e.g. `"runbook": "memory"`).
   It may **not** mint new genres — that would fork the lingua franca
   (ADR-0035 §6) and make KBs dialects.

4. **The recall surface after the split.**
   - `INDEX.md`/`MEMORY.md` carry: memory-genre lines + **one standing governance
     line** ("N accepted decisions govern this repo — read `decisions/` before
     architectural or scope changes").
   - Per-ADR recall rides **linking memories**: the small note that carries the
     recallable one-liner and links to its ADR (the pointer-leverage pattern,
     [ADR-0039](0039-context-footprint-measure-and-bound.md)).
   - **Wing skills gain a generated "Governing decisions" section** — one line per
     **accepted, non-superseded** ADR the wing's notes link to (proposed, rejected,
     and superseded decisions are excluded — they do not govern), harvested from the
     link graph at `mage skills` generation time. Contextual ADR recall at zero
     always-on cost.

5. **Lifecycle is declared semantics + read-only annotation — no event machinery.**
   The verbs in the table are convention; `mage doctor` annotates violations on its
   existing read-only line ([ADR-0037](0037-readiness-doctor-remit-and-autofix-line.md)):
   an edited `decision` that should have been superseded; a `work` note with no
   terminal status; a `doc` note whose `provenance.commit` trails HEAD by more than
   a threshold (`git rev-list --count` — a check, not a watcher); a memory-genre
   note over the size threshold (`noteSizeCap` — the doctor wire-in makes it the
   imported threshold, its first real consumer). Per
   [ADR-0038](0038-promote-note-rung-deleted-graduate-on-usage.md): **annotate,
   never sort.** Falsify-on-commit machinery and the path-collision decision nudge
   are deferred to the FT inbox.

6. **Migration is manifest-per-KB, human-approved, atomic.** A deterministic script
   classifies conforming notes; judgment resolves the residue; the output is one
   manifest per KB (`note → genre, action, reason`, low-confidence rows flagged).
   The operator approves each manifest once; the applier lands it in one commit.
   Git is the undo. Autonomy stays at operator
   ([ADR-0030](0030-agent-autonomy-ladder.md)).

## What this amends in ADR-0035

- **Keeps** §1 (one unified store), §2–3 (format embrace + normalize at the durable
  boundary), §4 (groom as curation, no tollbooth).
- **Sharpens** §5 "Recall": the harness auto-loads the index — *which now carries
  the memory genre only*. Recall of other genres is rung 3 plus the governance line
  and wing-skill sections.
- **Scopes** the phrase "notes are memories": true of the store and the format;
  the *recall tier* is earned by genre, not by residence.
- **Reaffirms** [ADR-0005](0005-one-canonical-memory-others-are-feeders.md)
  unchanged: still exactly one canonical durable store.

## Gate

- **Yield:** after migration, `MEMORY.md` ≤ ~20% of the host budget with zero
  document-genre lines; soak recall quality (prismalens, sreforge) does not regress
  over the observation window; groom's keep-rate calibration unblocks (the
  [[mature-kb-emits-no-capture-terminals]] hypothesis — documents were polluting
  the judgment pool).
- **KILL** if memory-genre recall demonstrably misses governing constraints that
  the forty always-on ADR lines used to catch (measured by soak steering
  corrections), or if the closed vocabulary forces real knowledge into
  `unclassified` at any meaningful rate.

## Consequences

- `CONVENTIONS.md` §6 rewritten: `plan`/`spec`/`tasks` are legal **types** but
  their genres are not memory — authored with eyes open, never by default.
- `src/scanner/` exports the type→genre map; `index`/`skills`/`doctor` consume it.
- `INDEX.md`/`MEMORY.md` generation filters to memory genre + governance line.
- `mage skills` generation adds the Governing-decisions section.
- `mage doctor` gains the genre-tell annotations (size, done-state vocabulary,
  issue-ref density, lifecycle violations); `noteSizeCap` becomes doctor's imported
  size threshold — its first real consumer (matching Decision §5).
- Three KBs migrate via approved manifests (home first, soaks after the A-window).
- Deferred to [future-thoughts](../notes/future-thoughts.md): falsify-on-commit,
  path-collision nudge, template wings (FT-04) as the delivery vehicle for
  per-work-style type maps.

## Amendment (2026-07-29) — a bounded roster replaces the flat-percentage bound

**Problem.** The yield half of Gate criterion 1 — `MEMORY.md` ≤ ~20% of the host
auto-memory budget — is **unreachable by construction for any KB that folds its
notes inline** (`foldInline` — flat or single-wing) **once its memory-note count
passes the budget-derived target**. That is the scope of the claim, and it covers
every KB that matures: not a target narrowly missed, but one the mechanism cannot
hold. The budget is `AUTO_MEMORY_MAX_LINES = 200` / `AUTO_MEMORY_MAX_BYTES = 25_600`
(`src/adapters/claude-code/constants.ts`), so the target is **40 lines /
5,120 B**. Measured post-migration, 2026-07-29:

| KB | lines | of 200 | bytes | of 25,600 | verdict |
|---|---|---|---|---|---|
| sreforge hub `MEMORY.md` | 86 | 43% | 7,493 | 29% | over |
| home `mage/MEMORY.md` | 59 | 29% | 5,666 | 22% | over |
| prismalens root `MEMORY.md` | 18 | 9% | 998 | 4% | passes — but see below |

sreforge holds **41 memory-genre notes** (gotcha 20, feedback 8, reference 4,
procedure 4, pointer 3, note 2). One line per note is **41 lines against a
40-line target before a single heading or blank line exists**, and those 41
entry lines alone are **7,006 B against the 5,120 B target — 1,886 B over with
zero structure**. The filter worked; the arithmetic still fails.

prismalens passes, and it is the scope boundary above rather than a
counter-example to it: it is multi-wing, so it never folds inline
(`foldInline = !hierarchical || wings.length <= 1`, `src/commands/index-cmd.ts`
~L313) and its root file was **already a bounded roster before Wave B ever ran**.
It measures the roster shape, not the genre filter — which makes it evidence
**for** the mechanism this amendment adopts, not against the claim that the flat
percentage is unreachable wherever notes fold inline.

**The no-fixed-point argument.** Post-filter, an inline-folded `MEMORY.md` is a
function of **how many memory-genre notes the KB holds**, and that count grows as
the KB matures — which is the KB succeeding. A percentage-of-budget target
therefore has no fixed point on that path: any inline-folding KB that keeps
learning eventually crosses it, and the only way to hold the line is to stop
capturing. This is the same shape of
uncalibratable gate as
[mature-kb-emits-no-capture-terminals](../notes/mature-kb-emits-no-capture-terminals.md)
— a criterion whose measured quantity moves the wrong way as the system gets
healthier. The remedy is the same: replace the moving target with a bound the
mechanism enforces.

**Amended criterion 1 (yield).** The gate is met when `MEMORY.md` **is a roster
bounded by construction** rather than a file measured after the fact. What
follows is the **contract a future renderer implementation must satisfy — not a
description of current behavior**. Today `mage index` hands *every* memory-genre
entry to `renderMemory`, and `renderFlat` only strips keyword tails and per-note
lines once the budget is breached: **no K is computed, no ranking is applied, and
no overflow line exists**. Building it is tracked separately as a 0.0.17
deliverable; **until it lands, criterion 1 is unmet by definition.**

1. **Shape.** One standing governance line (Decision §4) + the **top-K
   memory-genre entries** + **one overflow line** naming the total note count
   and pointing the reader at `INDEX.md`. Nothing else is pushed.
2. **K is adapter-derived — never a universal constant.** K falls out of the
   host's own budget constants, **lines AND bytes, whichever binds first**;
   Claude Code derives its K from `AUTO_MEMORY_MAX_LINES` /
   `AUTO_MEMORY_MAX_BYTES`, and a second harness brings its own budget and gets
   its own K. A hard-coded K is the flat percentage in a new costume.
3. **Ranking principle.** Usage-proven entries first — note-read usage where
   local metrics exist, the same signal
   [ADR-0038](0038-promote-note-rung-deleted-graduate-on-usage.md) graduates on
   — with a **deterministic fallback ordering (recency)** so `mage index` stays
   reproducible on machines that carry no metrics. Exact mechanics (tie-breaks,
   overflow wording, where K is computed) belong to the implementation spec; the
   ADR fixes only the principle: **push is bounded by construction, everything
   else is pull via `INDEX.md`.**
4. **The bound must reuse the bounding machinery that already exists.** The
   implementation is required to express the roster in terms of `renderMemory`'s
   existing `tier: 0 | 1 | 2` return and the `BREACH_RATIO` degradation ladder
   (`src/commands/index-cmd.ts`; `BREACH_RATIO = 0.9` in
   `src/metrics/footprint.ts`) rather than a flat percentage — the roster is to be
   held against the same thresholds the renderer already degrades on, not against
   a new parallel budget. Those thresholds exist today; **what does not exist is
   anything that bounds the entry count before they are reached.**

**Unchanged by this amendment.**

- **The other half of criterion 1 stands — and passed.** Zero document-genre
  lines in `MEMORY.md`, verified by type census on sreforge post-migration.
- **Criteria 2 and 3 are untouched and still unobserved** — soak recall quality
  (prismalens, sreforge) over the observation window, and groom's keep-rate
  calibration unblocking. Neither has been measured at all. **The gate cannot
  flip until they are:** this amendment makes criterion 1 *satisfiable*, it does
  not satisfy the gate. Status stays `proposed`.
- **No KILL condition fired.**

**New consequence — the trust boundary, acknowledged, not solved.** The recall
surface this amendment bounds is written by agents. Where the KB repo has **no
PR review** — most setups, including this author's own soak hubs — an
agent-written note is **trusted on write**: nothing stands between capture and
the always-on recall rung but the operator's attention. The backstops are the
ones the file format already supplies: `provenance` fields on every note,
staleness marking (`status: stale-suspect`, `last_reviewed`), and
**audit-on-suspicion via git history** — every claim has a commit, an author,
and a diff. That is weaker than review-before-recall, and it is recorded here as
an **accepted limitation, not a TODO**: mage does not answer it with a
write-time tollbooth ([ADR-0035](0035-decouple-harness-memory-from-notes.md) §4).

**Owner decision (2026-07-29).** The baseline table in the wave-plan note
([plan-adr-0041-waves](../work/plan-adr-0041-waves.md)) still states the ~20%
target and its pre-amendment measurements. It is **deliberately left as-is** — a
point-in-time work record of what was measured under the old criterion;
rewriting it would erase the evidence this amendment rests on.

## Relations

- amends [ADR-0035 — notes are memories: one unified store](0035-decouple-harness-memory-from-notes.md) (keeps the store; splits the recall)
- companion [ADR-0033 — recall: @import the bounded index](0033-recall-import-bounded-index.md)
- companion [ADR-0039 — context footprint: measure and bound](0039-context-footprint-measure-and-bound.md)
- builds_on [ADR-0038 — graduate on usage; annotate, never sort](0038-promote-note-rung-deleted-graduate-on-usage.md)
- builds_on [ADR-0004 — capture insight, not copies](0004-capture-insight-not-copies.md)
- constrained_by [ADR-0011 — recursive scan; folders are conventions](0011-recursive-scan-hub-projects.md)
- constrained_by [ADR-0003 — track work and notes; ignore artifacts](0003-track-work-ignore-artifacts.md)
- reaffirms [ADR-0005 — one canonical memory](0005-one-canonical-memory-others-are-feeders.md)
