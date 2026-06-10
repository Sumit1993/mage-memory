---
type: decision
tags: [mage/decisions]
created: "2026-06-09"
updated: "2026-06-09"
last_reviewed: "2026-06-09"
status: active
provenance:
  repo: mage-memory
  work: grill-0.0.9-readiness
sources:
  - src/commands/doctor.ts
  - src/metrics/rollup.ts
  - src/grooming/proposals.ts
---

# 0021 — mage stays offline: no phone-home telemetry; signal is local + voluntarily shared

A 2026-06-09 grill asked whether to add telemetry so the project could "make better
enhancements." mage's whole identity — **offline · user-owned · no server · privacy-first**,
with *metrics never enter git* and redaction as a **security boundary** ("a miss becomes
shared") — and its edge over cloud/server memory tools make default phone-home a
trust-killer at exactly the moment that identity is the marketing. But the improvement need
is legitimate, and mage is unusually well-placed to meet it **without** a beacon, because it
already computes the richest signal locally.

## Decision

1. **No phone-home telemetry in core, and never on by default.** mage does not send usage or
   content off the machine; the only network egress remains `doctor`'s opt-in connectivity
   check. "We don't track you; your memory and its metrics stay on your machine" is a
   **positioning win**, not merely a constraint
   ([ADR-0010](0010-durable-memory-not-coordination-layer.md)).

2. **The improvement signal is local.** mage already folds context-match, the recurrence
   tally, and the **accept/reject ladder** into the gitignored `.metrics/`
   ([ADR-0019](0019-mage-promote-self-grooming.md),
   [ADR-0016](0016-context-match-confidence-ladder-applier.md)). That same local data drives
   per-user adaptation (the deferred auto-tuner / autonomy rungs) **and** is what the
   dashboard ([ADR-0020](0020-no-server-tiered-dashboards.md)) surfaces. The path to "more
   automated promotions over time" runs through the user's *own local* accept-rate, not a
   remote server.

3. **For support/debugging, ship a voluntary, on-demand export: `mage doctor --report`.** A
   **redacted, anonymized, user-inspectable** bundle — mage/node/OS versions, KB + connection
   health (incl. the `git check-ignore` coverage check from the setup-integrity work),
   metrics **summary (numbers only)**, and redacted recent error signatures; **never** note
   content, keywords, paths, or secrets (it runs through the redaction boundary). It is the
   "please attach your logs" of mage — the bug issue template points at it
   ([ADR-0014](0014-two-gate-redaction.md)).

4. **If classic aggregate telemetry is ever built, it is out-of-core and must be opt-in (off
   by default) · transparent (a `--dry-run` shows the exact payload) · content-free ·
   documented** — the Homebrew/Astro model — and gets its own ADR. For this audience,
   off-by-default is non-negotiable.

## Considered and rejected

- **Default-on or opt-out telemetry** — betrays the privacy-first thesis and the very moat
  that distinguishes mage from cloud/server memory tools.

## Relations

- bounded_by [ADR-0010 — durable memory, not a coordination layer](0010-durable-memory-not-coordination-layer.md)
- guarded_by [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md)
- reads [ADR-0019 — mage promote: self-grooming](0019-mage-promote-self-grooming.md)
- offline_with [ADR-0020 — the dashboard: per-KB, no-server](0020-no-server-tiered-dashboards.md)
- sequenced_in [release sequence — 0.0.9](../notes/plan-release-sequence.md)
