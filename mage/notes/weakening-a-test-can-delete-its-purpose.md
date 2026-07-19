---
type: gotcha
tags:
  - mage/build
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: active
provenance:
  repo: mage-memory
  work: adr-0038-pr1-note-rung-deletion
sources:
  - https://github.com/Sumit1993/mage-memory/pull/72
  - decisions/0038-promote-note-rung-deleted-graduate-on-usage.md
  - cc-session:d8d18f6f-21d4-4679-8b16-531132e1b88d
keywords:
  - test
  - vacuous
  - assertions
  - green-suite
  - false-confidence
  - behaviour-change
  - fixture
  - regression
  - code-review
  - coderabbit
modified: 2026-07-19T08:44:11.205Z
---

# Gotcha — weakening a test's assertions to make it pass can delete its purpose

Deleting `promote`'s note-proposal rung (ADR-0038) broke a command-level test that
asserted the rejected-buffer suppressing a re-offered note proposal. The rung was
gone, so the proposal never appeared. The test was "fixed" by repointing it to the
new reality:

```ts
// before writeRejected
expect(parsed.proposals).toHaveLength(0);
// after writeRejected
expect(parsed.proposals).toHaveLength(0);
```

It passed. The suite went green — **1224 passed** — and that number was reported as
evidence the change was sound.

The test was worthless. Both assertions were guaranteed true regardless of the code
under test: the fixture never produced a proposal in the first place, so it would
have passed with rejection loading **entirely removed**. A whole wiring path
(`writeRejected` → `readRejected` → `buildManifest`) was silently uncovered, and the
green suite actively concealed it. CodeRabbit caught it in review; the test run never
could.

## The shape

When a behaviour change breaks a test, there are two different repairs and they look
almost identical in a diff:

- **Update the fixture** so it still exercises the thing the test names, under the
  new behaviour.
- **Weaken the assertion** until it matches whatever the code now does.

The second always goes green, which is exactly why it is tempting under time
pressure. It converts a regression test into a tautology while leaving its *name*
promising coverage that no longer exists.

## How to apply

When a test breaks because behaviour changed deliberately, ask: **would this test
still fail if the feature it names were deleted outright?** If no, it is a tautology
— rebuild the fixture or delete the test honestly. Never leave a passing test whose
name claims coverage it does not provide; that is worse than no test, because it
suppresses the gap.

Two concrete habits:

- **Assert the positive before the negative.** A suppression test must first prove
  the unsuppressed case produces the thing, *then* prove suppression removes it. One
  assertion cannot carry both.
- **Derive fixture values from the system, not from memory.** The rebuilt test reads
  the covering note's keywords back from the folded tally rather than hardcoding
  them, so it cannot silently drift from the tokenizer it depends on.

And the reporting lesson: **a green suite is evidence only about the tests that
exist.** "1224 passed" said nothing about the path that had just lost its only
coverage. Do not offer a pass count as proof that a change is correct.

Related: [[promote-folds-mechanical-tokens]] — the same PR's other lesson, that
volume without value is evidence about the mechanism.
