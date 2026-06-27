---
title: The self-grooming loop
description: The lifecycle that turns captured session signal into durable notes and loadable skills.
sidebar:
  order: 1
---

mage watches your coding sessions, drafts what looks worth remembering, and lets you confirm it into durable notes — without you stopping to write documentation. That cycle is the **self-grooming loop**. This page is the map; each stage links to its own page.

Two terms first, because everything below leans on them:

- A **note** is a small markdown file under `mage/notes/` holding one reusable lesson — insight plus procedure plus pointers, never a copy of a source. Notes are committed, indexed knowledge.
- A **compact-chapter** is one stretch of work between context compactions (or session ends). When your coding host compacts the conversation to free up context, that closes a chapter. mage counts chapters, not session ids — so one long, continuously-compacted chat still produces many chapters.

## The two paths

mage runs two complementary paths over the same captured signal. They share a capture stage and a human-confirm gate, but they catch different things.

```mermaid
flowchart TD
  sessions[Your coding sessions] --> observe["Capture: mage observe writes the .mage/learnings scratch"]

  observe --> boundary{"Chapter boundary: a compaction closes the chapter"}

  boundary --> nudge["Boundary nudge: mage nudge on SessionStart source=compact distills the closed chapter"]
  nudge --> stage["Stage: draft forgotten lessons into .mage/staging"]
  stage --> groom["Groom (mage:groom): accept or reject the deduped batch"]
  groom --> notes[notes/]
  groom -->|reject| rejects[("staged-rejects.json: keys never re-drafted")]

  observe --> distill["Distill: a striking insight earns a note on first sight"]
  distill --> promote["Promote: a signature recurring across at least K chapters with no covering note becomes a NEW note candidate"]
  promote --> graduate["Graduate: a proven procedural note recurring across at least M chapters becomes its own loadable mage-skill"]
  graduate --> optimize["Optimize: context-match rewords or demotes generated skills"]
  optimize --> sessions

  distill --> notes
  promote --> notes

  ccwrite["Claude Code: native-memory write, autoMemoryDirectory = KB root"] --> gate0{"Gate-0 PreToolUse: scrub secrets/PII, map to mage schema"}
  gate0 -->|generated index| denied(["denied: mage owns the index"])
  gate0 -->|topic note| inbox["Capture inbox: scrubbed note, flat at the docs-root top"]
  inbox -->|mage groom ingests the inbox| stage
```

**The lesson path (through the nudge).** Always-on inline capture and the boundary nudge draft short lessons the first time something is worth remembering. They land in a git-ignored staging area; you review the batch and accept the keepers into `notes/`. This is the everyday path — the one most new users will use. See [Stage and groom](./stage-groom.md).

**The recurrence path (the lower arc).** A deterministic engine folds the captured scratch into per-signature tallies. A pattern that keeps recurring — across enough distinct chapters, with no note already covering it — surfaces as a note candidate. A proven procedural note that recurs even more becomes its own auto-loadable skill. See [Promote and graduate](./promote-graduate.md).

Both paths converge on the same place: `notes/`, your committed knowledge, indexed in `INDEX.md`.

The chapter boundary in the diagram is a **view**, not a stored state: mage derives it from the capture trail (a `PreCompact` marker, or a `SessionStart` with `source=compact`) rather than persisting a "chapter closed" flag. Nothing downstream waits on a record of the boundary; the digest is recomputed from the scratch each time.

## Capture on Claude Code (the native-memory redirect)

Claude Code ships its own memory reflex — left alone, it writes memories to its private store, in its own schema, where mage never sees them and git never keeps them. Rather than fight that reflex with a nudge, `mage connect` **co-opts** it. It points Claude Code's `autoMemoryDirectory` at the knowledge base, so a native-memory write lands at the docs-root top instead. A **Gate-0** `PreToolUse` hook intercepts that write and, *before it touches disk*, scrubs secrets and PII and maps it into mage's note schema — and **denies** a write aimed at a generated index (`INDEX.md` / `MEMORY.md` / a wing index), which mage owns and regenerates. The scrubbed, mage-shaped note lands flat at the docs-root top as a **capture inbox** file.

That inbox is just another feeder into the lesson path. The next `mage groom` **ingests** the inbox — lifting each capture into `.mage/staging/` as a clean draft — where it joins the same deduped batch as a `mage stage` draft and flows through the same accept gate into `notes/` (provenance-stamped on the way). So capture becomes *deterministic* on Claude Code without a second pipeline.

This redirect is adapter-specific and gated on Claude Code's `autoMemoryEnabled`. On any other harness, the volitional capture directive (write a mage note to the inbox) is the path — same notes, same index, just without the un-skippable enforcement. See [Stage and groom](./stage-groom.md) for what the inbox feeds into.

## Where each stage lives

| Stage | What it does | Page |
|---|---|---|
| Capture | Hook-fired `mage observe` appends session events to the git-ignored learnings scratch. | [Capture](./capture.md) |
| Capture redirect (Claude Code) | Gate-0 scrubs + maps a native-memory write into a capture inbox at the docs-root top; `mage groom` ingests it into staging. | [Capture](./capture.md) |
| Boundary nudge | On a post-compaction start, `mage nudge` distills the closed chapter and drafts forgotten lessons. | [The boundary nudge](./nudge.md) |
| Stage and groom | The lesson path: staged drafts -> the `mage:groom` skill -> accepted notes. | [Stage and groom](./stage-groom.md) |
| Promote and graduate | The recurrence path: recurring signatures -> note candidates -> graduated skills. | [Promote and graduate](./promote-graduate.md) |
| Optimize | Context-match rewords or demotes the generated skills. | [Optimize](./optimize.md) |

## Nothing auto-commits

mage **writes files; you commit them.** Capture appends to a git-ignored scratch. Accepting a draft writes a note and re-indexes. Graduating mints a skill. None of these run `git commit` — every stage stops at the working tree and suggests a `git` command for you to run after you have reviewed the diff. The judgment calls — "is this a real lesson?", "is this trigger right?" — are always made by the host agent or by you, never by a model inside mage.

## What tunes the loop

Two numbers gate the recurrence path, and a sensitivity dial scales them together: **K** (how many chapters before a pattern becomes a note candidate) and **M** (how many before a proven note graduates into a skill). See [Thresholds and the dial](../reference/thresholds.mdx) for the exact values and the low / normal / high positions.
