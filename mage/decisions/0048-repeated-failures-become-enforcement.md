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
note; prismalens logged 18 note reads in 30 sessions; sreforge read none for a month and nothing
noticed. Routed through an enforcement ladder: 1 impossible, 11 checks, 5 hooks, 9 rules, 8
notes, 5 to delete. Of the 8 notes, about 3 pass the admission rule below. The store was
enforcement debt.

Deterministic selection of lessons has been tried three times and killed three times:
Faultline 0 of 62 (ADR-0027), prose-keyed 0 of 55 (ADR-0028), promote's recurrence fold 115
buckets and 0 proposals (ADR-0038). What survived is ADR-0029: code narrows, the agent judges,
the human commits. This decision keeps that shape and changes its target.

Native memory was commandeered (ADR-0032) because it minted lessons when mage's capture
minted none. Those lessons were then not read, and nothing asked whether each one should have
been a hook or a check instead of a note. The failure signal is also not where mage looks: tool errors are 1.6 percent of calls across all units and almost all crashes, review
findings on the same repos number in the hundreds, and a block by another plugin never reaches
the observe log because the observer listens after the call.

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
   the hooks, a PreToolUse `tool_attempt` event so blocks become visible, operator corrections,
   and one review-findings puller. `tool_attempt` and `tool_use` both carry the harness's
   invocation id; an attempt with no matching use is a prevented call. Every stream writes
   through `mage observe` on stdin, so Gate-1 (ADR-0014) holds and nothing appends to the log
   directly. Streams carry no weights; a finding is real and fits a rung, or it does not.
4. **A note is admitted only with a named trigger moment and a pointer, and is expected to
   leave**: promoted to a higher rung, or deleted when its trigger stops occurring. A deletion
   lands only as a reviewed pull request diff, which is not the hard-delete ADR-0016 forbids.
5. **Mode and scope are independent axes.** Mode (in-repo, hybrid, external) says where
   memory lives; scope says where a fix lands. Landing scopes for 0.1.0 are the code repo and
   the kit the user names at connect; an org workflows repo is a later scope. Consent to
   receive a pull request is a committed field, never a machine-local or environment carrier
   (ADR-0045 §10, ADR-0046 §5, ADR-0047): for the code repo it is a `landing` key in the
   knowledge base's `grooming` block, read from the hub in external mode; for the kit it is
   the kit's own committed contract file (#216). `connect` asks the question and writes that
   field, nothing else. A scope is writable when its consent field is present and its repo is
   reachable, checked when the proposal is made. A fix goes to the highest rung that has a
   writable scope. When none does, it becomes a note in the KB carrying its intended rung.
   Memory works in every mode without any of this; the loop needs one writable scope.
6. **Two numbers gate 0.1.0.** `prevented`: a landed fix fired (a denied call, a hook block or
   rewrite, a failed check). `left the queue`: a note promoted or deleted. The gate is
   `prevented` above zero for three distinct fixes, at least one on a unit other than
   mage-memory, and `left the queue` above zero. The ledger is derived from observe events
   and lives under `.mage/` (ADR-0025); a kit fix counts in whichever unit it fires. Nothing
   new is committed; the release notes quote the counts. Replaces the a1 gate of ADR-0024 and
   ADR-0040.
7. **The ladder runs before a memory is written.** Native memory stays on and pointed at the
   store; the moment the agent tries to save a lesson is the trigger. The ADR-0032 PreToolUse
   memory hook is repointed, not removed: it blocks the write, returns the ladder, and admits
   only a note that states why no higher rung fits, its trigger moment and its pointer. The
   same hook fires on direct writes under `notes/`. mage has no runtime; the hook makes the
   agent judge, it does not judge. The roster loads as before (ADR-0033).
8. **Migration is `mage migrate`, no new verb.** For a 0.0.x knowledge base it clears
   retired transient state, rewrites the AGENTS.md block (#198 first), repoints the memory hook
   to the ladder, installs the PreToolUse observe arm, and leaves
   `work/` in place with a warning and its links.
   Notes and decisions are untouched. Retired verbs print their replacement and exit 0.
9. **Plans live in the issue tracker.** `work/` is retired; decisions and notes remain.
10. **A decision fits on one screen.** Evidence and history go to the issue it names.

## Effect on prior decisions

- Superseded: 0003 (work/ retired), 0018 distill, 0019 promote, 0024 organic grooming loop,
  0038 graduate-on-usage, 0041 genre-decides-recall.
- Amended: 0001 (charter); 0005 (native memory feeds the ladder, not the store); 0006, 0033,
  0039 (roster bounded to admitted notes); 0032 (the memory hook carries the ladder, not a
  relocation); 0013 (skills are one output rung, measured
  by firing); 0015 (`tool_attempt` and the invocation id); 0016 (a delete via PR diff is not
  a hard-delete); 0017 (connect installs the PreToolUse arm and the ladder hook, asks for kit and streams); 0021
  (operator-invoked reads of the user's own forge with the user's credentials are not
  phone-home); 0029 (digest target is the rung proposal); 0030 (backlog tally becomes the
  repeats-and-proposals line; graduation clauses lapse); 0031 (the stamping chokepoint moves
  to the proposal applier); 0034 (adopt's import half moves to migrate); 0035 (native memory stays a feeder, through the hook); 0037; 0040
  (named release stays, gate is decision 6, evidence goes in the release notes); 0044; 0046
  (a proposal PR may also target the code repo or the kit, under decision 5's consent).
- Unchanged and load-bearing: 0004, 0008, 0009, 0010, 0014, 0036, 0042 to 0045, 0047. 0021
  gets its own telemetry ADR after 0.1.0.

## Consequences

Soak, keep-rate, distill, promote and graduate leave the CLI; their code is borrowed, not
kept. The nudge digest repoints from "chapters unmined" to "repeats and proposals". The #200
frontmatter rewrite stays a bug to fix, not a reason to drop the hook. The Obsidian graph stops being a goal. Existing notes are routed by hand once, per
the routing table, into issues in the repo where each fix lands. The docs site changes its
first sentence.
