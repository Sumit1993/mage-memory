---
title: The boundary nudge
description: The chapter-boundary hook that hands the host agent a read-only digest of the just-closed chapter plus the autonomy-scaled grooming backlog — it writes nothing itself.
sidebar:
  order: 3
---

Inline capture is the primary lesson path: as you work, the agent stages a lesson the first time something is worth remembering. But agents forget. The **boundary nudge** is the safety-net for what inline capture missed. It is the command `mage nudge`, and it fires at the chapter boundary, surfacing what the chapter left behind so the host agent can mine it.

The nudge **writes nothing**. It is a read-only artifact injected into your host agent's session ([ADR-0029](https://github.com/Sumit1993/mage-memory/blob/main/mage/decisions/0029-digest-to-agent-capture.md)): mage narrows and templates, the host agent judges and writes, your `git commit` confirms. The engine never calls a model and never stages a draft of its own — the agent does that with `mage stage` when it recognizes a lesson.

## When it fires

The nudge is wired to the **SessionStart** hook, and it acts on three sources: `compact`, `startup`, and `resume`. Only `/clear` is a fast no-op — there is nothing to reflect on. The two halves of the nudge fire differently:

- The **fresh-chapter digest** is rendered only on `compact`, because that is the only source where a chapter just closed. A `startup` or `resume` carries no fresh chapter, so it rides the backlog reminder alone.
- The **backlog mandate** can fire on any of the three sources (throttled — see below).

Why `SessionStart` and not an earlier hook for the digest?

- **PreCompact** fires *before* the chapter closes — the scratch is not yet complete, so there is nothing whole to distill.
- **SessionEnd** can run, but its stdout is **not** injected as context (the session is ending), so it has no way to surface a nudge to the agent.
- **SessionStart with `source: "compact"`** fires *right after* compaction. It is the only boundary where the captured scratch for the chapter is complete *and* the hook's stdout becomes the new session's context.

That is why the nudge lives where it does. (Verified against the Claude Code hook contract and recorded in mage's decision records ADR-0029, ADR-0030, and ADR-0009 §24.)

## What it does

On a firing source, `mage nudge` composes up to two parts and emits them as `additionalContext`. It never advances the distill watermark and never writes a draft.

### 1. The fresh-chapter digest (compact only)

On a `source: "compact"` start, mage reads the just-closed chapter from the captured scratch (`.mage/learnings/`) and renders an **earned-signal inventory** — the failures, external commands, and corrections it observed, in the order they happened. The artifact is explicitly framed as *raw material, not lessons*: mage is not claiming any line is worth keeping, and most are noise. The host agent reads it, recognizes any durable lesson, and captures it with `mage stage`. The digest is never throttled — each compact closes new content.

### 2. The autonomy-scaled backlog mandate

At every firing source mage also surfaces a deterministic, capped **backlog tally** — a single line that always leads:

```text
mage: 3 staged · 6 chapters unmined · up to 1 eligible to graduate → mage:groom
```

The three parts are: staged drafts waiting in `.mage/staging/`, closed chapters not yet mined, and an upper bound on graduation-eligible signatures (a count, not an exact proposal). Below that line, mage templates a **mandate** scaled to this KB's [autonomy level](./autonomy.md):

- **Operator** (default) — a plain reminder, no autonomous-write authorization: `Review with mage:groom (autonomy: operator).`
- **Approver** — authorizes the agent to run `mage:groom` and write the clearly-durable notes into the working tree, uncommitted, leaving borderline drafts staged.
- **Overseer** — authorizes the full ladder: write durable notes, merge related lessons into existing notes, dispose the borderline tier, and graduate eligible notes — all uncommitted.

See [Autonomy levels](./autonomy.md) for the exact mandate wording at each level and the one invariant that holds at all three: nothing is durable until **you** `git commit` ([ADR-0030](https://github.com/Sumit1993/mage-memory/blob/main/mage/decisions/0030-agent-autonomy-ladder.md)).

## It is fail-open and never nags

The command is **fail-open**: any error is swallowed and it exits cleanly. A boundary nudge must never break your session start.

The backlog reminder is **throttled** — it surfaces at most once per window (default 4 hours; set `grooming.nudgeThrottleHours` in `metadata.json` to change it). The backlog scan is also mtime-gated: a no-new-scratch startup reuses the cached counts, so it stays near-instant. The fresh-chapter digest is *not* throttled — there is new content to inventory after every compaction.

When there is no fresh chapter and no backlog to report, the nudge stays silent.

## Where it leads

The nudge surfaces work; it never writes a note or commits anything. What happens next depends on your autonomy level: at Operator you mine the digest and drain the backlog by hand with the [`mage:groom`](./stage-groom.md) skill; at Approver and Overseer the host agent acts on the mandate during the session, writing uncommitted changes you then review and commit. Either way, the review step is the next page: [Stage and groom](./stage-groom.md).
