---
type: decision
tags:
  - mage/decisions
created: "2026-08-22"
updated: 2026-08-22
last_reviewed: 2026-08-22
status: proposed
provenance:
  repo: mage-memory
  work: adr-0046-git-and-ratification
sources:
  - decisions/0012-wings-optional-convention-standalone-hubs.md
  - decisions/0013-procedure-skills-self-grooming-loop.md
  - decisions/0030-agent-autonomy-ladder.md
  - decisions/0031-programmatic-provenance-stamp.md
  - decisions/0014-two-gate-redaction.md
  - decisions/0045-cross-environment-presence.md
  - src/grooming/config.ts
  - src/provenance.ts
keywords:
  - branch-and-pr
  - merge-ratification
  - pipeline-memory
  - provenance-channel
  - grooming-config
  - memory-poisoning
  - no-attendance-detection
---

# 0046 — A branch and a pull request are the only way knowledge lands

> **Status: proposed (2026-08-22).** Defines what mage may do with git, how knowledge captured by
> an automated pipeline reaches a knowledge base, and who ratifies it. Amends
> [ADR-0012](0012-wings-optional-convention-standalone-hubs.md),
> [ADR-0013](0013-procedure-skills-self-grooming-loop.md) and
> [ADR-0030](0030-agent-autonomy-ladder.md). Paired with
> [ADR-0045](0045-cross-environment-presence.md).

## Context

An agent reviewing code in an automated workflow learns things worth keeping. Nothing today lets
that reach a knowledge base, because mage's stated invariant was that it never runs git.

That invariant was already inaccurate. `connect` clones a hub when a human says yes, the pre-commit
gate re-stages files during a commit a human started, and mage reads git constantly. None of those
is the thing the invariant existed to prevent, which is an agent landing a commit nobody asked for.
Restating the rule accurately is a precondition for extending it.

Two further questions follow. Knowledge proposed by a pipeline that read an untrusted diff cannot be
trusted the way a human's note is, so something must stand between proposal and adoption. And
whatever that something is, it has to work identically whether or not a person is watching, because
attendance cannot be detected: a hook-invoked command has no terminal even with a human present.

## Decision

### 1. Branch and pull request, always

mage may run git in the repository that holds the knowledge base it is working on. What it may
produce is bounded instead: **a branch and a pull request, and nothing else.**

- It never commits to a default branch.
- It never pushes except as part of that branch.
- It acts only when explicitly invoked, never as a side effect of capture, grooming or a hook.

This replaces "mage never runs git", which was false, and "mage never runs git against a repo you
own", which is also false while the pre-commit gate stages files. The rule now keys on what mage
produces, which is what anyone actually cares about, and it holds in every repository without
carve-outs.

### 2. Both kinds of knowledge base get this

A pipeline proposes into whichever knowledge base the project actually has: an external hub, or the
project's own `mage/` directory in in-repo mode. The mechanism is identical because the safety comes
from the shape of the write, not from which repository it lands in.

In-repo is in fact the cheaper case, since a workflow can already write to its own repository
without any additional credential.

Nothing here weakens [ADR-0045](0045-cross-environment-presence.md) §5: an external-mode project
whose hub is unreachable still refuses, and never redirects its proposals into the code repo.

### 3. Publishing is a flag, not a verb

Turning staged drafts into a pull request is an option on the command that already promotes drafts
into notes. It is the same promotion — through redaction and provenance stamping — with a different
terminal state: instead of leaving notes in the working tree for a human to commit, it puts them on
a branch and opens the pull request.

No new command is introduced. In particular there is no separate verb for committing to a default
branch, because §1 forbids that outcome.

### 4. A merge is the adoption, and the mark stays

The pull request is where a human decides. Merging it is the act of adoption; nothing reaches a
default branch any other way.

This also answers poisoning structurally rather than by inspection. Recall reads the checked-out
default branch, so an unmerged proposal is not merely untrusted, it is invisible. A rule injected
through a malicious diff cannot influence anything until a person merges it.

A note that arrived this way keeps a permanent mark naming the channel it came from and the review
that produced it, written by the deterministic stamper that already records repo and commit at
creation ([ADR-0031](0031-programmatic-provenance-stamp.md)). Pipeline notes carry no authorship
level, so the reject-ledger cohorts are untouched.

### 5. The switch lives with the other knowledge-base settings

Whether mage may open pull requests for a knowledge base is one more field in that knowledge base's
existing grooming configuration, alongside autonomy and sensitivity, read by the same reader that
narrows junk to a safe default. Absent means off.

