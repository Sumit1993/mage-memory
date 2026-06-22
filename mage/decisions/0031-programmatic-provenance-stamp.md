---
type: decision
tags: [mage/decisions]
created: "2026-06-22"
updated: "2026-06-22"
last_reviewed: "2026-06-22"
status: active
provenance:
  repo: mage-memory
  work: provenance-stamp
sources:
  - src/provenance.ts
  - src/note.ts
  - src/git.ts
  - src/grooming/staging.ts
  - src/commands/groom-cmd.ts
  - mage/decisions/0030-agent-autonomy-ladder.md
  - mage/notes/future-thoughts.md
---

# 0031 — Programmatic provenance stamping + the autonomy reject-ledger (Phase 1: stamp at creation)

> Status: **Phase 1 built** (mage's writer stamps `provenance` at note creation). Phase 2
> (the reject-ledger reconciler) is **sketched here, not built**. Extends
> [ADR-0030](0030-agent-autonomy-ladder.md) by making its crown signal — the keep-vs-`git
> revert` ratio on autonomously-written notes — *measurable*, and is the first increment of
> the central frontmatter-builder that [FT-12](../notes/future-thoughts.md) names.

## Context

[ADR-0030](0030-agent-autonomy-ladder.md) gave the grooming loop an opt-in autonomy dial
(Operator / Approver / Overseer) and named the **live reject-ledger** — the keep-vs-revert
ratio on the notes the agent writes autonomously — as the only evidence that decides whether
higher autonomy is worth it. But measuring that ratio needs **reliable attribution**: which
notes did the agent author autonomously?

The first instinct was a **groom-skill instruction** ("when you write a note at Approver/
Overseer, add `provenance.autonomy` by hand"). That is exactly the wrong lever: an instruction
the agent can forget re-creates the "the maintainer/agent forgets" failure ADR-0030 exists to
kill, and it loses attribution precisely when the agent is being lazy — the worst-correlated
time. Attribution must be a **side-effect of the write**, not a step anyone performs.

The opening was already there: a note's `provenance` block (`repo`/`commit`/`work`) is defined
on the frontmatter type, but **no writer ever populated it** — it existed only on hand-authored
notes and ADRs. So the staleness heuristic (`mage dream`/dashboard read `provenance.commit`)
was blind to every auto-written note. Stamping provenance programmatically both fixes that
dormant gap and gives the reject-ledger its attribution.

This realizes the distinction grilled into [FT-12](../notes/future-thoughts.md): the
**automated** write path has a code chokepoint, so conventions belong in code (this ADR); the
**manual** hand-authoring path has no chokepoint, so a skill is its only lever (FT-12, separate).

## Decision

1. **mage's deterministic writer stamps `provenance` at note creation — never by agent
   instruction.** This is the first increment of the central frontmatter-builder; v1 stamps at
   one chokepoint (below), generalization to every writer is future work.

2. **Three fields, stamped at creation** ([src/provenance.ts](../../src/provenance.ts)):
   - **`autonomy`** — set **only** when `readAutonomy(resolved)` is `approver`/`overseer`
     (absent ⇒ operator / human-confirmed). This is the authorship mark the reject-ledger reads.
   - **`repo`** — the repo basename.
   - **`commit`** — the short git HEAD (omitted, fail-open, when not a git repo).
   `repo` + `commit` are stamped on *every* creation, finally populating the staleness anchor.

3. **Creation-only, not modification.** `autonomy` marks a *new note's* authorship: a merge /
   graduate / demote of an existing note never touches it (a human-authored note that later
   receives an autonomous merge **stays a human note**; reverting an *edit* is not rejecting a
   *note*). `repo`/`commit` are likewise creation-only in v1 — `updated`/`last_reviewed` already
   carry last-touch, so a modification-time `commit` refresh is deferred.

4. **Hub-aware.** The stamp reads autonomy via **`resolved.repo`** — ADR-0030's hub-path — so a
   hub-owned KB (the prismalens overseer soak) is stamped correctly, not silently skipped (the
   `root` vs `repo` divergence ADR-0030 already fought, regression-guarded here too).

5. **The injection point in v1 is the promote chokepoint** — `mage groom --accept` →
   `promoteDraft`, where every captured/groomed new note enters `notes/`. With a stamp,
   `promoteDraft` writes the stamped note (from the draft's already-parsed frontmatter+body) and
   removes the staging file; **without** a stamp it stays a byte-preserving `rename`. A pure
   `stampProvenance` + an I/O `resolveCreationStamp` are the shared seam the generalization reuses.

6. **The floor holds (ADR-0030 §3).** mage stamps deterministically (reads a config field + git
   HEAD; **no model** — [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)); the stamp
   lands uncommitted with the note; Gate-2 still runs ([ADR-0014](0014-two-gate-redaction.md));
   the `git commit` is the human's confirm ([ADR-0013](0013-procedure-skills-self-grooming-loop.md)).

7. **Phase 2 — the reject-ledger reconciler (sketched, not built).** A boundary-fired
   (SessionStart) deterministic pass that **snapshots** the stamped-uncommitted notes and diffs
   them against git HEAD + the working tree to classify each as **keep / edited / discard /
   reject / pending**, accumulating a **per-level keep-rate** under `.mage/metrics/`
   ([ADR-0025](0025-one-transient-state-home.md)), surfaced in the nudge line + dashboard. It is
   **self-contained**: it needs only this ADR's frontmatter stamp + git — boundary snapshots
   catch the dominant *discard-before-commit* reject going forward, so **no write-side
   pending-ledger** is needed. **No new `mage ledger` verb** in P1 (promote to a verb only if
   demand appears). The **crown threshold** — the pre-registered keep-rate that would justify
   raising the default autonomy — is registered **before** P2 measurement begins, not guessed
   now (no data to calibrate).

## Considered options

- **Groom-skill instruction (agent stamps by hand)** — rejected: unreliable, re-creates the
  "agent forgets" failure ADR-0030 fights. Supersedes the stopgap PR #41.
- **Full central frontmatter-builder now** (every writer; + `session`/`work`) — deferred: a
  bigger refactor; v1 stamps the one chokepoint the trial needs and leaves the shared seam for C.
- **A write-side pending-ledger** to catch discard-before-commit rejects — rejected for v1: the
  P2 boundary-snapshot reconciler catches discards itself; with no customers, an owned timeline,
  and a near-empty cohort, the retroactivity worry is moot (and the write-path hook is overkill).
- **A `mage ledger` command in P1** — rejected: surface bloat for a power-user signal; reconcile
  rides the existing boundary, display folds into the nudge + dashboard.
- **A `body_hash` in frontmatter** for edited-keep detection — rejected: the reconciler can
  snapshot the body hash at first sight (P2); a self-referential hash in the note is noise.

## Consequences

- Every captured/groomed **new** note now carries `provenance` — `autonomy` (≥ approver) for the
  reject-ledger, and `repo`/`commit` fixing the dormant staleness gap for all auto-written notes.
- The autonomy trial is **measurable**: attribution is reliable (writer-stamped, not discretion).
- `promoteDraft` is no longer a pure rename when a stamp is passed (it writes the stamped note it
  already holds + removes the staging file); the unstamped rename path is unchanged.
- **Known v1 gaps, deferred to the C generalization:** split-children and the dream-applier
  writes are not yet stamped (they are not on the autonomous-groom write path); no
  modification-time `commit` refresh; no `session` id.
- **Phase 2** (the reconciler + the pre-registered crown threshold) is the next decision + build.

## Relations

- **extends** [ADR-0030](0030-agent-autonomy-ladder.md) — makes its crown signal measurable; the
  stamp is the authorship mark the reject-ledger reads.
- **realizes** [FT-12](../notes/future-thoughts.md) — the automated-path twin of the central
  frontmatter-builder; v1 is its first increment.
- **rides** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) (no model — reads a config
  field + git), [ADR-0013](0013-procedure-skills-self-grooming-loop.md) (the commit is the
  confirm; the stamp is uncommitted), [ADR-0014](0014-two-gate-redaction.md) (Gate-2 still runs),
  [ADR-0025](0025-one-transient-state-home.md) (the P2 ledger lives under `.mage/metrics/`).
- **hub-aware via** [ADR-0023](0023-hub-own-notes-and-flat-projects.md) / the promote fan-out —
  the stamp reads autonomy through `resolved.repo`.
- **constrained_by** [ADR-0001](0001-memory-first-product-supersedes-specshub.md) — provenance is
  files-as-truth, stamped into the tracked note, never an out-of-band store.
