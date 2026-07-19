---
type: gotcha
tags: [mage/build]
created: "2026-07-19"
last_reviewed: "2026-07-19"
status: active
sources:
  - decisions/0039-context-footprint-measure-and-bound.md
  - src/metrics/footprint.ts
  - src/adapters/claude-code/constants.ts
provenance:
  repo: mage-memory
  work: adr-0039-context-footprint
keywords:
  - unreachable-constant
  - dead-code
  - false-state
  - green-tests
  - wiring-bug
  - regression-test
  - default-parameter
---
# Gotcha — a constant that is defined but never imported reports a false state while every test passes

A named constant is not wired just because it exists. If nothing imports it, the code silently
uses some other default — and **the test suite stays green, because tests usually pass the value
explicitly.**

**Hit twice in one branch (2026-07-19, ADR-0039):**

1. `AUTO_MEMORY_MAX_BYTES = 25_600` was added to the Claude Code adapter and **never imported**.
   `measureFootprint` fell through to a 16 KB default, so the tool reported `state: "warn"` on a
   knowledge base that was actually at 51.5% of the real cap. Every test passed — each one
   supplied `capBytes` itself, so none exercised the default path.
2. The mirror image immediately afterwards: `DEFAULT_CAP_BYTES` was left defined but unreachable
   because there is no harness detection to select it. A default no code path can reach is
   indistinguishable from a claim the tool does not honour.

**The tell:** grep the constant across `src/`. Count **local** uses, **cross-file production**
uses, and **test** uses separately — a naive grep that excludes the defining file makes
legitimately local constants look orphaned, and a naive grep that includes tests makes dead
constants look alive.

**How to apply:**

- **The regression test is the one that OMITS the parameter.** `expect(result.capBytes).toBe(25_600)`
  with no `capBytes` passed is the only test that can catch a wiring bug. A test that always
  supplies the value proves nothing about the default.
- When a constant proves unreachable, prefer **deleting it** over keeping it as documentation of
  intent — and record the *reason* at the resolution site so the next reader does not re-add it.
- Exception worth respecting: a constant may be unreachable because it points at a **real
  unimplemented gap** rather than being dead. `AUTO_MEMORY_MAX_LINES = 200` was unreachable
  because mage enforced only the byte half of a two-dimensional host cap — deleting it would
  have erased the evidence of a live truncation path. Ask which kind you have before removing it.

Relates to [weakening-a-test-can-delete-its-purpose](weakening-a-test-can-delete-its-purpose.md).
