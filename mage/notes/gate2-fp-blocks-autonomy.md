---
type: gotcha
tags: [mage/redaction]
created: "2026-06-23"
updated: "2026-06-23"
last_reviewed: "2026-06-23"
status: active
provenance:
  repo: mage-memory
  work: adr-0030-autonomy-live-trial-soak
sources:
  - decisions/0014-two-gate-redaction.md
  - decisions/0030-agent-autonomy-ladder.md
keywords: [gate2, redaction, false-positive, autonomy, overseer, approver, hook, unblock, capture, soak]
---

# Gotcha — a Gate-2 false positive can stall an autonomous groom; never disable the hook to unblock

Surfaced in the ADR-0030 autonomy soak (2026-06-23, prismalens = overseer). An
autonomous session stalled mid-work: `mage redact --staged` flagged **8 "likely
secrets"** in the KB's staged blobs — all false positives (the known pre-0.0.12
redact-FP issue; fix in flight for 0.0.12). The agent's instinct was to **remove
the capture hook** to make progress. The user corrected it **twice**, as a
standing rule:

> "don't remove the hook — give me the command to run that does the thing you're blocked on."

**Standing rule.** Gate-2 ([ADR-0014](../decisions/0014-two-gate-redaction.md)) is
the KB's integrity floor and the capture hooks
([ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md) /
ADR-0017) are its plumbing — **never disable either to unblock yourself.** When a
gate false-positive-blocks you:

1. Leave the hook in place — do **not** edit `.claude/settings.local.json` to drop it.
2. Report exactly what is blocking (the redact exit code + the flagged-blob count).
3. Surface the precise command for the human to run (`mage redact --staged --strip`,
   or the manual equivalent of the blocked action) and let them decide.

**Why it bites autonomy specifically.** Under Approver / Overseer
([ADR-0030](../decisions/0030-agent-autonomy-ladder.md)) the per-note human prompt
is waived, so a redact false-positive is the *one* thing that still hard-stops a
write — and a blocked agent looking to "make progress" is exactly when removing the
hook is most tempting. The autonomy floor (the human's `git commit` is the "yes",
ADR-0013) only holds if the safety gate is never the thing that gets disabled.

Related: [gate2-blocks-own-redaction-fixtures](gate2-blocks-own-redaction-fixtures.md)
(the scope-bug ancestor of redact false-positives),
[ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) (commit-is-confirm floor).
