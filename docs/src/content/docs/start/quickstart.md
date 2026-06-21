---
title: Install and Quickstart
description: Install the mage CLI and create your first knowledge base in a few commands.
sidebar:
  order: 2
---

This page takes you from nothing to a working mage knowledge base, with capture wired in. It assumes you know what mage is — if not, read [What is mage?](../index.md) first.

You need **Node 20 or newer** and **git**.

## Install the CLI

mage ships as an npm package. Install it globally to get the `mage` command:

```bash
npm i -g mage-memory
```

The latest published release is **0.0.12**. (mage is pre-1.0 and evolving; this page tracks the current published version.)

Check it landed:

```bash
mage --help
```

### Install the skills plugin (Claude Code)

mage's hand-authored skills ship as a Claude Code plugin so they group under a clean `mage:` namespace. Install the group from inside Claude Code:

```text
/plugin marketplace add Sumit1993/mage-memory
/plugin install mage@mage
```

`mage init` prints these two lines for you — it never runs slash commands itself. Other agents that read `.agents/skills/` directly will see the bare skill names without the `mage:` prefix.

## Create a knowledge base

Move into the code repo you want mage to remember, and run:

```bash
mage init --in-repo
```

This scaffolds a knowledge base under `mage/` inside the repo, committed alongside the code it describes. This is the **in-repo** mode, and it is the right default for a single repo.

mage has another mode. A **hub** is a standalone knowledge base that spans many repos — you create it once with `mage init <your-hub>` (no code repo required), then `mage link` your code repos into it. If you are not sure, start in-repo; you can link to a hub later. See [Modes and storage](../model/modes.md) for the full picture.

`mage init` detects your context: run plain `mage init` and, inside a git repo, it scaffolds an in-repo `mage/`; outside one, it creates a hub in the current directory. The `--in-repo` and `--hub` flags force the choice.

### Non-interactive setup

`mage init` prompts when run bare. To scaffold without any prompt — in a script, a CI step, or an agent session — pass `-y` / `--yes`, which uses the detected default (in-repo inside a git repo, hub outside):

```bash
mage init --in-repo --yes        # in-repo KB, no prompts
mage init my-hub --yes           # standalone hub named my-hub, no prompts
```

A hub name is positional and *implies* a hub, so it conflicts with `--in-repo` — pass one or the other, never both (`mage init my-hub --in-repo` errors out). If you skip the auto-connect with `--no-connect`, wire capture later, also non-interactively, with:

```bash
mage connect --yes               # wire hooks, no confirmation prompt
```

## What `mage init` wires for you

After scaffolding an in-repo knowledge base, `mage init` auto-connects capture — an in-repo base is inert until capture is wired. That step (the same one you can run by hand as `mage connect`) does two things:

- **Wires the capture hooks** into this repo's `.claude/settings.local.json` — a personal, gitignored, per-repo file. These hooks let mage observe what your agent does (which tool, which files, which skill loaded) and feed the [grooming loop](../loop/overview.md). They include the boundary [nudge](../loop/nudge.md) on a post-compaction start. See the full list on the [Hooks](../reference/hooks.mdx) page.
- **Installs the Gate-2 redaction pre-commit hook** (`mage redact --check --staged`). This is a blocking, deterministic scan at the commit boundary: if a staged note carries a live secret, the commit is refused. It is your safety net so a captured secret never lands in git. See [Redaction](../reference/redaction.md).

`mage connect` is idempotent, backs up the settings file to `.bak`, and refuses to touch malformed JSON. To skip the auto-connect during init, pass `--no-connect`; to wire it later, just run:

```bash
mage connect
```

If a pre-commit hook already exists, mage will not overwrite it — it tells you to add `mage redact --check --staged` to your own hook. Skip the git hook with `mage connect --no-git-hook`.

## Write your first note

A note is a markdown file under `mage/notes/` recording insight, procedure, and pointers. Create one — for example `mage/notes/billing/payments.md`:

```markdown
---
type: interface
tags: [billing/payments]
status: active
sources:
  - file:src/charge.ts:40
---

# Charging a customer

## Insight
`charge()` is idempotent only when you pass an `idempotency_key`. Without it,
a retried request double-charges.

## Procedure
- Generate the key once, upstream, and thread it through retries.
- Do NOT regenerate the key inside the retry loop — that defeats idempotency.
```

Everything in the frontmatter is optional; mage falls back to the title, headers, and tags when fields are missing. The `tags` value `billing/payments` files the note in the `billing` wing under the `payments` room. See [Notes](../model/notes.md) for the full frontmatter.

## Let mage draft the note for you

You rarely hand-write notes. The deliberate-capture path is the **`mage:learn`** skill. Inside Claude Code, say `mage:learn` (or just "remember this") right after you figure something non-obvious out. mage classifies the finding, checks the index for an existing note to update, drafts the note for you — the reusable insight, the procedure, and pointers to canonical sources, never a copy — and writes it only after you confirm. (It also runs the redaction gate on the draft first, so a captured secret never lands in a tracked note.)

`mage:learn` is the *deliberate* capture you trigger on the spot. The [grooming loop](../loop/overview.md) adds two more drafting paths you do not trigger by hand: inline [capture](../loop/capture.md) and the boundary [nudge](../loop/nudge.md) draft lessons as you work, and the recurrence path proposes a new note once a pattern recurs. All of them end the same way — a draft you review and confirm; **you** commit.

## Regenerate the index

The **index** (`mage/INDEX.md`) is the always-loaded map of your knowledge base — one line per note. It is generated, never hand-edited. After adding or changing notes, regenerate it:

```bash
mage index
```

Your agent loads this index first to know what exists, then opens only the notes a task touches.

## Commit it yourself

mage never runs git for you. It only suggests the exact commands and lets you run them. When you are happy with the new note and index, commit them yourself:

```bash
git add mage/
git commit -m "docs(mage): add payments idempotency note"
```

The capture sinks (`.mage/learnings/`, `.mage/metrics/`, `.mage/staging/`) are gitignored by design, so observed scratch and metrics never enter git — only the notes you confirm do.

## Where to go next

- [Modes and storage](../model/modes.md) — in-repo, hub, hybrid, and external.
- [The grooming loop](../loop/overview.md) — how mage learns from your sessions.
- [Hooks](../reference/hooks.mdx) — every capture hook `mage connect` wires.
- [Commands](../reference/commands.mdx) — the full CLI surface.
