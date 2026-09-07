---
title: The boundary nudge
description: How mage provides feedback on session boundaries, moving the session receipt to Stop while keeping SessionStart quiet.
sidebar:
  order: 3
---

Inline capture records lessons as you work. The **boundary nudge** is the command `mage nudge`, which runs at host lifecycle boundaries to provide visibility without interrupting flow.

The nudge **writes nothing**. It is a read-only command that inspects current session events and surfaces feedback when warranted.

## When it fires

The boundary nudge is wired to two hooks in Claude Code:

- **Stop** (`mage:nudge:Stop`): Fires when Claude finishes a turn or stops. It tallies session activity and prints a one-line session receipt.
- **SessionStart** (`mage:nudge:SessionStart`): Fires when a session starts, resumes, or restarts after compaction.

## The Stop session receipt

At the `Stop` boundary, `mage nudge` reads the session events recorded in the capture scratch. It aggregates four key signals:

- `denied`: Actions blocked by guards (counted from `guard_fired` events).
- `corrected`: Substantive user corrections following assistant messages or tool use.
- `new signatures`: Distinct failure signatures observed in the current session.
- `guard fires`: Total guard events recorded for this session.

The receipt is formatted as a single concise line:

```text
mage: <N> denied · <N> corrected · <N> new signatures · <N> guard fires
```

If all four counts are zero, or if the directory lacks a knowledge base, `mage nudge` remains completely silent and exits with status 0. It never clutters sessions that ran without issue.

## Quiet SessionStart

Earlier versions printed backlog tallies, keep rates, or chapter digests whenever a session started. In everyday practice, greeting the user with backlogs on launch produced unnecessary noise.

SessionStart is now quiet by default. It prints output only when actionable items require attention:

- **Waiting proposals**: When graduation proposals are ready for review, it prints:
  `mage · 1 proposal is waiting` (or plural: `mage · 2 proposals are waiting`).
- **Degraded hub connectivity**: If a connected hub repository is unreachable or grants are invalid, it prints a single status warning.

If no proposals are waiting and connectivity checks pass, SessionStart outputs nothing.

## Worked terminal transcript

Here is an example transcript showing a session where a guard blocked an action:

```text
$ claude
# Starting Claude Code session...

> Run git push origin main --force
# Guard intercepts the dangerous command

mage: 1 denied · 0 corrected · 0 new signatures · 1 guard fires
```

When a session finishes with zero denied actions, zero corrections, zero new signatures, and zero guard fires, the receipt produces no output:

```text
$ claude
# Starting Claude Code session...

> Read the README
# Task finishes cleanly

$
```

## Fail-open design

The boundary nudge is fail-open. Any file system error or parsing exception is caught cleanly, allowing the process to exit with code 0 without disrupting host operations.
