---
title: Import an existing notes or docs folder
description: Bring a folder of existing markdown — old notes, a docs/ tree, scratch files — into mage as distilled notes, never as verbatim copies, with mage:learn --from.
---

You rarely start from nothing. You may already have a `docs/` tree, a folder of
scratch notes, an exported wiki, or a pile of `NOTES.md` files. mage can onboard
that knowledge — but it will **never paste it in verbatim**. A mage note is
insight plus procedure plus pointers, never a copy of a source. So importing a folder
means *distilling* it, one source at a time, into notes you confirm — see
[Notes](../model/notes.md) for what that shape is.

## The one move

Inside Claude Code, run the [`mage:learn`](../reference/commands.mdx) skill
pointed at the folder:

```text
mage:learn --from ./docs
```

The `--from <path>` argument can be a directory or a single file. The skill walks
the folder, classifies each ingestable source, drafts a distilled note for each —
the reusable insight, the procedure, and pointers back to the original file,
**not** its full text — and writes only the ones you confirm. As with every
capture path, the [redaction gate](../reference/redaction.md) scrubs each draft
before it can touch disk, and **you** commit.

## Preview what would be ingested

`mage:learn --from` is driven by a deterministic manifest you can inspect first.
The read-only `mage ingest` plumbing verb enumerates and classifies the sources
under a folder without writing anything:

```bash
# What would be picked up, as a human-readable list
mage ingest ./docs

# The same manifest as JSON, for tooling
mage ingest ./docs --json
```

Nothing is created until you run `mage:learn --from` and accept the drafts.

## Onboarding agent memories instead of a folder

`mage:learn --from` is for *files you point it at*. If instead you have
pre-existing **Claude Code memories** that you want to fold into mage, that is a
different entry point: [`mage adopt`](../reference/commands.mdx) collects in-shape
captures into the capture inbox and reports the out-of-shape ones for you to run
through `mage:learn --from`. It is plan-first and never commits.

```bash
mage adopt --dry-run     # show the plan; write nothing
mage adopt               # place in-shape captures into the inbox
```

## After importing

Imported notes flow through the same path as any other: review the drafts,
accept the keepers, and they land in `notes/` and get re-indexed. Then commit
them yourself — see [Stage and groom](../loop/stage-groom.md) for the review step
and [Install and Quickstart](../start/quickstart.md#commit-it-yourself) for the
commit.
