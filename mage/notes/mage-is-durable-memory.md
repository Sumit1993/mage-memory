---
type: principle
tags: [mage/design]
created: "2026-06-28"
updated: "2026-06-28"
last_reviewed: "2026-06-28"
status: active
provenance:
  repo: mage-memory
  work: capstone-unified-durable-memory
keywords: [charter, identity, unified-memory, durable, portable, notes-are-memories, hard-earned-knowledge, insight, procedure, gotcha, decision, pointer, one-store, what-is-mage]
---

# mage is one durable memory — of hard-earned knowledge

The charter, in one sentence: **mage is a single, unified, durable, portable memory store for an AI
coding agent — and the memory it keeps is not transient facts but *hard-earned knowledge*: insight,
procedure, gotchas, decisions, and pointers.**

Read this before any work that touches capture, recall, the host adapter, or the note schema. Every
such decision is downstream of it.

## The two things people get wrong

1. **"mage is a knowledge base *separate from* the agent's memory."** No. **A note is a memory.** What
   an agent chooses to remember across sessions — a lesson, a convention, a gotcha, a decision — *is*
   exactly a mage note. The host harness can't even tell them apart (Claude Code stamps an authored
   ADR `node_type: memory` the moment you write it). So the agent's native memory and mage's notes are
   **one store**, not two to bridge. mage doesn't replace or redirect the agent's memory; it **is** the
   agent's memory, made durable. (See [0035 — notes are memories](../decisions/0035-decouple-harness-memory-from-notes.md);
   sharpens [0005 — one canonical memory](../decisions/0005-one-canonical-memory-others-are-feeders.md).)

2. **"mage remembers everything."** No. mage keeps **hard-earned knowledge**, never copies of sources
   ([0004 — insight, procedure, pointers, not copies](../decisions/0004-capture-insight-not-copies.md)).
   A fact you can re-derive in seconds isn't worth a note; a gotcha that cost you an afternoon is. The
   note types (interface · playbook · gotcha · pointer · decision · principle · …) name the *kinds* of
   hard-earned knowledge worth keeping.

## What mage adds to "memory"

A raw harness memory is machine-local, single-tool, uncurated, and disposable. mage turns the same
content into real memory by adding the four things it lacks:

- **Durable** — it lives in git, not a per-machine scratch dir. It survives the session, the machine,
  and the tool.
- **Curated** — `groom` dedupes, links, assigns wings, and enforces never-a-copy. Memory stays signal,
  not sludge.
- **Portable** — one neutral, flat, Obsidian/grep-readable schema ([0008](../decisions/0008-visible-mage-dir-for-obsidian.md)),
  so it reads the same in any tool. The host's format is met only at the edges (recall index + capture
  intake), never baked into the durable notes ([0035](../decisions/0035-decouple-harness-memory-from-notes.md)).
- **Shared** — a team on mixed harnesses, or one person across several, all read and grow the same store.

## How the pieces serve the charter

- **Capture / write** — a memory the agent forms becomes a note in the one store ([0032](../decisions/0032-capture-redirect-native-memory.md)).
- **Recall** — mage emits the index the host auto-loads, pointing back at the notes ([0033](../decisions/0033-recall-import-bounded-index.md)).
- **Adopt** — pre-existing memories (a foreign tool's, a teammate's notes) are folded into the one store ([0034](../decisions/0034-adopt-preexisting-knowledge.md)).
- **Format** — the host owns the working-tree shape; mage normalizes to the neutral schema at the durable boundary ([0035](../decisions/0035-decouple-harness-memory-from-notes.md)).

## Relations

- realized_by [0035 — notes are memories: one unified store](../decisions/0035-decouple-harness-memory-from-notes.md)
- sharpens [0005 — one canonical memory, others are feeders](../decisions/0005-one-canonical-memory-others-are-feeders.md)
- grounded_in [0004 — capture insight, procedure, pointers — not copies](../decisions/0004-capture-insight-not-copies.md)
- see_also [mage — context & glossary](context.md)
