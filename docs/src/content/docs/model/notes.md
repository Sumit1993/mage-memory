---
title: Notes
description: The unit of mage knowledge — insight, procedure, and pointers, never a copy of the source.
sidebar:
  order: 1
---

A **note** is the atomic unit of a mage knowledge base: one plain markdown file about one thing. If you can open it in any text editor or in Obsidian, you can read a mage note — there is no database, no proprietary format, just files you own in git.

The whole point of a note is captured in three words.

## Insight, procedure, pointers — never a copy

mage deliberately does *not* store copies of the things you already have. Blog posts, API docs, tickets, source code — those are canonical somewhere else. Copying them into a note just creates a lossy mirror that drifts the moment the original changes.

Instead, a good note captures three reusable things:

- **Insight** — what you figured out, stated verbatim. Do not over-simplify the hard-won understanding into a platitude.
- **Procedure** — how to do it faster next time. The steps that worked, and the wrong turns to avoid (the flag that silently fails, the order that matters).
- **Pointers** — where the canonical source lives, so you can jump straight back to it. These go in the note's `sources:` frontmatter as a URL, a ticket, or a `file:line` reference.

The goal is *do it faster and make fewer mistakes next time*, not *archive everything we read*. This is a governing decision of the project (ADR-0004, "Capture insight, procedure, and pointers — not copies of sources", in mage's own knowledge base).

For example, instead of pasting a service's entire API reference into a note, you capture the one non-obvious thing — "every charge needs an idempotency key or it double-bills" — plus a pointer to the canonical docs page. The fact is the insight; the link is the pointer.

## Note types

A note carries an optional `type` in its frontmatter. The vocabulary is *suggested and open* — mage never enforces it — but a shared vocabulary makes notes scannable. The common types:

- **gotcha** — what *not* to do and why (a CLI flag that fails, an order that breaks something). Surfaced so you do not repeat the mistake.
- **playbook** — how to do X faster: a reusable procedure.
- **decision** — an ADR: a choice, the reasoning, and what it rules out.
- **interface** — how to *use* a service or API: endpoints, useful params, auth, gotchas.
- **pointer** / **reference** — where a canonical source lives and when to go there. Pure wayfinding, never a copy.
- **principle**, **topology**, **relationship**, **tooling**, **trail**, **spec**, **plan**, **tasks** — the rest of the suggested set.

You can use any string you like; the listed values are just the ones mage's own tooling understands by convention. The full suggested vocabulary lives alongside the `type` field in the source (`src/note.ts`).

The two procedural types — **playbook** and **gotcha** — are special: only procedural notes can later [graduate](../loop/promote-graduate.md) into their own auto-loaded skill, because you push a procedure but you pull a fact.

## Frontmatter and the lifecycle fields

A note begins with a small YAML frontmatter block, then the markdown body. *Everything* in the frontmatter is optional — a note is valid as plain markdown with no frontmatter at all (mage degrades gracefully). When present, the fields that matter most for keeping memory trustworthy are:

```markdown
---
type: gotcha
tags:
  - billing/payments
status: active
last_reviewed: "2026-06-19"
provenance:
  repo: my-service
  commit: a1b2c3d
sources:
  - https://docs.example.com/charges#idempotency
---

# Charges need an idempotency key

Every charge call double-bills unless it carries a unique
`Idempotency-Key` header. ...
```

The lifecycle-relevant fields:

- **`status`** — one of `active`, `stale-suspect`, `superseded`, or `archived`. It is how a note announces its own trustworthiness.
- **`last_reviewed`** — the date you last verified the note against reality. A cheap staleness signal: `mage dream` flags notes whose `last_reviewed` is older than its threshold (180 days by default).
- **`provenance`** — where the note came from: the `repo` and the `commit` (or work-unit slug) it was distilled from. This is what lets you judge whether a note has drifted from the code it describes.
- **`tags`** — `wing/room` scoping labels (stored without the leading `#`). The first tag is the note's primary wing. See [The graph: wings and rooms](./graph.md).
- **`sources`** — the pointers described above.
- **`keywords`** — optional; the index falls back to the title, headers, and tags when this is absent.

The note's **title** is simply its first markdown `# H1`, falling back to the filename. You do not set a title in frontmatter.

## Notes are point-in-time

A note records what was true *when it was written*. Code moves on; a note can quietly go wrong. mage treats every note as a snapshot, not a live truth, and gives you signals to catch drift:

- A note whose `status` is **`stale-suspect`** is openly flagged as "this may no longer be accurate — verify before relying on it."
- An old `last_reviewed` date, or a `provenance.commit` that is far behind the current code, is a hint to re-check before you trust it.

This matters most for AI agents working in the repo. The guidance in `AGENTS.md` is explicit: treat notes as point-in-time, and if a note looks stale, verify it against the current code before relying on it. A note is a fast path to understanding, not an oracle.

When you learn something durable, you do not hand-write all this. The deliberate-capture skill `mage:learn` drafts the note for you on the spot and writes it after you confirm (see [Install and Quickstart](../start/quickstart.md)), and the [capture](../loop/capture.md) and [stage / groom](../loop/stage-groom.md) stages of the loop draft notes for you as you work.

## Where to next

- [The graph: wings and rooms](./graph.md) — how notes organize and become navigable.
- [The self-grooming loop](../loop/overview.md) — how notes get created and kept fresh.
- [Reference: knowledge-base layout](../reference/layout.md) — where note files live on disk.
