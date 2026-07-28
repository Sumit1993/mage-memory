---
type: gotcha
tags:
  - mage/build
created: "2026-07-27"
updated: 2026-07-27
last_reviewed: 2026-07-27
status: active
provenance:
  repo: mage-memory
  work: adr-0041-wave-b
sources:
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
keywords:
  - status
  - vocabulary
  - accepted
  - active
  - filter
  - census-first
modified: 2026-07-27T09:10:58.135Z
---

# Gotcha — filter on a frontmatter enum only after a census; vocabulary drifts silently

ADR-0041's governing-decision filters were written to `status === "accepted"` per the ADR's
words — but 28 of 40 ADRs in this very repo use the older `status: active`. Both Wave-B
surfaces silently undercounted 3× (governance line said 10, wing harvest dropped 28) and every
test passed, because fixtures used the same vocabulary as the code.

**Rule:** before filtering on any frontmatter enum, census the real corpus first
(`grep -h "^status:" dir/*.md | sort | uniq -c`) and widen or normalize. The widening itself
must be pinned by a test using the *legacy* value — the extreme review caught that the
`accepted|active` patch was initially untested. Same failure family as
[[unreachable-constant-reports-a-false-state]]: green tests over a vocabulary the code never
meets.
