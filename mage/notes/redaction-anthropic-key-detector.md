---
type: gotcha
tags: [mage/redaction]
created: "2026-06-07"
updated: "2026-06-07"
last_reviewed: "2026-06-07"
status: active
provenance:
  repo: mage-memory
  work: 0.0.6-build-dogfood
sources:
  - src/redact.ts
  - src/redact.test.ts
---

# Gotcha — key bodies with `-`/`_` partially leak past the high-entropy detector

A 0.0.6 dogfood (with `connect` auto-wiring `observe`) caught a real Gate-1
**partial leak**: a realistic Anthropic key
`sk-ant-api03-<base64url body>` was only *partly* redacted —
`sk-ant-api03-a8Kd…G-_[REDACTED:high-entropy]` — leaking the `sk-ant-…` prefix +
~30 chars raw.

**Why.** The generic `high-entropy` detector matches contiguous `[A-Za-z0-9/+]`
runs. Anthropic key bodies contain `-` and `_`, which split the run, so only the
longest interior chunk is caught and the recognizable prefix survives. The
`openai-key` regex doesn't help: its `sk-(?:proj|svcacct|admin)?-?[A-Za-z0-9]{32,}`
char-class breaks on the `ant-` segment.

**Fix / principle.** Any credential whose body can contain non-base64 separators
(`-`, `_`) needs a **dedicated structural detector** that claims the WHOLE token —
never rely on the entropy fallback for it. Added `anthropic-key`
(`\bsk-ant-[a-z0-9]{2,20}-[A-Za-z0-9_-]{20,250}`) **before** the generic `sk-` and
high-entropy detectors (detector order = scan priority; earlier wins the overlap).

**Procedure when adding a key detector.** Place it specific-before-general in the
`DETECTORS` table; add a real-shaped fixture to `POSITIVES` **and** `RAW_SECRETS`
in `src/redact.test.ts` (the never-leak loop is the regression guard); include a
fixture whose body has `-`/`_` so a future prefix-leak regression is caught.

See [redaction in the glossary](context.md) and ADR-0014 (two-gate redaction).
