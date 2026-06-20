---
title: The boundary nudge
description: The post-compaction hook that distills the closed chapter and drafts the lessons you forgot to capture.
sidebar:
  order: 3
---

Inline capture is the primary lesson path: as you work, the agent stages a lesson the first time something is worth remembering. But agents forget. The **boundary nudge** is the safety-net for what inline capture missed. It is the command `mage nudge`, and it fires once per chapter, right after your host compacts the conversation.

## When it fires, and why exactly then

The nudge is wired to the **SessionStart** hook. But not every SessionStart acts — it gates on the start `source` being `"compact"`. On a normal startup, a resume, or a `/clear`, it is a fast no-op (nothing closed to reflect on). Only a post-compaction start does the work.

Compaction is the moment a chapter closes: the host summarizes the conversation to free up context, and the detail of the last stretch of work is about to be lost. That is exactly when mage wants to capture forgotten lessons. So why `SessionStart(compact)` and not an earlier hook?

- **PreCompact** fires *before* the chapter closes — the scratch is not yet complete, so there is nothing whole to distill.
- **SessionEnd** can run, but its stdout is **not** injected as context (the session is ending), so it has no way to surface a nudge to the agent.
- **SessionStart with `source: "compact"`** fires *right after* compaction. It is the only boundary where the captured scratch for the chapter is complete *and* the hook's stdout becomes the new session's context.

That is why the nudge lives where it does. (Verified against the Claude Code hook contract and recorded in mage's decision records ADR-0024 and ADR-0009 §24.)

## What it does

On a `source: "compact"` start, `mage nudge`:

1. **Distills the just-closed chapter** from the captured scratch (`.mage/learnings/`).
2. **Drafts up to the staging budget of forgotten lessons** into `.mage/staging/` — the same git-ignored staging area `mage stage` writes to. Each draft is re-scrubbed for secrets before it hits disk. At most three drafts are written per pass (the staging budget), and dedup means a chapter re-offered on every compaction is drafted at most once.
3. **Surfaces a one-line nudge** to the agent via `additionalContext`, pointing it at the `mage:groom` skill.

It is **fail-open**: any error is swallowed and the command exits cleanly. A boundary nudge must never break your session start.

A subtle but important detail: the nudge does **not** advance the distill watermark. It only writes drafts. Dedup (against your committed notes, the existing staged batch, and the reject ledger) plus a stable per-cluster slug is what keeps a re-offered chapter from being drafted twice.

## What you see

When the nudge drafts something, the next session starts with a one-line context message. With a fresh batch it looks like:

```text
mage: drafted 2 lessons from the last chapter (2 pending) — review with `mage:groom`.
```

If nothing new was drafted but staged drafts are still waiting, it reminds you instead (at most once every four hours, so it never nags):

```text
mage: 3 lesson drafts pending in .mage/staging/ — review with `mage:groom`.
```

When there is nothing drafted and nothing pending, it stays silent.

## Where it leads

The nudge only **stages** drafts; it never writes a note or commits anything. The drafts sit in `.mage/staging/` until you review them with the `mage:groom` skill — accepting the keepers into `notes/` and rejecting the rest. That review step is the next page: [Stage and groom](./stage-groom.md).