It is deliberately **not** a rung on the autonomy ladder. The ladder measures how much judgement an
agent may exercise unattended. A pull request adds a human check rather than removing one, so
permitting it is compatible with the strictest rung, and folding it in would force raising an
agent's licence in order to enable a mechanism that increases oversight.

Committing the setting is what lets the owner of a shared hub decline proposals from a project they
do not control.

That committed field is the switch's **only** carrier. No environment variable and no flag may
enable it, and none is needed to. A CI runner already has the knowledge base checked out at its
derived path, and mage reads `grooming` from that checkout, so a hub whose metadata carries
`proposals: true` passes the gate on a runner with nothing set in the environment. Enabling
proposals for a knowledge base is therefore a one-line pull request to that knowledge base, adopted
by the same merge that adopts its notes.

This is worth stating plainly, because the flag is easily mistaken for a security boundary it is
not. Whoever controls a CI job can already push branches and open pull requests with the
credentials that job holds, and can edit the checked-out hub in the runner before mage ever reads
it. The flag does not stop them, and no carrier choice could. Tampering is bounded by credentials
(§4 of [ADR-0045](0045-cross-environment-presence.md)) and by merge ratification (§4 above). What
the committed carrier does buy is consent: a project operator who holds push credentials but whose
hub owner has declined proposals cannot flip that "no" from their own environment. An
environment-settable enable would delete the paragraph above it.

### 6. Attendance is not an input

Nothing consults a terminal, a CI variable or any environment marker to decide whether a git action
is permitted. This follows from [ADR-0045](0045-cross-environment-presence.md) §7 and from §1: once
the outcome is always a pull request a human merges, whether anyone was watching while it ran
changes nothing about the risk. One code path serves a laptop, a runner and a sandbox.

### 7. Bounds on a single run

A run proposes at most one pull request, and a bounded number of notes within it, so a
misbehaving pipeline produces something reviewable rather than a flood. Gate-2 redaction
([ADR-0014](0014-two-gate-redaction.md)) runs over the exact content before it is committed, and a
blocked scan stops the push rather than redacting silently. Documented workflows extract knowledge
from merged changes rather than from open pull requests, and never hold write credentials in a job
that has checked out untrusted content.

## Considered options

- **Committing learned notes directly to a default branch.** Rejected. It removes the human
  decision and makes an injected rule effective immediately.
- **Restricting git to a hub clone only.** Rejected. It excludes in-repo projects, which are the
  ones needing the least credential ceremony, and it keys safety on location when the risk lives in
  the outcome.
- **A separate verb for committing and pushing to a default branch.** Rejected by §1; there is no
  permitted outcome for it to produce.
- **Detecting whether a human is attached.** Rejected. It cannot be detected reliably in either
  direction, and §1 makes it unnecessary.
- **A fourth rung on the autonomy ladder.** Rejected. Git transport and judgement licence are
  different axes; see §5.
- **A timer that adopts a proposal if nobody objects.** Rejected. It converts silence into consent
  and removes the boundary this decision rests on.
- **Storing proposals outside git — a server, or pull request comments.** Rejected per
  [ADR-0001](0001-memory-first-product-supersedes-specshub.md) and
  [ADR-0020](0020-no-server-tiered-dashboards.md); comments are not searchable memory.

## Consequences

- A pipeline can propose knowledge, and no pipeline can adopt it.
- The git invariant is stated in a form that is true of the code as it already exists.
- Both external and in-repo projects are served by one mechanism.
- The command surface does not grow.
- An unmerged proposal is invisible to recall, so poisoning is bounded by the merge decision.
- Notes that came from a pipeline remain identifiable for as long as they exist.

## Relations

- amends [ADR-0012 — A wing is an optional convention; hubs are standalone-first](0012-wings-optional-convention-standalone-hubs.md) (§3 bullet 4: the git invariant restated in terms of outcome)
- amends [ADR-0013 — Procedure skills and the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) (§4: a merge is a confirm, alongside a commit)
- amends [ADR-0030 — Agent autonomy ladder](0030-agent-autonomy-ladder.md) (§3: pipeline proposals sit beside the ladder, not on it)
- rides [ADR-0014 — Two-gate redaction](0014-two-gate-redaction.md) (Gate-2 runs before any commit)
- extends [ADR-0031 — Programmatic provenance stamp](0031-programmatic-provenance-stamp.md) (channel and review recorded at creation)
- bounded_by [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- paired_with [ADR-0047 — Machine bindings leave committed metadata](0047-machine-bindings-leave-committed-metadata.md)
- paired_with [ADR-0045 — Cross-environment presence](0045-cross-environment-presence.md)
