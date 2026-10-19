---
title: The ladder
description: How mage keeps what an agent learns, climbing it to a rule, hook or check where it can and recalling a note at the action where it must.
sidebar:
  order: 1
---

A remembered fact is enforcement debt until something enforces it. mage asks, before a fact is kept as a note, whether a higher rung can carry it. This page is the map; each part links to its own page.

## The rungs

The highest rung that can carry the fix wins. A lower rung is chosen only when every higher one is shown not to apply.

| rung | what carries the fix |
| --- | --- |
| `impossible` | architecture, config or a deny rule makes the mistake unavailable |
| `check` | a lint, test, CI job or pre-commit check fails on it |
| `hook` | a hook blocks or rewrites the call at the moment of the action |
| `rule` | one line in `AGENTS.md` or a skill |
| `note` | a note in `mage/notes/`, recalled at the action |

A note carries `rung`, `trigger` and `pointer` in its frontmatter; see [Admission and triggers](../model/notes.md#admission-and-triggers).

## Where it runs

```mermaid The ladder: a memory write asks the ladder once per session, a note that passes admission is recalled when a tool call matches its trigger, and mage groom walks existing notes up and lands the change by pull request.
flowchart TD
  save["The agent saves a memory"] --> gate["Memory hook: asks the ladder once per session"]
  gate --> note["notes/ — rung, trigger, pointer"]
  note --> idx["mage index — admission and roster"]
  idx --> recall["Recall hook: a tool call matches trigger.match, the note is injected"]
  recall --> work["The agent's next action"]
  note --> groom["mage groom — walks notes up the ladder"]
  groom -->|pull request| higher["a rule, hook or check"]
```

1. **The memory hook** runs when the host saves a memory. By default it asks the ladder once per session: the first write that carries no `rung` is allowed and the ladder, with a template per rung, arrives as context. `ladder.gate: "deny-once"` in `mage/metadata.json` is the opt-in that refuses that write once. A failed secret scan denies in both modes. See [Capture](./capture.md).
2. **Recall at the action** injects an admitted note on PreToolUse when its `trigger.match` globs hit the call, once per session. See [Recall at the action](../model/recall.md).
3. **The Stop hook** runs `mage index --hook`, so a note saved this turn is indexed without anyone typing a command.
4. **`mage groom`** walks existing notes up the ladder and lands each change by pull request. Nothing is committed to your default branch.

## Nothing auto-commits

mage writes files; you commit them. `mage groom` is the one exception, and it can only commit to a branch under `mage/proposal/` and open a pull request, once you turn it on. The judgment calls, such as "is a higher rung possible?", are made by the host agent or by you, never by a model inside mage.

## What was cut

Version 0.0.18 cut the earlier loop of streams, digests, proposals, a ledger and a counting gate. The verbs `distill`, `promote`, `graduate`, `ingest`, `stage`, `dashboard` and `footprint` are signposts that print where their work went. See [ADR-0060](https://github.com/Sumit1993/mage-memory/blob/main/mage/decisions/0060-the-ladder-reset.md).

| Part | Page |
| --- | --- |
| Memory hook and note capture | [Capture](./capture.md) |
| Keeping wing-skill triggers sharp | [Optimize](./optimize.md) |
| Hooks mage wires | [Hooks](../reference/hooks.mdx) |
