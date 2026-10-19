---
title: Capture
description: How a memory gets written as a note, and how the memory hook asks the ladder once per session.
sidebar:
  order: 2
---

Capture is how knowledge becomes a note. There are two doors: the host saving a memory, which the memory hook meets, and you or the agent running `/mage:learn`.

## The memory hook

Claude Code's native memory is pointed at the knowledge base: `mage connect` sets `autoMemoryDirectory` in the settings file it wires, so a memory the host saves lands under `mage/`, where this hook sees it first (Gate-0, ahead of the file reaching disk).

`mage memory-hook` is a PreToolUse hook on Write and Edit, wired by `mage connect` when Claude Code auto-memory is on and a docs root resolves. It scrubs the write for secrets and applies three rules:

- **The ladder, once.** The first memory write of a session, at the root or under `notes/`, that carries no `rung` is allowed, and the ladder with a template per rung is attached as context. Every later write passes, and a write carrying `rung` always passes. This is `ladder.gate: "ask"`, the default.
- **`deny-once`, opt in.** `ladder.gate: "deny-once"` in `mage/metadata.json` refuses that first write once, with a reply that ends in a retry. See [Admission and triggers](../model/notes.md#admission-and-triggers).
- **Regenerated files are refused.** A write to `INDEX.md`, `MEMORY.md` or `_index.*.md` is denied with a redirect to its own file under `mage/notes/`, because `mage index` regenerates them.

A failed secret scan denies the write in both modes. The state is keyed by `session_id`, so subagents that share their parent's `session_id` share it.

## `/mage:learn`

The `/mage:learn` skill drafts a finished note (insight, procedure, pointers) and writes it after you confirm. See [Install and Quickstart](../start/quickstart.md). The note needs `rung`, `trigger` and `pointer` to be admitted for recall.

## After the write

A Stop hook runs `mage index --hook`. It re-indexes only when a note changed, quietly and without blocking. A note that passes admission is then recalled when a tool call matches its `trigger.match`; see [Recall at the action](../model/recall.md).

## Fail-open, except secrets

The hooks never break a session. A malformed payload, an unreadable file or a missing knowledge base resolves to a clean exit. Redaction is the opposite: if the redactor fails on a field, the write is denied rather than leaked. See [Redaction](../reference/redaction.md).

The earlier passive trail written by `mage observe` is cut from the surface (ADR-0060); its code stays until #223.
