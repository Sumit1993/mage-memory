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
  work: adr-0040-version-milestone
sources:
  - decisions/0024-organic-grooming-loop.md
  - decisions/0030-agent-autonomy-ladder.md
  - decisions/0039-context-footprint-measure-and-bound.md
  - notes/phase2-reject-ledger-0.1.0-gate.md
  - notes/mature-kb-emits-no-capture-terminals.md
  - notes/plan-release-sequence.md
  - release-please-config.json
  - cc-session:254aa0ba-a431-4d8f-8bc5-c50d001180c5
keywords:
  - versioning
  - release-please
  - milestone
  - announcement
  - semver
  - mechanical-version
  - named-release
  - silent-failure
  - evidence-not-number
modified: 2026-07-19T17:33:52.304Z
---

# 0040 — version numbers are mechanical; the announcement is a named release backed by evidence

> **Status: accepted (ratified 2026-07-19).** Supersedes the "**0.1.0 is the announcement**"
> clause of [ADR-0024 §8](0024-organic-grooming-loop.md); the rest of ADR-0024 stands, including
> its **a1** gate, which moves here intact and merely stops being attached to a version string.

## Context

ADR-0024 §8 reserved **0.1.0** as "the announcement", gated on *a1 = observed organic note
creation in real use*. That made a semver number carry a **quality claim**.

The tooling does not agree. `release-please-config.json` sets `"bump-minor-pre-major": true`, so
in a pre-1.0 project **any breaking change takes the minor** — 0.0.13 → 0.1.0 — regardless of
whether any gate was met. This fired on 2026-07-19: [ADR-0039](0039-context-footprint-measure-and-bound.md)'s
`feat(index)!` dedupe claimed 0.1.0 mechanically, and the milestone was only preserved by
noticing in time and pushing a `Release-As: 0.0.14` override (PRs #75, #76).

**The failure mode is silence.** A future breaking change that lands without that footer spends
the milestone, and nothing errors — no CI failure, no warning. The reservation is protected only
by someone remembering, forever, on every pre-1.0 breaking change. Flipping
`bump-minor-pre-major` does not help: with it `false`, a breaking change bumps to **1.0.0**,
which is worse.

There is a deeper mismatch. A version number is an **ordering device**; it says what came after
what. A milestone is a **claim with evidence** — here, an observed a1 and, for autonomy, the
keep-rate ledger of [ADR-0030](0030-agent-autonomy-ladder.md)/ADR-0031. Numbers cannot carry
evidence, cannot be revised when evidence changes, and cannot say *why*. Encoding a claim in one
means the claim is unfalsifiable at the point a reader meets it.

## Decision

### 1. Version numbers are mechanical output. They carry no quality claim.

Versions are whatever `release-please` derives from conventional commits. **No version number is
reserved, and none is a milestone.** `0.1.0` may be spent by any breaking change, as may any
other number. Going forward **no `Release-As` overrides are used** to protect a milestone.

### 2. The announcement is a **named GitHub release plus an ADR**, carrying the evidence.

When ADR-0024's **a1 gate** is judged met — *observed organic note creation in real use* — the
announcement is:

- a **named GitHub release** (a title, not a number: e.g. "Soak-verified"), cut at whatever
  version is current, and
- an **ADR recording the evidence** that satisfied a1 — which soak, which KBs, what was observed
  — so the claim is auditable and can be revisited if the evidence turns out to be weak.

**ADR-0024's a1 gate is unchanged and still binding.** What changes is only that satisfying it
produces a *named release with evidence* rather than a *version number*.

### 3. Autonomy promotion stays a separate gate.

The keep-rate / `crownThreshold` bake ([ADR-0030](0030-agent-autonomy-ladder.md), ADR-0031
Phase 2) governs **autonomy promotion**, not the release. Conflating the two was an error made
during this session's discussion: the release gate (a1) is the looser one, and
[mature-kb-emits-no-capture-terminals](../notes/mature-kb-emits-no-capture-terminals.md) shows
the keep-rate gate may be **structurally uncalibratable on a mature KB** — which must not be
allowed to block a release it was never gating.

### 4. Existing references to "0.1.0 the milestone" are historical.

[ADR-0020](0020-no-server-tiered-dashboards.md), [ADR-0026](0026-hosted-docs-website.md),
[plan-release-sequence](../notes/plan-release-sequence.md) and other notes mention 0.1.0 as an
announcement or credibility push. Those were written when the version and the milestone were the
same thing. They are **not** rewritten — they are point-in-time records, and this ADR is the
current rule. A reader hitting "0.1.0" in an older document should read it as *"the
announcement"*, not as a version instruction.

## Consequences

- **The silent failure mode is gone.** There is no footer to forget, because there is nothing to
  protect.
- 0.0.14 ships with the override already applied (PRs #75/#76). That is a **transitional
  artifact**, not a precedent — it is not reverted, because there is nothing wrong with the
  number, and churn to reach purity would be its own cost. From 0.0.15 onward, no overrides.
- The announcement gains what a number could never carry: a **why**, and an audit trail.
- Slight cost: someone scanning tags alone cannot see the milestone. Accepted — the release list
  and the ADR both show it, and neither can be spent by an unrelated commit.

## Rejected

- **Keep overriding with `Release-As`** — works, but preserves a silent, manual, permanent
  obligation whose failure is irreversible-ish and invisible.
- **Move the milestone to 1.0.0** — stops the tooling fighting, but 1.0.0 additionally implies
  **API stability** mage is not ready to promise; it would smuggle a second claim into the first.
- **A CI guard that fails on an unapproved 0.1.0** — makes the failure loud, but adds a gate to
  maintain in order to defend a convention that this ADR concludes was not worth having.
- **Flipping `bump-minor-pre-major` to `false`** — makes pre-1.0 breaking changes bump to 1.0.0.
  Strictly worse.

## Relations

- supersedes the "0.1.0 is the announcement" clause of
  [ADR-0024 §8 — organic grooming loop](0024-organic-grooming-loop.md); its a1 gate stands
- separates from [ADR-0030 — agent autonomy ladder](0030-agent-autonomy-ladder.md)'s keep-rate
  crown signal, which gates autonomy, not releases
- triggered by [ADR-0039 — measure the context footprint](0039-context-footprint-measure-and-bound.md)'s
  breaking change claiming the minor mechanically
- context in [phase2-reject-ledger-0.1.0-gate](../notes/phase2-reject-ledger-0.1.0-gate.md) and
  [mature-kb-emits-no-capture-terminals](../notes/mature-kb-emits-no-capture-terminals.md)
