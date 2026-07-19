---
type: gotcha
tags:
  - mage/grooming
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: active
provenance:
  repo: mage-memory
  work: prismalens-soak-groom-2026-07-19
sources:
  - decisions/0019-mage-promote-self-grooming.md
  - decisions/0029-digest-to-agent-capture.md
  - https://github.com/Sumit1993/mage-memory/issues/71
  - cc-session:d8d18f6f-21d4-4679-8b16-531132e1b88d
keywords:
  - promote
  - recurrence
  - precision
  - denoise
  - signature
  - keyword-fold
  - mechanical-tokens
  - watermark
  - rejected-buffer
  - soak
  - mature-kb
modified: 2026-07-19T07:44:36.771Z
---

# Gotcha — promote's recurrence fold has near-zero precision on a mature KB

A full `mage:groom` across four prismalens roots (hub + platform + io + engine)
on 2026-07-19 produced **~115 recurrence buckets and 0 durable proposals**. Not a
tuning problem — a signal problem. Every bucket was mechanical fold noise.

## Why it folds on noise

The bucket key is `${wing}::${keywords.join(",")}` (`src/grooming/signature.ts:324`),
built from up to 6 tokens. Two hardcoded filters guard it
(`signature.ts:60-70`): `STOPWORDS` (English function words) and `DENOISE` —
the **13 classic Claude Code built-ins** (`read, edit, write, bash, grep, …`)
plus ~20 generic filenames.

That list has drifted behind the harness. Surviving the filter today:

- `toolsearch`, `workflow`, `skill`, `monitor`, `sendmessage` — postdate the list
- `mcp__*` tool names — never covered
- `llm` (from `llm.ts`) — only *generic* filenames are denylisted, not filenames as a class
- `adr` and `0019` (from `ADR-0019`) — no numeric filter, and `adr` is high-frequency
  in a docs-heavy repo, so it pulls unrelated work into one bucket

`workflow` is a double hit: it is also a lens name, so it collides with the fold itself.
Both sets are `const`s — no entropy filter, no per-repo denylist, no config hook.

## The churn is re-OFFERING, not re-folding

Worth stating precisely, because the intuitive diagnosis is wrong and cost a
round of misattribution during the groom.

Folding **is** idempotent. `foldSession` folds only `[prevFold.offset, closedCount)`
and the offset is never-regress (`tally.ts:183-200`, `:226`). No chapter is
double-counted on a normal re-run.

The apparent endless churn comes from counts in `tally.signatures` persisting
**independently of the offset**. A proposal rejected but not written to the
rejected buffer clears its threshold again on every subsequent run. That is why
reject-only passes at a settled watermark drained the backlog in ~10 rounds
instead of converging on their own.

## Two more traps found while tracing

- **The watermark burns on empty rounds.** `promote-cmd.ts:142-143` writes the
  tally *before* thresholds, notes, or `buildManifest` are consulted (`:145-150`).
  A plain `mage promote --json` advances it even on a zero-proposal round, and a
  throw at `:150` leaves it already persisted.
- **`promoteSessions: 3` does not mean 3 sessions.** The unit is a compact
  *chapter* (`tally.ts:1-10`, `thresholds.ts:29-30`). One long continuously-compacted
  chat can hit K=3 alone — which makes precision matter more, not less.

## How to apply

**Superseded in part, 2026-07-19 — read [ADR-0038](../decisions/0038-promote-note-rung-deleted-graduate-on-usage.md) before acting on this.**
This note originally recommended replacing the denylist with a semantic-content score.
That was wrong in the same way `DENOISE` is wrong: both are attempts to build a
deterministic selector of a purely semantic property, which
[ADR-0029](../decisions/0029-digest-to-agent-capture.md) killed on the evidence of two
pre-registered gates (Faultline 0/62, prose-keyed 0/55). ADR-0038 deletes the fold
instead of improving it.

What survives from this note is the **diagnosis**, not the remedy:

- Do not "fix" a noisy fold by extending `DENOISE` — a denylist enumerating a moving
  tool surface will drift again.
- Do not fix it by scoring tokens more cleverly either. That is the same move.
- When a groom reports a large bucket count with zero proposals, read it as
  **evidence about the mechanism**, not as a backlog to grind down.

The general lesson, and the reason this note is kept: when a deterministic engine
produces high volume and zero value, check whether it is being asked to *decide*
something semantic. If so, the fix is to reposition it as a narrower/annotator and
route the judgment to the agent — never to make it a better decider.

Related: [[phase2-reject-ledger-0.1.0-gate]] — the same soak showed a mature KB
emits no capture terminals, so the keep-rate gate cannot calibrate there either.
