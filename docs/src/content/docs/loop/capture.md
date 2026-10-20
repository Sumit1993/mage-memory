---
title: Capture
description: How a memory gets written as a note, and how the memory hook asks the ladder once per session and agent, and keeps what it denies.
sidebar:
  order: 2
---

Capture is how knowledge becomes a note. There are two doors: the host saving a memory, which the memory hook meets, and you or the agent running `/mage:learn`.

## The memory hook

Claude Code's native memory is pointed at the knowledge base: `mage connect` sets `autoMemoryDirectory` in the settings file it wires, so a memory the host saves lands under `mage/`, where this hook sees it first (Gate-0, ahead of the file reaching disk).

`mage memory-hook` is a PreToolUse hook on Write and Edit, wired by `mage connect` when Claude Code auto-memory is on and a docs root resolves. It scrubs the write for secrets and applies three rules:

- **The ladder, once.** The first memory write of a session, at the root or under `notes/`, that carries no `rung` is denied once, with a reply that ends in a retry and names where mage kept a copy. Every later write passes, and a write carrying `rung` always passes. This is `ladder.gate: "deny-once"`, the default.
- **A copy is kept.** Before the deny, the hook writes the redacted content of the write (for an Edit, the file as it would read after the edit) to `notes/.held/<session>[-<agent>]-<slug>.md`. If that copy cannot be written, the hook does not deny: it falls back to `ask`, allowing the write and attaching the ladder as context. Nothing is lost either way.
- **`ask`, opt in.** `ladder.gate: "ask"` in `mage/metadata.json` allows the first write and attaches the ladder as context instead. See [Admission and triggers](../model/notes.md#admission-and-triggers).
- **Regenerated files are refused.** A write to `INDEX.md`, `MEMORY.md` or `_index.*.md` is denied with a redirect to its own file under `mage/notes/`, because `mage index` regenerates them.

A failed secret scan denies the write in both modes. The ladder is asked once per `session_id` and per agent: Claude Code adds an `agent_id` to the hook input inside a subagent, so the parent and each subagent are asked once. The main agent has no `agent_id`.

## Held writes

`notes/.held/` is not a note directory. `mage index` and the roster never list it, and `mage groom` lists each file in it first, tagged `[held]`, so you can climb it, file it as a note, or delete it. Held files are committed like any note, and the secret scan covers them. When a session ends with files still held, the Stop hook prints one line naming them. It never blocks.

A worked run, captured from the built CLI in a throwaway repo (paths shortened to `<repo>`):

```text
$ # the agent saves a memory with no rung: PreToolUse -> mage memory-hook
permissionDecision: deny
permissionDecisionReason:
  Not saved yet — mage asks this once per session; your next memory write will be accepted.
  1. For each lesson, pick the highest rung that can carry it (templates below).
  2. Build the rung 1-4 artifacts now.
  3. Retry this write with only the rung-5 lessons, each as its own file under mage/notes/<slug>.md ...
  mage kept a copy of this write at <repo>/mage/notes/.held/abc123-no-em-dashes.md; delete it once its lessons are climbed or re-filed.
  1 impossible: a deny rule in .claude/settings.json
  ...

$ cat mage/notes/.held/abc123-no-em-dashes.md
---
name: no-em-dashes
description: Do not use em dashes in commit messages.
---
# No em dashes

Contact [REDACTED:email] if the commit hook rejects one.

$ # the agent retries: the marker for (abc123, main agent) exists, so the write passes
permissionDecision: allow   # scrubbed 1 secret/PII value(s) before this memory reached disk

$ # the agent stops with the held file still there: Stop -> mage nudge
mage · 1 lesson(s) held, not filed: <repo>/mage/notes/.held/abc123-no-em-dashes.md. Climb or re-file them, or run mage groom.

$ mage groom
mage groom: 1 of 1 notes to judge (notes without a rung come first).
  1. [held] notes/.held/abc123-no-em-dashes.md  "No em dashes"  rung: -  trigger: -  pointer: -
For each note: climb (build the rung below, then delete the note), delete (stale, or a copy of a source),
or keep (add rung, trigger and pointer). mage never commits: land the whole diff as one pull request.
[held] notes are writes the ladder denied once: climb them, move them to notes/<slug>.md with rung, trigger and pointer, or delete them.
```

The retry saved the note, so the held copy is now a duplicate: delete it, or climb the lesson to a higher rung and delete both.

## `/mage:learn`

The `/mage:learn` skill drafts a finished note (insight, procedure, pointers) and writes it after you confirm. See [Install and Quickstart](../start/quickstart.md). The note needs `rung`, `trigger` and `pointer` to be admitted for recall.

## After the write

Two Stop hooks run. `mage index --hook` re-indexes only when a note changed, quietly and without blocking. `mage nudge` prints the session receipt and, if this session still has held writes, the one line that names them. A note that passes admission is then recalled when a tool call matches its `trigger.match`; see [Recall at the action](../model/recall.md).

## Fail-open, except secrets

The hooks never break a session. A malformed payload, an unreadable file or a missing knowledge base resolves to a clean exit. Redaction is the opposite: if the redactor fails on a field, the write is denied rather than leaked. See [Redaction](../reference/redaction.md).

The earlier passive trail written by `mage observe` is cut from the surface (ADR-0060); its code stays until #223.
