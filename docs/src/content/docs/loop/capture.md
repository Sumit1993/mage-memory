---
title: Capture (observe)
description: How mage captures session signal into the git-ignored learnings scratch without ever blocking your work.
sidebar:
  order: 2
---

Capture is the first stage of the loop. It is how mage builds up the raw material that everything else distills, promotes, and grooms. It is passive: you never type a capture command. Your coding host fires hooks as you work, and each one runs `mage observe`, which appends a single event to a git-ignored scratch directory.

This passive seam is distinct from the *deliberate* capture you trigger on the spot: the `mage:learn` skill, which drafts a finished note for you (insight, procedure, pointers) and writes it after you confirm. See [Install and Quickstart](../start/quickstart.md) for `mage:learn`; the rest of this page is the passive `mage observe` seam that feeds the loop.

## What `mage observe` is

`mage observe` is a hook-fired capture seam. It reads one Claude Code hook payload on stdin, maps it to one structured event, scrubs the free-text fields for secrets, and appends it to `.mage/learnings/` — the observed scratch. It is a plumbing command: you do not run it by hand, the hooks run it for you (see how to wire those in [Install and quickstart](../start/quickstart.md), via `mage connect`).

The scratch is **git-ignored** and auto-pruned. It is not knowledge yet — it is the deterministic trail of what happened, the substrate the later stages read.

## It never blocks your work

This is the load-bearing property of capture. `mage observe` is **fail-open**: every path resolves to a clean exit, so a malformed payload, an unreadable scratch, a missing knowledge base, or any filesystem error silently does nothing rather than breaking your session. If there is no knowledge base under the working directory, it writes nothing at all. Capture is meant to be invisible — it should never be the reason a tool call or a session start hangs.

Secret-scrubbing runs the other way: if the redactor itself throws on a field, that field degrades to a sentinel rather than leaking the raw value. Capture fails open; redaction fails closed.

## What each hook captures

mage wires several hooks, each firing `mage observe` at a different moment, so the scratch carries a complete trail of a chapter. The events it records:

- **SessionStart** — the session-start context (harness, working directory, mage version, and the start `source`).
- **UserPromptSubmit** — the intent of each prompt you submit.
- **PostToolUse** — each tool use: which tool ran, which files it touched, and whether a Skill loaded.
- **PostToolUseFailure** — tool failures, captured as a distinct, high-value signal (an error followed by the fix that worked is exactly the kind of gotcha worth a note).
- **PreCompact** — a marker for the chapter boundary, written just before the host compacts.
- **SessionEnd** — the session ending.
- **Stop** — the agent's final reply (read from the transcript).
- **SubagentStop** — an autonomous subagent's final reply; this is the one capture point for multi-agent work, since a subagent's tool calls never reach the main session's hooks.

A separate hook, `mage:metrics:Stop`, is not capture — it rolls up context-match (did the skills that auto-loaded match the work?). That feeds [Optimize](./optimize.md), not the scratch.

For the exact event names, hook ids, and the command each runs, see the [Hooks reference](../reference/hooks.mdx).

## What happens to the scratch

Capture only writes the trail. The later stages read it:

- The **boundary nudge** distills the just-closed chapter from the scratch and drafts forgotten lessons. See [The boundary nudge](./nudge.md).
- **Distill** and **promote** read closed chapters of the scratch to surface first-sight insights and recurring patterns. See [Promote and graduate](./promote-graduate.md).

Capture is the only stage that runs automatically on every event. Everything downstream is gated on a chapter closing and on your confirmation.
