---
type: decision
tags: [mage/decisions]
created: "2026-06-05"
updated: "2026-06-05"
last_reviewed: "2026-06-05"
status: active
provenance:
  repo: mage-memory
  work: mega-grill-skill-loop
sources:
  - src/scan.ts
  - skills/learn/SKILL.md
---

# 0014 — Two-gate redaction (strip secrets before write, not before display)

> **Amendment (2026-06-06, observe-schema grill).** The "fast/weak Gate 1 + strong
> Gate 2" framing below is **superseded**: the two gates were originally a hedge for a
> possibly-poor redactor. With one strong shared `redact()` engine, the distinction is
> **behaviour at a write boundary, not ruleset strength**. Read the model as:
> **one redaction engine, applied at every write boundary** — *scrub-and-continue* at
> the `mage observe` write (gitignored scratch, non-blocking, internal call), *scan +
> **block*** at the commit write. The commit-boundary check is **not redundant even
> with a perfect Gate 1**, for three reasons unrelated to regex strength: (a) it scans
> **bytes Gate 1 never saw** — a note is *authored by the agent* (capture-by-pointer),
> not a copy of `.learnings/`; (b) **blocking** is only safe at the tracked/shared
> write; (c) **agent PII judgment** can only run there ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)
> forbids a reasoner in the observe hook). Delivery: the commit check is best run as a
> **mage-installed git `pre-commit` hook** calling `mage redact --check` (auto, blocking)
> — so the user never types it; `mage redact` is repositioned as a **plumbing seam**
> (invoked by the hook / the graduate skill), not a daily verb. See
> [ADR-0015 §5](0015-mage-observe-capture-schema.md) and [CONVENTIONS §10](../../CONVENTIONS.md).

The self-grooming loop ([ADR-0013](0013-procedure-skills-self-grooming-loop.md))
moves content from raw observation → tracked, *shared* notes/skills. Secrets and PII
enter at the **earliest** point — raw transcripts and tool outputs at observe time —
not at skill-creation. Evidence checked during the grill: ECC's
`continuous-learning-v2` `observe.sh` regex-scrubs `(api_key|token|secret|password|
authorization|credentials|auth)` → `[REDACTED]` **before persisting** even its
machine-local observations; and industry guidance is consistent — *redact before
write, not before display* (a dedicated layer intercepts sensitive data before
storage). This ADR sets mage's redaction model.

## Decision

1. **Two gates.**
   - **Gate 1 — at `mage observe` (capture).** A fast, deterministic regex scrub of
     common secret patterns (+ high-entropy strings) **before** writing the gitignored
     `.learnings/*.jsonl`. ECC parity; defense-in-depth even though `.learnings/`
     never commits (it can still leak via sync, backup, or sharing a file for
     debugging).
   - **Gate 2 — at the commit boundary (distill / graduate).** A stronger
     deterministic scan (gitleaks-style ruleset + entropy) **and** an agent
     judgment-strip of PII/identifiers when a **note** is distilled or a **skill** is
     graduated — because those are *tracked and shared*, the point where a miss
     becomes public.

2. **Block-by-default at Gate 2.** A likely **live** secret **blocks** promotion and
   flags its location; the human removes it or confirms a false positive.
   [ADR-0004](0004-capture-insight-not-copies.md) ("capture insight, not copies")
   already keeps most verbatim secrets out structurally — this is the safety net at
   the tracked seam. Warnings (not blocks) are acceptable for low-confidence PII.

3. **Redact before write, not before display.** Scrub at the earliest write that
   could escape the machine. Display-time redaction is too late — the secret is
   already at rest.

4. **No new runtime.** Gate 1 and Gate 2's deterministic scans are reusable **mage
   code**; Gate 2's PII judgment-strip rides the **host agent**
   ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)).

## Considered options

- **Capture-scrub only (pure ECC parity)** — rejected: a regex miss sails straight
  into a committed, shared note; no net at the tracked seam.
- **Commit-scan only** — rejected: leaves raw live secrets in local `.learnings/` that
  leak via sync/backup/sharing, and diverges from "redact before write."
- **Rely on ADR-0004 + the user's own pre-commit hooks** — rejected: under-delivers an
  explicitly-requested capability and isn't portable across harnesses.
- **Warn-not-block at Gate 2 for live secrets** — rejected: a warned-past live secret
  is already public on commit. (Warn is fine for low-confidence PII.)

## Consequences

- Two reusable scrub/scan utilities in mage core; the PII strip rides host reasoning.
- `.learnings/` stays gitignored **and** scrubbed; notes/skills gain a redaction gate
  they must pass before they can be committed.
- Slightly more friction at promotion (a blocked secret stops the flow) — intended.
- Lands across two releases: **Gate 1** in the `mage observe` release, **Gate 2** in
  the distill/graduate release (see the [release sequence](../notes/plan-release-sequence.md)).

## Relations

- gates [ADR-0013 — procedure skills + the self-grooming loop](0013-procedure-skills-self-grooming-loop.md)
- realizes [ADR-0004 — capture insight, not copies](0004-capture-insight-not-copies.md)
- rides [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- mines ECC `continuous-learning-v2` (`observe.sh` capture-time scrub)
- informs [mage roadmap](../notes/roadmap.md)
