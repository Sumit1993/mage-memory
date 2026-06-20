---
title: What is mage?
description: Durable, self-maintaining memory for AI coding agents — portable git-backed markdown notes you own, navigable as an Obsidian graph.
sidebar:
  order: 1
---

mage is durable memory for AI coding agents. It is a portable, file-based, git-backed knowledge base of **notes** that any AI coding agent can read — and that grooms itself from your sessions, so the knowledge gets better the more you work.

The name is short for **M**emory for **AGE**nts.

## The problem it solves

The hard-won knowledge about a software system never lives in one place. What an interface expects, why a decision was made, how two services connect, the exact way to call them, the gotcha that cost you an afternoon — it scatters across in-repo `docs/`, out-of-repo wikis, ticket comments, and an agent's transient chat history. Then it gets rewritten, cleaned up, or simply lost the moment the task is done.

mage gives that knowledge one durable, portable, discoverable home.

## What a note is

A **note** is a single markdown file about one thing. It records three things, and never more:

- **Insight** — the reusable fact, verbatim. The thing you learned.
- **Procedure** — how to do it faster next time, and which commands to avoid and why.
- **Pointers** — where the canonical source lives and when to go read it.

A note is never a copy of a source. The goal is to do the work faster and make fewer mistakes next time, not to archive something you already read. A pointer to `src/charge.ts:40` is worth more than a pasted snippet that drifts the moment the code changes.

Notes link to each other with ordinary relative markdown links — `[text](path.md)`, never `[[wikilinks]]` — so the same files render as a navigable [Obsidian graph](model/graph.md) and stay readable by any agent grepping the raw text.

## Who it is for

mage is for anyone working with an AI coding agent on a real codebase: you and your agent both read and write the same notes. The agent loads an always-current index to know what exists, opens only the notes a task touches, and captures durable lessons as it goes. You stay in the loop — mage proposes, you confirm, and **you** commit.

## Why it is different

mage was designed by mining the *idea* behind server-backed agent-memory tools — durable memory that outlives a session — not their mechanism. The contrast is deliberate:

- **Files you own.** Every note is plain markdown in *your* git repo. No database, no export step — `cat`, `grep`, and `git log` all work. Your agent's own grep is the search engine.
- **No server.** Nothing to host, no daemon, no background process. mage rides the host agent's hooks; the dashboard is a generated file, not a service.
- **No telemetry.** Nothing leaves your machine. mage never phones home; metrics stay local and never enter git.
- **No vector database.** No embeddings to build, no index to keep in sync. Retrieval is the index plus your agent reading files.
- **Human-in-the-loop.** mage *proposes* — draft a note, graduate a skill, reword a trigger — and **you** confirm and commit. Nothing is ever auto-committed.

## Memory that grooms itself

mage does not just store what you tell it. As you work, it quietly captures what your agent actually does, then helps turn the recurring, durable lessons into notes — and proven procedures into loadable agent skills. Two paths feed this loop:

- The **organic path** drafts a short lesson the moment something worth remembering happens — when you trigger it deliberately with the `mage:learn` skill, and automatically right after a chat compaction, so insight is not lost at the context boundary.
- The **recurrence path** waits for a pattern to recur across several stretches of work before proposing a new note, and for a proven procedure to recur further before graduating it into its own skill.

Both end the same way: a proposal you review, accept, and commit. See [The grooming loop](loop/overview.md) for the whole picture.

## Where to go next

- New here? Start with [Install and Quickstart](start/quickstart.md) — install the CLI and create your first knowledge base.
- Want the concepts first? Read [The model](model/notes.md): notes, the graph, and the storage modes.
- Curious how it learns from your sessions? See [The grooming loop](loop/overview.md).
