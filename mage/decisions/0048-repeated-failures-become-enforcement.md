---
type: decision
tags:
  - mage/decisions
created: "2026-09-03"
updated: 2026-09-03
last_reviewed: 2026-09-03
status: proposed
provenance:
  repo: mage-memory
sources:
  - gh-issue:204
  - decisions/0001-memory-first-product-supersedes-specshub.md
  - decisions/0029-digest-to-agent-capture.md
  - decisions/0046-derived-hub-git-and-merge-ratification.md
  - docs/plans/0048-road-to-0.1.0/mage-direction-assessment-2026-09-03.md
  - docs/plans/0048-road-to-0.1.0/mage-notes-ladder-routing-2026-09-03.md
  - docs/plans/0048-road-to-0.1.0/mage-adr-digest-2026-09-03.md
keywords:
  - charter
  - enforcement-ladder
  - repeated-failure
  - streams
  - note-admission
  - fire-counter
  - release-gate
  - audit
---

# 0048 — Repeated failures become enforcement; memory is the queue, not the product

> **Status: proposed (2026-09-03).** Changes the charter set by ADR-0001. The plan, evidence
> and issue list live in the tracking issue (#204, rewritten under this ADR).

## Context

Three months of capture produced 39 notes. 3 of 126 closed chapters in this repo read any
note; prismalens read 18 notes in 30 sessions; sreforge read none for a month and nothing
noticed. Routed through an enforcement ladder, 17 notes are programs waiting to be written,
9 are one-line rules, 5 are dead, 3 are memory. The store was enforcement debt.

Deterministic selection of lessons has been tried three times and killed three times:
Faultline 0 of 62 (ADR-0027), prose-keyed 0 of 55 (ADR-0028), promote's recurrence fold 115
buckets and 0 proposals (ADR-0038). What survived is ADR-0029: code narrows, the agent judges,
the human commits. This decision keeps that shape and changes its target.

Native memory was commandeered (ADR-0032) because it minted lessons when mage's capture
minted none. Those lessons were then not read. The failure signal is also not where mage
looks: tool errors are 1.5 percent of calls and almost all crashes, review findings on the
same repos number in the hundreds, and a block by another plugin never reaches the observe
log because the observer listens after the call.

## Decision

1. **mage is the loop that turns a repeated failure into enforcement.** Streams feed observe
   events; code narrows on first sight, counts rank the digest and never gate it, a bounded
   number of proposals per pass; the agent judges the highest rung the fix can reach; the fix
   lands by pull request (ADR-0046); a ledger counts how often it fires; what never fires is
   flagged.
2. **The ladder is doctrine.** Make it impossible (architecture, config, deny rule); a check
   (lint, test, CI, pre-commit); a hook that blocks or rewrites at the moment of the action;
   one line of rule in an AGENTS.md or a skill; a note. A lower rung only when every higher
   rung is shown not to apply.
3. **A stream is anything that emits observe events** (ADR-0015 schema, additive). Built in:
   the hooks, a PreToolUse attempt event so blocks become visible, operator corrections, and
   one review-findings puller. Streams carry no weights; a finding is real and fits a rung, or
   it does not. Anything else is a one-line contract: emit this JSONL here.
4. **A note is admitted only with a named trigger moment and a pointer, and is expected to
   leave**: promoted to a higher rung, or deleted when its trigger stops occurring.
5. **Mode and scope are independent axes.** Mode (in-repo, hybrid, external) says where
   memory lives; scope says where a fix lands. Landing scopes are the code repo, the kit the
   user names at connect, and the org workflows repo. `connect` records which of them accept
   a pull request on this machine: the code repo does in in-repo and hybrid mode, and in
   external mode only with explicit consent (ADR-0047 carrier). A fix goes to the highest rung
   that has a writable scope. When none does, it becomes a note in the KB carrying its intended
   rung. Memory works in every mode without any of this; the loop needs one writable scope.
6. **Two numbers gate 0.1.0**: bad actions prevented by a landed fix, and notes that left
   the queue. They replace the a1 gate of ADR-0024 and ADR-0040.
7. **Native auto-memory is off.** Capture reaches the store only through mage's own hooks.
8. **Migration is `mage migrate`, no new verb.** For a 0.0.x knowledge base it clears:
   commandeer off, retired transient state deleted, the AGENTS.md block rewritten, `work/`
   warned about and left in place. Notes and decisions are untouched. Retired verbs print
   their replacement and exit 0.
9. **Plans live in the issue tracker.** `work/` is retired; decisions and notes remain.
10. **A decision fits on one screen.** Evidence and history go to the issue it names.

## Effect on prior decisions

- Superseded: 0003 (work/ retired), 0018 distill, 0019 promote, 0024 organic grooming loop,
  0032 capture-redirect, 0038 graduate-on-usage, 0041 genre-decides-recall.
- Amended: 0001 (charter), 0005 (native memory off, not a feeder), 0006 and 0033 (roster
  bounded to admitted notes), 0013 (skills are one output rung, measured by firing), 0029
  (digest target is the rung proposal, not the lesson), 0040 (named release stays, gate
  replaced by decision 6).
- Unchanged and load-bearing: 0004, 0008, 0009, 0010, 0014, 0015, 0016, 0017, 0021, 0030,
  0036, 0042 to 0045, 0047. 0021 (no phone-home) gets its own ADR after 0.1.0.

## Consequences

Soak, keep-rate, distill, promote and graduate leave the CLI; their code is borrowed, not
kept. The nudge digest repoints from "chapters unmined" to "repeats and proposals". The
Obsidian graph stops being a goal. Existing notes are routed by hand once, per the routing
table, into issues in the repo where each fix lands. The docs site changes its first sentence.
