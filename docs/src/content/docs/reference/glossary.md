---
title: Glossary
description: One-line definitions for every mage term, with a link to where each is explained in full.
sidebar:
  order: 6
---

Every mage term in one place. Each links to the page where it is explained in full.

| Term | Meaning |
|---|---|
| **memory** | what your agent remembers across sessions. In mage, **a memory *is* a note** — there is no separate store. mage is the agent's memory, made durable, curated, portable, and shareable. See [The ladder](../loop/overview.md). |
| **note** | one such memory: a committed markdown unit of *hard-earned knowledge* under `notes/` — insight + procedure + pointers, never a copy of a source (not a fact you can re-derive in seconds). See [Notes](../model/notes.md). |
| **wing / room** | how the index is organised: a **wing** is a top-level grouping (by tag); a **room** is a sub-group within a wing. See [The graph](../model/graph.md). |
| **rung** | where a fix sits on the ladder: `impossible`, `check`, `hook`, `rule` or `note`. See [The ladder](../loop/overview.md). |
| **recall at the action** | a PreToolUse hook injects an admitted note when a tool call matches its `trigger.match`. See [Recall at the action](../model/recall.md). |
| **INDEX.md / MEMORY.md** | the two generated recall surfaces. `INDEX.md` is the full, portable index of every memory note. `MEMORY.md` is the file Claude Code's auto-load looks for, and it is a **bounded roster** rather than a copy: the governance line, the top-ranked entries that fit the host's budget, then one overflow line pointing back at `INDEX.md` for the rest. See [The graph](../model/graph.md). |
| **hub / project** | a **hub** is a shared knowledge base; a **project** is one repo's slice of it, at `<hub>/projects/<name>/`. See [Modes and storage](../model/modes.md). |
| **hub_repo** | the hub's git remote, recorded in a code repo's `metadata.json` as the *authoritative* address (ADR-0043) — a hub's local clone is **derived** from it, never itself recorded. See [Where a hub actually lives](../model/modes.md#where-a-hub-actually-lives--derived-not-recorded). |
| **in-repo / external / hybrid** | the three storage modes = where a repo's notes live: in the repo · in the hub · in the repo but registered to a hub. See [Modes and storage](../model/modes.md). |
| **redaction gates** | secrets are scrubbed before they can persist: when the memory hook sees a write, and again at `git commit` (the two gates). Secrets block; PII warns. See [Redaction](./redaction.md). |

For the verbs and skills themselves, see [Commands](./commands.mdx); for the ladder those terms hang on, see [The ladder](../loop/overview.md).
