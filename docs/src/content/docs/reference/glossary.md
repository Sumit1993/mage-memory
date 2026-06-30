---
title: Glossary
description: One-line definitions for every mage term, with a link to where each is explained in full.
sidebar:
  order: 6
---

Every mage term in one place. Each links to the page where it is explained in full.

| Term | Meaning |
|---|---|
| **memory** | what your agent remembers across sessions. In mage, **a memory *is* a note** — there is no separate store. mage is the agent's memory, made durable, curated, portable, and shareable. See [The loop](../loop/overview.md). |
| **note** | one such memory: a committed markdown unit of *hard-earned knowledge* under `notes/` — insight + procedure + pointers, never a copy of a source (not a fact you can re-derive in seconds). See [Notes](../model/notes.md). |
| **compact-chapter** | one stretch of work between context compactions. mage counts *chapters*, not session ids — so one long, continuously-compacted chat still accrues recurrence. See [Promote and graduate](../loop/promote-graduate.md). |
| **wing / room** | how the index is organised: a **wing** is a top-level grouping (by tag); a **room** is a sub-group within a wing. See [The graph](../model/graph.md). |
| **learnings** (`.mage/learnings/`) | the raw, auto-pruned trail of session events — git-ignored, not knowledge yet. See [Capture](../loop/capture.md) and [The .mage/ layout](./layout.md). |
| **staging** (`.mage/staging/`) | drafts awaiting your accept/reject — scrubbed and deduped, git-ignored. See [Stage and groom](../loop/stage-groom.md). |
| **INDEX.md / MEMORY.md** | the generated recall index. `MEMORY.md` is the Claude-Code-named twin of the portable `INDEX.md` — identical content, a host-specific filename the auto-load looks for. See [The graph](../model/graph.md). |
| **hub / project** | a **hub** is a shared knowledge base; a **project** is one repo's slice of it, at `<hub>/projects/<name>/`. See [Modes and storage](../model/modes.md). |
| **in-repo / external / hybrid** | the three storage modes = where a repo's notes live: in the repo · in the hub · in the repo but registered to a hub. See [Modes and storage](../model/modes.md). |
| **K / M** | recurrence gates: a pattern becomes a note candidate after **K** chapters; a proven procedural note graduates to a skill after **M**. One sensitivity dial scales both. See [Thresholds and the dial](./thresholds.mdx). |
| **redaction gates** | secrets are scrubbed before they can persist — at `stage` and again at `git commit` (the two gates); on Claude Code a capture-time scrub (**Gate-0**) is added too. Secrets block; PII warns. See [Redaction](./redaction.md). |
| **autonomy ladder** | how much grooming the agent may do unattended: *operator* (propose only) → *approver* (write notes) → *overseer* (write + graduate). Set per knowledge base. See [Autonomy levels](../loop/autonomy.mdx). |

For the verbs and skills themselves, see [Commands](./commands.mdx); for the loop those terms move through, see [The self-grooming loop](../loop/overview.md).
