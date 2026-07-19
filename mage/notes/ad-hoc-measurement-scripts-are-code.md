---
type: gotcha
tags: [mage/build]
created: "2026-07-19"
last_reviewed: "2026-07-19"
status: active
sources:
  - decisions/0039-context-footprint-measure-and-bound.md
  - decisions/0033-recall-import-bounded-index.md
provenance:
  repo: mage-memory
  work: adr-0039-context-footprint
keywords:
  - measurement
  - analysis-script
  - parser
  - false-precision
  - adr-evidence
  - cross-check
  - decision-input
---
# Gotcha — a throwaway measurement script is code, and its bug becomes an ADR's evidence

Numbers produced by ad-hoc analysis get quoted in decisions, commit messages and release notes,
where they acquire an authority the five-minute script never earned. **A parser bug in a
measurement becomes a wrong fact in the permanent record.**

**Hit 2026-07-19 (ADR-0039).** A script measuring redundant keywords in the generated index
split entry lines on `)`, which broke on any title containing parentheses — e.g.
*"Faultline: a friction/derivation capture trigger (prefilter, not miner)"*. Title fragments
were counted as keywords. The resulting figure — **"5,919 B of redundant keywords, 23% of the
host cap"** — was wrong, and it went into the ADR as justification and into the projected
outcome (`19,291 → 11,819 B`).

The implementation then measured **13,187 B**. The delegate flagged the gap and was told the
target band was probably right. It was not: re-measuring with a parser anchored on the link
showed the dedupe was **complete — zero redundant keywords remained**. The delegate was right
and the orchestrator's evidence was wrong.

The same class of error appeared twice more in one ADR: pointer sources were classified against
a single resolution base, producing "~46% measurable" when the real figure was **79%**, and its
inverse "54% unmeasurable" when the real figure was **~21%**.

**How to apply:**

- **Cross-check any number before it enters a decision** — measure it a second way and see if
  the two agree. Independent methods disagreeing is the cheapest bug detector available.
- Be most suspicious of **regex parsers over generated text**. Anchor on the structural element
  that cannot repeat (here, the `](` of a markdown link) rather than a delimiter that can appear
  inside the content.
- When an implementation **disagrees with your projection, suspect the projection.** The
  implementation ran against real data; the projection ran against your parser.
- Distinguish **projected** from **measured** in the ADR text, and when a projection proves
  wrong, record the correction rather than quietly editing the number — see ADR-0039 §10, which
  applies the same rule to [ADR-0033](../decisions/0033-recall-import-bounded-index.md)'s
  "~4KB" claim.
- Print the *derivation*, not just the total, so a wrong intermediate is visible.

Relates to [unreachable-constant-reports-a-false-state](unreachable-constant-reports-a-false-state.md)
and [weakening-a-test-can-delete-its-purpose](weakening-a-test-can-delete-its-purpose.md).
