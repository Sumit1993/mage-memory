---
title: 'The graph: wings and rooms'
description: How notes organize into wings and rooms, indexed by INDEX.md and navigable as an Obsidian graph.
sidebar:
  order: 2
---

A single note is useful. A *connected* set of notes is a memory. mage organizes notes into a shallow, two-level scope — **wings** and **rooms** — and renders the whole thing as a graph you can navigate, both as an always-loaded text index and visually in Obsidian.

## Wings and rooms

A **wing** is the top-level scope a note belongs to: typically a project, a repo, a service, or even a person. A **room** is a topic *within* a wing — the second level.

Both come from a note's tags. A tag is written `wing/room`, and mage reads the two segments directly:

- the first segment is the **wing** (`billing/payments` -> `billing`)
- the rest is the **room** (`billing/payments` -> `payments`)

So a note tagged `billing/payments` lives in the `payments` room of the `billing` wing. (This split is exactly what `noteWing` and `noteRoom` compute in `src/note.ts`.)

A wing is an **optional convention, never a necessity.** An untagged note is perfectly valid — it simply indexes under "Cross-cutting" instead of a named wing. Reach for a wing only when your knowledge base spans more than one top-level scope. An in-repo knowledge base for a single small repo may need no wings at all.

### The first tag is primary, but a note can multi-home

A note may carry several tags. The **first** tag is its *primary* wing — it drives the note's color in the graph and its ownership. But the note is indexed under *every* wing it is tagged with. This is **multi-home**: a note that genuinely belongs to two scopes (say a `web -> payments` coupling) is findable from either wing's index. This mirrors how Obsidian itself treats a note with `#a #b` — it belongs to both groups. (See `noteWings` in `src/note.ts`, and ADR-0012 in mage's knowledge base.)

## INDEX.md — the always-loaded index

You do not navigate a mage knowledge base by reading every note. You read one file first: **`INDEX.md`**.

`INDEX.md` is a generated, compact index — one line per note (its type, title, keywords, and a link to the file), grouped by wing. It is the "what is known here" summary an agent loads before doing anything else, so it knows what exists and can decide which notes are worth opening. The project's `AGENTS.md` tells every agent to read `INDEX.md` first and open only the notes the task actually touches.

`INDEX.md` is **deterministic and idempotent** — it is regenerated from the notes by `mage index` (a hidden plumbing command, fired automatically; you rarely run it by hand). Because it is derived, you never edit it directly: you change a note, and the index follows. The index is *registry-enriched but never registry-dependent* — notes are found and grouped by tag alone, so the index works even with no project registry at all (ADR-0011).

## Navigable as an Obsidian graph

Because every note is plain markdown with standard markdown links between notes (never `[[wikilinks]]`), a mage knowledge base opens cleanly as an [Obsidian](https://obsidian.md) vault. mage scaffolds a minimal `.obsidian/` config so the graph view is useful out of the box — without taking on any Obsidian dependency, and without ever clobbering settings you have already customized.

The most visible touch is **wing coloring**. mage deterministically assigns each wing a color from a fixed, visually distinct palette and writes those color groups into the Obsidian graph config, so each wing's notes cluster in their own hue. The palette (defined in `src/obsidian.ts`) cycles through:

- blue, red, green, amber, purple, teal, orange, magenta

Wings are sorted before assignment, so the mapping is stable across runs (a wing keeps its color). The color group is keyed on an Obsidian search query (`tag:#<wing>`), which also matches the nested `#<wing>/<room>` tags underneath it. When your set of wings changes, `mage index` refreshes the color groups in place and leaves every other graph setting untouched.

```mermaid How the index fans out into wings and rooms: INDEX.md links to each wing (billing, web, and untagged cross-cutting notes), and each wing links to its rooms.
flowchart TD
  index["INDEX.md (always-loaded)"]
  index --> billing["billing wing"]
  index --> web["web wing"]
  index --> cross["Cross-cutting (untagged)"]
  billing --> pay["payments room"]
  billing --> inv["invoices room"]
  web --> ui["ui room"]
  pay -. "web to payments link" .-> ui
```

A note's links become edges in this graph; wings become colored clusters; the index is the table of contents over all of it.

## Where to next

- [Notes](./notes.md) — what a single note is and what goes in its frontmatter.
- [Modes and storage](./modes.md) — where the graph physically lives (in your repo, or a shared hub).
- [Reference: knowledge-base layout](../reference/layout.md) — the on-disk file layout.
