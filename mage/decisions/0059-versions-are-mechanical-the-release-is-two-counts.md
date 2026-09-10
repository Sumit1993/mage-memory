---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [release, version, release-please, named-release, gate, prevented, left-the-queue, ledger, docs-site, drift-test]
---

# 0059 — Versions are mechanical; the release is named by two counts
## Decision
release-please mints versions from conventional commits; `bump-minor-pre-major` is on, so a `!` or a
`BREAKING CHANGE` footer mints 0.1.0. No version is reserved and none is a milestone. The announcement is a
named GitHub release whose notes quote two counts from the ledger. `prevented`: a guard fired (a denied call,
a hook block or rewrite, a failed check), above zero for three distinct guards at rungs 1 to 3, at least one
on a unit other than mage-memory. `left the queue`: a note climbed or deleted, above zero. The ledger is
derived from observe events under `.mage/`, per unit; an event counts in the unit whose observe log received
it; nothing new is committed. Docs are a static site generated from code with a CI drift test, and no page
states a number, hook or verb it did not derive from the code. Dogfood on a real knowledge base before a release.
## Why
A version number is a hash of the commit log, not a claim. A claim needs evidence anyone can recount, and the
previous gate ("organic note creation observed") was never met because nobody read the notes.
## Forbids
A breaking marker on a deprecation. An evidence ADR per release. A version reserved for a milestone. A
hand-typed load-bearing number in the docs. A committed ledger. Emojis in release notes.
## Example
Release "First guards" at 0.0.23: "prevented: kit/guard/webfetch 9, repo/guard/commit-trailer 3,
repo/guard/changeset-packages 2 (prismalens-kb); left the queue: 4 notes deleted, 1 climbed to a check."
## Relations
Absorbs 0024, 0026, 0040 and decision 6 of 0048. Enforced by `release-please-config.json`
(`bump-minor-pre-major: true`), `.github/workflows/release-please.yml`, `src/docs/generated-data.test.ts`,
`.github/workflows/docs.yml:56`. Named release #227; ledger #237; integration tests do not run in CI yet (#243,
PR #254), so "tests green" is a unit-test claim until then. Notes: `release-bump-touches-many-artifacts`,
`dogfood-before-release`, `no-emojis-in-releases`.
