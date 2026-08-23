---
type: gotcha
tags:
  - mage/soak
created: "2026-07-31"
updated: 2026-08-12
last_reviewed: 2026-08-12
status: active
provenance:
  repo: mage-memory
  work: adr-0041-gate-judgment
sources:
  - notes/soak-targets.md
  - work/plan-adr-0041-waves.md
  - decisions/0041-genre-decides-the-recall-rung.md
  - decisions/0031-programmatic-provenance-stamp.md
  - file:~/ai-context/mage-soak/soak-report.mjs
keywords:
  - soak
  - monitor
  - blind-spot
  - dark-unit
  - keep-rate
  - capture-vs-adopt
  - baseline-flag
  - code-repo-path
  - absolute-path
  - evidence-pipeline
  - ratification-gate
  - cron
  - scheduler
  - session-boundary
  - presence-trigger
  - capture-vs-examination
---

# The soak monitor reports "absent" and "healthy" the same way — three blind spots that cost an observation window

**A soak that silently drops a unit looks exactly like a soak that is passing.**
Two were true of mage's monitor on 2026-07-31, and a third surfaced on
2026-08-12; together the first two made
[ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md)'s ratification gate
unjudgeable for an entire observation window that everyone believed was running.
Check all three before trusting any soak-derived evidence.

## Blind spot 1 — a unit goes dark on a stale absolute path, and only whispers

The hub's `metadata.json` records `code_repo_path` as an **absolute path**. When
the source tree moved under `~/sources/`, all three prismalens entries kept their
pre-move values. The monitor resolved them, found nothing, and printed one quiet
line per unit:

```text
- code repo not present on disk (/home/sumit/prismalens-org/prismalens) — not soaking
```

Then it carried on and produced a confident-looking rollup from the *remaining*
units. Nothing in the summary said "half your evidence base is missing." The
digest had been reporting 2 live units where there should have been 4, across
every run since the move.

**The tell:** compare the live-unit count against the roster in
[[soak-targets]] — never read the rollup alone. The rollup is computed over
whatever survived resolution, so it is exactly the number that cannot reveal an
absence.

**Why it recurs:** an absolute machine-specific path in a git-tracked file is the
same smell [ADR-0043](../decisions/0043-hub-addressed-by-remote-located-by-derivation.md)
retires for `hub_path` — and `code_repo_path` is the *same shape of field that
ADR-0043 does not cover*. Expect this class again until it is derived too.

## Blind spot 2 — a footer that says "not computed" long after it is computable

Every digest ended with *"**Keep-rate not computed** — needs the ADR-0031 Phase 2
reconciler + a `provenance.source` capture-vs-adopt split."* That sentence was
**self-perpetuating documentation of a fixed bug**: ADR-0031 Phase 2 had shipped
(`src/grooming/reconcile.ts`, with `.mage/metrics/keep-rate.json` present in all
five KBs). The monitor simply never opened the file. Anyone reading the footer
concluded the machinery was missing and moved on — including across several
sessions.

**The capture-vs-adopt split already existed too.** Each `seen` entry in
`keep-rate.json` carries a `baseline: true` flag marking the one-time adopt
cohort. That flag *is* the split the footer said was missing — no
`provenance.source` work was ever needed.

**The tell:** a "not yet built" note that names a specific artifact is cheap to
falsify — `find` for the artifact before believing the note. Each of those two
was a single `find`/`grep` command away from disproof and neither was run for
weeks, because a stale claim reads as current fact.

## Blind spot 3 — the digest is scheduled on a clock; the evidence is not

Blind spots 1 and 2 were bugs in the monitor. This one is a mismatch between how the
evidence *arrives* and how it is *read*.

**Capture is mechanical and needs no schedule.** It is a byproduct of working: on
2026-08-12 this repo's `mage/.mage/learnings/` held 71 session streams, 15 of them
written since the observation window restarted on 07-31, the newest written minutes
before the groom that produced this note. Nothing was missing.

**Examination is what stopped.** `soak-digest.sh` is documented as cron-driven;
`crontab -l` is empty and its `cron.log` was last written 2026-06-10. Every digest
since was hand-run — 06-14, 06-18, 07-01, 07-10, 07-31 — and none at all in the twelve
days after the window restarted. The window was never *empty*; it was **unexamined**.

**Cron is the wrong trigger on a personal machine.** A laptop that is off, or a week
with no work on this repo, silently skips a scheduled run and reports nothing — the same
failure shape as blind spots 1 and 2. The reliable trigger is **presence**: mage already
fires a boundary nudge at session start (`0 staged · N chapters unmined`). A digest read
when someone is actually there to read it belongs on that boundary, not on a clock.

**The tell:** do not measure an observation window in calendar days. Count what accrued —
sessions captured, chapters unmined — and check when a human last *looked*. "No digest for
twelve days" says nothing about the evidence; it says the reader was never run.

## Computing a keep-rate that means something

- Exclude `baseline: true` entries — adopted knowledge is not a fresh capture, and
  folding it in inflates the rate with a one-time cohort (22 entries here).
- Count `edited` as **kept**. Keeping a note after editing it is a keep; scoring it
  as a rejection punishes exactly the behaviour the loop wants.
- Print `n/a (no fresh captures yet)` for a unit with zero non-baseline entries.
  `0%` there reads as total rejection and means the opposite of the truth.

## Relations

- Soak layout, cadence, and unit definition: [[soak-targets]]
- The gate this blocked, and its 2026-07-31 judgment:
  [plan-adr-0041-waves](../work/plan-adr-0041-waves.md)
- The reconciler that makes keep-rate computable:
  [ADR-0031](../decisions/0031-programmatic-provenance-stamp.md) Phase 2
- Same absolute-path smell, decided against for hubs:
  [ADR-0043](../decisions/0043-hub-addressed-by-remote-located-by-derivation.md)
