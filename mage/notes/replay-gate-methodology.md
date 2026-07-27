---
type: reference
tags: [mage/grooming, mage/evaluation, mage/capture]
created: "2026-06-20"
updated: "2026-07-27"
last_reviewed: "2026-07-27"
status: active
provenance:
  repo: mage-memory
  work: capture-validation-gate
sources:
  - mage/decisions/0027-faultline-friction-capture-trigger.md
  - mage/decisions/0028-prose-keyed-capture.md
  - mage/decisions/0029-digest-to-agent-capture.md
---

# Replay-gate methodology — does a capture mechanism produce USEFUL knowledge?

A reusable, **pre-registered, killable-by-data** test to run before shipping or default-enabling
ANY new detector / digest / capture heuristic. Three designs went through it (Faultline,
prose-keyed, digest→agent); two were killed, one passed. Set the bar BEFORE the run so the result
can kill the design rather than be rationalized. *(Compressed 2026-07-27 — the full harness
walkthrough lives in this file's git history.)*

## The gate

1. **Corpus + negative control** — real ops/infra transcripts (where earned insight lives) PLUS
   mage's own dev logs as control.
2. **Run the SHIPPED code** over the corpus (via `tsx`, never a re-implementation).
3. **Eyeball before spending agents** — confirm known gold-gem signals survive the narrowing.
4. **Judge** with a **balanced multi-lens value judge** (never an adversarial refuter — below).
5. **Recall** per session against an agent-derived gold gem-set.
6. **Pre-registered bar** (e.g. keep ≥ 1/3 → flag; < 1/5 → kill), written down before the run.
7. **Verdict** — a replay pass can only flip a flag / start a live trial. **Replay can KILL; only
   a live reject-ledger can CROWN.**

## Calibration lessons (paid for in three gates and a near-miss false-kill)

- **An adversarial "default-reject" refuter is UNWINNABLE.** A capable model finds a universal
  solvent ("self-documenting / obvious / one-off") for *any* operational lesson — it once killed
  all 58 candidates including the user's own motivating example, scoring a false 0/0/0.
- **A clean control proves the judge is not lenient — NOT that it is not unwinnable.** A
  kill-everything refuter also yields a clean control. Cross-check that the judge KEEPS known-real
  gems, not just that it rejects control.
- **Balanced multi-lens judge**: confirm = consensus of *forward-value* ("would a new engineer be
  glad this note exists?") + *earned-cost* ("expensive to re-derive?"), WITH explicit reject
  criteria. If the reject set is empty, it is rubber-stamping — inspect it every time.
- **"Self-documenting ≠ worthless."** An error that prints its own fix still has
  proactive-avoidance value; cost-to-re-derive includes HITTING the failure, not just fixing it.
- **Score value to the session's OWN project** — a "value to THIS project" frame wrongly
  down-scoped cross-project lessons (~14 confirmed gems lost; precision floor 0.333 was ~0.5).
- **Separate CAPTURE (recall — did the mechanism surface the gems?) from VALUE (precision — worth
  keeping?).** A broken refuter conflated them and hid that capture had succeeded.

## Discipline

Cheap checks that each caught a real bug before a 60–120-agent judging workflow: eyeball the
digest on a couple of real sessions; grep it for each known gem; verify the judge discriminates
(non-empty reject set) before trusting any keep-rate.

## Pointers

- Standing corpus + harness: `~/ai-context/mage-prove-20260619/` (author-local; adapter maps raw
  CC transcripts → `ObserveEvent[]`).
- [ADR-0027](../decisions/0027-faultline-friction-capture-trigger.md) ·
  [ADR-0028](../decisions/0028-prose-keyed-capture.md) ·
  [ADR-0029](../decisions/0029-digest-to-agent-capture.md) — the three gated designs and outcomes.
