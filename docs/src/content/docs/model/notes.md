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

A note carries an optional `type` in its frontmatter. Per ADR-0041, `type` maps to a **genre** that decides which listing surfaces it reaches. Only memory-genre notes reach recall at all — every one of them lands in `INDEX.md`, and passing the genre filter makes a note *eligible* for the pushed `MEMORY.md` roster rather than guaranteeing a slot in it: what gets pushed is the top-K by rank, and the rest stay in `INDEX.md` ([the two recall surfaces](./graph.md#the-two-recall-surfaces)). The memory genres (ADR-0041):

- **gotcha** / **procedure** — traps and reusable procedures.
- **pointer** / **reference** / **principle** / **feedback** / **note** — wayfinding, durable rules, and insight.

Any string is legal; unrecognized types are unclassified and sit at tier 3 (on-demand only). Custom types can be mapped to one of the four standard genres (`memory`, `decision`, `work`, `doc`) via the optional `genres` map in `metadata.json` (e.g. `"genres": { "runbook": "memory" }`). Legacy strings (`playbook`, `interface`, `tooling`, `topology`, `relationship`, `trail`) remain legal but map to **unclassified** (tier 3).

The whole resolution in one table. A **tier** is how a note is listed: tier 2 is an index line, tier 3 is the note body read on demand (every note has tier 3). This is separate from a note's ladder `rung` (`impossible` to `note`) and from [recall at the action](./recall.md). The map is the `TYPE_TO_GENRE` constant in `src/scanner/genre-map.ts`:

| `type:` | genre | tier | which surface it reaches |
| --- | --- | --- | --- |
| `gotcha` `procedure` | memory | 2 | a line in `INDEX.md`, eligible for the `MEMORY.md` roster |
| `pointer` `principle` `feedback` `reference` `note` | memory | 2 | a line in `INDEX.md`, eligible for the `MEMORY.md` roster |
| `decision` | decision | 3 | on demand only, plus the one standing governance line both surfaces carry |
| `plan` `tasks` | work | 3 | on demand only |
| `spec` `doc` | doc | 3 | on demand only |
| `runbook` — custom, mapped with `"genres": { "runbook": "memory" }` | memory | 2 | exactly as a built-in memory type |
| `playbook` — a legacy string, no mapping | unclassified | 3 | on demand only; `mage doctor` annotates, never rejects |

Non-memory types (`plan`, `spec`, `tasks`, `decision`) remain legal note types for storage and linking, but are non-memory genres (`work`, `doc`, `decision` per ADR-0041) that are excluded from always-loaded recall — authored deliberately rather than as default destinations for captured knowledge:
- **decision** — an ADR: a choice, the reasoning, and what it rules out (stored in `mage/decisions/`).
- **spec** / **plan** / **tasks** — specifications, forward work plans, and checklists (kept in the issue tracker, per ADR-0050).

Before authoring a memory note, walk [the ladder](../loop/overview.md) to ensure a note is the right home.

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

## Admission and triggers

A note is **admitted** when it says where it sits on the ladder, when it matters, and where its source is. `mage index` checks every memory note and prints `Roster: A of N notes admitted; M recalled at the action.` A note that is not admitted is still listed in `INDEX.md` and the `MEMORY.md` roster; it is only ineligible for [recall at the action](./recall.md).

| field | required | meaning |
| --- | --- | --- |
| `rung` | yes | one of `impossible`, `check`, `hook`, `rule`, `note` |
| `trigger` | yes | the moment it matters: a string, or `{when, match}` |
| `pointer` | yes | a markdown link to the issue, file or decision behind the note |
| `id` | no | `<unit>/<rung>/<slug>`; checked when present |
| `skipped` | no | a reason for each rung passed over; each value must be a non-empty string when present |

`trigger` has two forms. The plain string is read by people and sits on the roster; it is never matched. The mapping adds `match`, a string or a list, and makes the note eligible for recall:

```yaml
trigger: "deciding which mage binary a verify command runs"
```

```yaml
trigger:
  when: "deciding which mage binary a verify command runs"
  match: ["Bash(npx mage *)", "Edit(package.json)"]
```

A matcher is a subset of Claude Code's permission-rule syntax. Anything else is reported by `mage index` as `trigger.match: "…" is not Bash(...) or Edit(...); ignored` and the hook skips it. Patterns are globs, never regex.

| matcher | tests | how |
| --- | --- | --- |
| `Bash(pattern)` | the Bash command | the whole command, or any part between `&&`, `||`, `;`, `|` or a newline, matches the glob |
| `Edit(pattern)` | Write, Edit, MultiEdit and NotebookEdit paths | the path relative to the code repo being edited (the git repository of the edited file, which in external and hub modes is not the repo holding the notes), with `/` separators; a pattern with no `/` matches the file name at any depth |
| `Write(pattern)` | the same as `Edit(pattern)` | an alias |

The memory-hook gate that asks the ladder is set in `mage/metadata.json` (a hub reads its own root metadata, like `grooming`):

```json
{ "ladder": { "gate": "deny-once" } }
```

`deny-once` is the default: the first memory write of a session that carries no `rung` is refused once, with a reply that ends in a retry, after mage keeps a redacted copy at `notes/.held/<session>[-<agent>]-<slug>.md` and names it in the reply; every later write passes. The parent and each subagent are asked once, because the marker is keyed on `session_id` and the hook input's `agent_id`. If the copy cannot be written, the write is allowed with the ladder attached instead, so nothing is lost. `ask` allows the first write and attaches the ladder as context once. Any other value reads as `deny-once` and is reported once on stderr. The copy exists because a plain deny lost lessons in a measured run ([#282](https://github.com/Sumit1993/mage-memory/issues/282)). The secret scan fails closed in both modes. `notes/.held/` is never indexed; `mage groom` lists it. See [Capture](../loop/capture.md).

Notes must also satisfy three readability rules ([#253](https://github.com/Sumit1993/mage-memory/issues/253)): length under 40 lines and 350 words, self-contained references with no unlinked documents, and plain words with no unslop words or em dashes. Readability findings are warnings. They never exclude a note from the roster and never fail `--strict-admission`; admission problems under `notes/` do.

A failing note, saved as `notes/failing.md`, from a real run:

```markdown
---
id: repo/rule/mismatch
rung: note
trigger:
  match: ["Read(x)"]
---
# Failing note

Consult section 12.3 for details.
```

```console
$ mage index
notes/failing.md
  id: id middle segment "rule" does not match rung "note" (line 2)
  trigger: trigger must be a non-empty string, or a mapping with a non-empty when (line 4)
  pointer: pointer is required (line null)
  self-contained: unlinked reference to "section 12.3" (line 9)
Total: 4 problem(s) (3 admission, 1 readability warning(s)) across 1 file(s).
✓ Indexed 4 note(s) across 0 wing(s) → 2 file(s) (flat).
  INDEX.md
  MEMORY.md
Roster: 3 of 4 notes admitted; 2 recalled at the action.
$ echo $?
0
$ mage index --strict-admission
...same report...
$ echo $?
1
```

A missing field reports `line null`. Under `--strict-admission` nothing is written.

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
