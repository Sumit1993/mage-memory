---
title: Recall at the action
description: How a note reaches the agent at the moment it matters, instead of waiting to be read.
sidebar:
  order: 2
---

Most notes are never opened. The index lists them, and an agent reads the index and moves on. Recall at the action fixes the timing: a note that says when it matters is put in front of the agent when a tool call matches that moment.

It is a PreToolUse hook, `mage recall-hook`, that `mage connect` wires. It adds context. It never blocks a call and never decides permission.

## Four parts

1. **Frontmatter.** The note carries `rung`, a `trigger` with a `when` and a `match` list, and a `pointer`. The fields are in [Admission and triggers](./notes.md#admission-and-triggers).
2. **Index admission.** `mage index` checks every memory note and prints how many are admitted and how many carry a valid `match`. A note that fails admission stays in the index and the roster; it is only ineligible for recall.
3. **Matcher.** On each Bash, Write, Edit, MultiEdit or NotebookEdit call the hook tests the command or file path against each admitted note's `match` globs. Read, Grep, Glob and Task never run it.
4. **De-dup.** A note is injected once per session. The state is a small file under `.mage/recall/`, and a compaction clears it so the note can come back. The state is keyed by `session_id`, so subagents that share their parent's `session_id` share it too.

The caps (notes per call, bytes per call, bytes per body, time budget) are the `RECALL_LIMITS` constant in `src/adapters/claude-code/recall-hook.ts`. A note that would push past the byte cap is skipped and not marked as injected, so it is offered on a later call.

## A run from end to end

This transcript is a real run of the built CLI in a scratch knowledge base with three notes. The first note is the one that matches.

<!-- Captured from a real run. Redo it when the output text in recall-hook.ts or RECALL_LIMITS changes (#282). -->

```console
$ cat mage/notes/npx-mage-runs-the-published-release.md
---
type: gotcha
created: 2026-10-20
rung: note
trigger:
  when: "deciding which mage binary a verify command runs"
  match: ["Bash(npx mage *)", "Edit(package.json)"]
pointer: "[#282](https://github.com/Sumit1993/mage-memory/issues/282)"
---
# npx mage runs the published release

`npx mage` fetches the release from npm, not this checkout. Verify with `node dist/cli.js`.

$ mage index
✓ Indexed 3 note(s) across 0 wing(s) → 2 file(s) (flat).
Roster: 3 of 3 notes admitted; 2 recalled at the action.

$ echo "$CALL" | mage recall-hook --explain
recall: Bash "npx mage index"
  skip   notes/changeset-packages.md                   Edit(.changeset/**)
  match  notes/npx-mage-runs-the-published-release.md  Bash(npx mage *)
  1 admitted note(s) have no trigger.match
would inject 1 note(s), 384 bytes

$ echo "$CALL" | mage recall-hook
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"mage recall: 1 note(s) for this Bash call.\n\n## npx mage runs the published release (notes/npx-mage-runs-the-published-release.md)\nwhen: deciding which mage binary a verify command runs\npointer: [#282](https://github.com/Sumit1993/mage-memory/issues/282)\n# npx mage runs the published release\n\n`npx mage` fetches the release from npm, not this checkout. Verify with `node dist/cli.js`."}}

$ echo "$CALL" | mage recall-hook
$
```

`$CALL` is the hook JSON Claude Code sends on stdin: `{"hook_event_name":"PreToolUse","session_id":"demo","tool_name":"Bash","tool_input":{"command":"npx mage index"},"cwd":"…"}`. The `prose-only` note in that knowledge base has a plain-text trigger, so it is on the roster and never matched. The last call prints nothing because the note was already injected in session `demo`.

`--explain` reads and writes no state, so it can be run any number of times while you tune a pattern. It reads the same call JSON on stdin.

## What it will not do

- It does not recall decisions. They stay in `decisions/`, read before architectural changes.
- It does not match regex. Matchers are globs, so a pattern cannot be made to run long on a per-call path.
- It does not fail a call. Any error, a missing knowledge base, bad input or an overrun of the time budget produces no output and exit 0.

The decision behind it is ADR-0060, [The ladder reset](https://github.com/Sumit1993/mage-memory/blob/main/mage/decisions/0060-the-ladder-reset.md).
