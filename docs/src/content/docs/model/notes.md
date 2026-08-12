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

## Note types and genres

A note carries an optional `type` in its frontmatter. Per ADR-0041, `type` maps to a **genre** that decides its recall rung. Only memory-genre notes reach recall at all — every one of them lands in `INDEX.md`, and passing the genre filter makes a note *eligible* for the pushed `MEMORY.md` roster rather than guaranteeing a slot in it: what gets pushed is the top-K by rank, and the rest stay in `INDEX.md` ([the two recall surfaces](./graph.md#the-two-recall-surfaces)). The memory genres (ADR-0041):

- **gotcha** / **procedure** — traps and reusable procedures (procedural notes that can graduate into skills).
- **pointer** / **reference** / **principle** / **feedback** / **note** — wayfinding, durable rules, and insight.

Any string is legal; unrecognized types are unclassified and sit at rung 3 (on-demand only). Custom types can be mapped to one of the four standard genres (`memory`, `decision`, `work`, `doc`) via the optional `genres` map in `metadata.json` (e.g. `"genres": { "runbook": "memory" }`). Legacy strings (`playbook`, `interface`, `tooling`, `topology`, `relationship`, `trail`) remain legal but map to **unclassified** (rung 3).

The whole resolution in one table. A **rung** is how a note reaches the agent: rung 1 is a skill auto-loaded on its trigger, rung 2 is an always-loaded index line, rung 3 is the note body read on demand (every note has rung 3). The map is the `TYPE_TO_GENRE` constant in `src/scanner/genre-map.ts`; the rungs are ADR-0041's:

| `type:` | genre | rung | which surface it reaches |
| --- | --- | --- | --- |
| `gotcha` `procedure` | memory | 2 — and 1 once graduated | a line in `INDEX.md`, eligible for the `MEMORY.md` roster; a graduated procedural note adds its own auto-loaded skill |
| `pointer` `principle` `feedback` `reference` `note` | memory | 2 | a line in `INDEX.md`, eligible for the `MEMORY.md` roster |
| `decision` | decision | 3 | on demand only, plus the one standing governance line both surfaces carry |
| `plan` `tasks` | work | 3 | on demand only |
| `spec` `doc` | doc | 3 | on demand only |
| `runbook` — custom, mapped with `"genres": { "runbook": "memory" }` | memory | 2 | exactly as a built-in memory type |
| `playbook` — a legacy string, no mapping | unclassified | 3 | on demand only; `mage doctor` annotates, never rejects |

Non-memory types (`plan`, `spec`, `tasks`, `decision`) remain legal note types for storage and linking, but are non-memory genres (`work`, `doc`, `decision` per ADR-0041) that are excluded from always-loaded recall — authored deliberately rather than as default destinations for captured knowledge:
- **decision** — an ADR: a choice, the reasoning, and what it rules out (stored in `mage/decisions/`).
- **spec** / **plan** / **tasks** — specifications, forward work plans, and checklists (stored in `mage/work/` or repo docs).

Before authoring a memory note, walk the **better home** ladder (code comment → ticket/`mage/work/` → doc beside code → artifact+pointer → skill → decision → memory) to ensure memory is the right home.

### Graduation eligibility is a separate contract

The table above answers one question only: **how does a note come back to you?** It does not decide which notes can [graduate](../loop/promote-graduate.md) into their own auto-loaded skill. That is a second, independent contract, and reading rung text as if it implied graduation is a mistake the two tables invite:

| `type:` | eligible to graduate? | why |
| --- | --- | --- |
| `procedure` `gotcha` | yes | procedural — you *push* a procedure at the agent; a fact it *pulls* when needed |
| every other memory type | no | recall-bearing but not procedural; rung 2 is the whole of their reach |
| non-memory genres (`decision` `plan` `tasks` `spec` `doc`) | no | not recall-bearing at all |

The two contracts are genuinely orthogonal. A note can sit at rung 2 and never be graduation-eligible (`principle`, `reference`), and — as the drift below shows — a type can currently be graduation-eligible while sitting at rung 3, which is incoherent and is the reason the drift is tracked rather than tolerated.

**The intended contract is `procedure`/`gotcha`.** `playbook` is a legacy string: unclassified for recall (rung 3) *and* not part of the intended graduation contract. The code has not caught up — `src/grooming/promote.ts` still gates on `type === "playbook" || type === "gotcha"`, so a `playbook` note is today accepted by the graduation gate despite being invisible to rung-2 recall. Tracked in [#137](https://github.com/Sumit1993/mage-memory/issues/137), whose resolution is to emit `procedure` from groom's lens table and accept `procedure` at the gate — **not** to give `playbook` a genre mapping, which would leave one of six legacy strings arbitrarily rescued.

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

When you learn something durable, you do not hand-write all this. The deliberate-capture skill `/mage:learn` drafts the note for you on the spot and writes it after you confirm (see [Install and Quickstart](../start/quickstart.md)), and the [capture](../loop/capture.md) and [stage / groom](../loop/stage-groom.md) stages of the loop draft notes for you as you work.

## Where to next

- [The graph: wings and rooms](./graph.md) — how notes organize and become navigable.
- [The self-grooming loop](../loop/overview.md) — how notes get created and kept fresh.
- [Reference: knowledge-base layout](../reference/layout.md) — where note files live on disk.
