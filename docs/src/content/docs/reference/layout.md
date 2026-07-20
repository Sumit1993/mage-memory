---
title: Knowledge-base layout
description: What a mage knowledge base writes to disk — the committed surface you own, and the gitignored machine state.
sidebar:
  order: 4
---

A mage knowledge base is just files in a directory. There is no database and no hidden store: everything mage knows lives in plain markdown and JSON you can open, diff, and own in git. This page is the map of that directory — what each part holds, and the single most important distinction: **what gets committed versus what stays gitignored.**

## The docs root

Everything below lives under one directory called the **docs root**. Where that is depends on how you set mage up:

- **In-repo** (the common case): the docs root is `mage/` inside your code repository. mage writes only under `mage/`; your application source is never touched.
- **Hub**: a standalone knowledge base repository. There the docs root *is* the repository root.

In the examples below, paths are shown for the in-repo case (the `mage/` prefix); in a hub, drop the `mage/` and read the same names at the repository root.

## The committed surface — what you own

These are the files mage intends you to keep in git. They are the knowledge base: human-readable, Obsidian-navigable, and reviewable in a pull request.

```
mage/
  metadata.json        KB identity, mode, hub links, and the grooming dial (committed config)
  INDEX.md             the always-current, one-line-per-note index (generated, committed)
  notes/               your notes — one markdown file per thing you learned
  decisions/           ADRs: a choice, its reasoning, and what it rules out
  work/                per-work-unit records
```

Plus a few other generated, committed markdown files at the root depending on your setup — for example `Dashboard.md` and a per-wing `_index.<wing>.md`. The rule of thumb: **markdown files and the content directories are the knowledge base, and they belong in git.**

- `notes/`, `decisions/`, `work/` are content directories — the things you author (with mage's help) and review.
- `INDEX.md` is regenerated deterministically by `mage index`; it is committed so a reader (human or agent) can see what is known without loading every note. See [Notes](../model/notes.md) and [The graph](../model/graph.md).
- `metadata.json` is the KB's config: its identity, its mode (in-repo / hybrid / external), any hub links, the grooming sensitivity dial that scales the recurrence thresholds, and the optional `redact` allowlist for the redaction gate. See [Thresholds and the dial](./thresholds.mdx) and [Redaction (two gates)](./redaction.md).

## The gitignored machine state

mage also writes transient, machine-owned working state. This is **never meant to be committed** — it is scratch, rollups, and uncommitted drafts that mage regenerates or rebuilds as it runs. It all lives under a single gitignored `.mage/` directory at the docs root (ADR-0025), with one leaf per kind of state:

```
mage/
  .mage/               all machine-owned working state — gitignored (ADR-0025)
    learnings/         raw captured signal (auto-pruned scratch)
    metrics/           context-match rollups, watermarks, throttle markers
    staging/           lesson drafts awaiting your review (the grooming loop)
```

Each leaf holds a different kind of working state:

- **`.mage/learnings/`** — the raw capture scratch. Every hook-fired `mage observe` event appends here as JSONL. It is auto-pruned over time and rotated into a `.archive/` subdirectory; a `.last-purge` marker throttles the age-purge to once per day. This is the input the loop distills from, not a permanent record.
- **`.mage/metrics/`** — generated rollups and bookkeeping (read-only for you, but written by mage as it runs): the context-match results (did the skills that auto-loaded actually match the work?), the distill/promote watermarks, reject ledgers (`staged-rejects.json`, `rejected.json`), the autonomous keep-rate ledger maintained by the reconciler (`keep-rate.json`, `src/grooming/reconcile.ts`), and the boundary-nudge throttle (`nudge-throttle.json`).
- **`.mage/staging/`** — judged-but-uncommitted lesson drafts. When the [stage and groom](../loop/stage-groom.md) step drafts a lesson, it lands here as a `<slug>.md` file, *out* of the live index, until you accept it. Accepting moves it into `notes/` and re-indexes; rejecting discards it and records the key.

### Why these stay out of git

The split is by lifecycle, not by feature: `notes/` is durable, reviewed knowledge you own; everything under `.mage/` is regenerable working state that would only add churn and noise to your history. Keeping it gitignored also means raw captured signal never lands in a shared commit by accident.

mage keeps this ignored for you. When you run `mage connect` (or `mage init`), it self-heals your `.gitignore`, adding the `.mage/` pattern at the right root:

- in-repo, at the code-repo root: `mage/.mage/`
- in a hub, at the hub root: `.mage/` plus its `**/.mage/` recursive form (so each project's state is covered).

If you ever suspect this is not ignored, `mage doctor --fix` re-adds the missing `.mage/` rule.

## Quick reference

| Path (in-repo) | Kind | In git? |
| --- | --- | --- |
| `mage/metadata.json` | config | committed |
| `mage/INDEX.md` | generated index | committed |
| `mage/notes/`, `mage/decisions/`, `mage/work/` | content | committed |
| `mage/.mage/learnings/` | raw capture scratch | gitignored |
| `mage/.mage/metrics/` | rollups + watermarks | gitignored |
| `mage/.mage/staging/` | lesson drafts | gitignored |

## Where to next

- [Notes](../model/notes.md) — what a note file actually contains.
- [The self-grooming loop](../loop/overview.md) — how the gitignored scratch becomes committed notes.
- [Redaction (two gates)](./redaction.md) — how secrets are kept out of the committed surface.
