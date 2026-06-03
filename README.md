# mage

> **M**emory for **AGE**nts. A portable, file-based, self-maintaining knowledge
> base for software systems: durable git-backed markdown **notes** that capture
> insight, procedure, and **pointers** to sources — never copies of sources —
> navigable as an Obsidian graph and usable by any AI coding agent.

[![npm](https://img.shields.io/npm/v/mage-memory?style=flat&logo=npm)](https://www.npmjs.com/package/mage-memory)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)
![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=flat&logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?style=flat)
![Status](https://img.shields.io/badge/status-v0.1-orange?style=flat)

## What it does

The hard-won knowledge about a software system — what an interface expects, why
a decision was made, how two services connect, the exact way to call them, the
gotcha that wasted an afternoon — never lives in one place. It scatters across
in-repo `docs/`, out-of-repo wikis, ticket comments, and an agent's transient
chat history, then gets cleaned up, rewritten, or simply lost the moment the
task is done. mage gives that knowledge one **durable, portable, discoverable
home**. Each note records the reusable **insight** (verbatim — don't
oversimplify), the **procedure** (how to do it faster next time; which commands
to avoid and why), and **pointers** to where the canonical source lives and when
to go read it. The goal is to *do it faster and make fewer mistakes next time* —
not to archive what you already read.

## Install

```bash
# Install the CLI globally — exposes the `mage` command
npm i -g mage-memory

# Install the portable skills into your agent harness
# (.claude/skills, .agents/skills, etc. — works across 15+ agents)
npx skills add github:Sumit1993/mage-memory
```

The skills installer adds the **awareness** skill (`mage`), the **capture**
skill (`mage-learn`), and any **per-wing** skills generated for your knowledge
base. To remove them later: `npx skills remove github:Sumit1993/mage-memory`.

## Quickstart

```bash
# 1. Initialize a knowledge base inside the current repo
mage init --in-repo

# 2. Add a note under mage/notes/ tagged #wing/room (see example below)

# 3. Regenerate the always-loaded index
mage index

# 4. (Re)generate the per-wing skills so agents discover this knowledge base
mage skills
```

A tiny note — `mage/notes/billing/payments.md`:

```markdown
---
type: interface
tags: [billing/payments]
created: 2026-06-01
updated: 2026-06-01
sources:
  - https://github.com/acme/billing/blob/main/src/charge.ts#L40
  - file:src/charge.ts:40
status: active
---

# Charging a customer

## Insight
`charge()` is idempotent **only** when you pass an `idempotency_key`. Without
it, a retried request double-charges. The key must be unique per logical charge,
not per HTTP attempt.

## Procedure
- Generate the key once, upstream, and thread it through retries.
- Do NOT regenerate the key inside the retry loop — that defeats idempotency.

## Relations
- depends_on [payments-gateway](../infra/payments-gateway.md)
```

Everything in the frontmatter is optional; mage degrades gracefully when it's
missing and falls back to the title, headers, and tags. Links between notes are
standard portable markdown — `[text](relative/path.md)` — **never**
`[[wikilinks]]`, so they render as Obsidian graph edges and stay portable across
agents.

## The model

| Term | Meaning |
|------|---------|
| **knowledge base** | The `mage/` tree: notes, work units, decisions, archive, and the generated index. |
| **note** | A durable markdown file (with optional YAML frontmatter) recording insight + procedure + pointers on one topic. |
| **wing** | A top-level scope — a project, repo, service, or person. The first tag segment (`billing/payments` → wing `billing`). **Optional**: untagged notes are valid (they index as *Cross-cutting*). A note can carry several tags and is indexed under **each** wing (multi-home); the first is its primary wing. |
| **room** | A topic within a wing. The second tag segment (`billing/payments` → room `payments`). |
| **index** | The generated, always-loaded map of the knowledge base (`mage/INDEX.md`). Run `mage index`; never hand-edit. |
| **work unit** | A task-scoped "lab notebook" under `mage/work/<slug>/` with a `type` (spec, investigation, incident, spike, ...). |
| **artifact** | Scratch output inside a work unit's `artifacts/` subdir. Git-ignored — never committed. |
| **skill** | An auto-discovered agent capability (a folder with `SKILL.md`) that teaches agents how to use this knowledge base. |

## Layout (in-repo mode)

```text
mage/
├── notes/              durable topic notes (the "encyclopedia")
├── work/<slug>/        task-scoped "lab notebook" work units
│   └── artifacts/      scratch output (git-ignored)
├── decisions/          ADR-style decision notes
├── archive/            retired notes
├── INDEX.md            GENERATED always-loaded index (run `mage index`)
├── _index.<wing>.md    GENERATED per-wing index (hierarchical mode) — reserved name
├── .obsidian/          Obsidian vault config
└── metadata.json       schema "mage.v1"; mode "in-repo" | "external"
```

The scanner recurses the **whole** vault and indexes every note except a fixed
skip-set (`.obsidian/`, `.git/`, `node_modules/`, `artifacts/`, `.learnings/`,
`archive/`) and mage's own generated/scaffolding files (`INDEX.md`,
`_index.*.md`, `AGENTS.md`, `CLAUDE.md`, `IDENTITY.md`) — so "folders are
conventions" is literal. A hub's `projects/<name>/` notes are indexed for free.

### Note frontmatter (all optional)

- `type` — open vocabulary; defaults to `note`. Common values: `interface`,
  `tooling`, `topology`, `relationship`, `playbook`, `gotcha`, `pointer`,
  `trail`, `decision`, `spec`, `plan`, `tasks`, `principle`, `note`.
- `tags` — `[wing/room]` nested scoping, stored **without** the leading `#`.
- `created` / `updated` / `last_reviewed` — ISO dates.
- `provenance` — `{ repo, commit, work }`.
- `sources` — pointers to canonical sources (`url | ticket | file:line`), never
  copies.
- `status` — `active | stale-suspect | superseded | archived`.
- `keywords` — optional; the index falls back to title + headers + tags.

Typed relations between notes go in a `## Relations` section, e.g.
`- depends_on [payments](billing/payments.md)`.

## Commands

| Command | Purpose |
|---------|---------|
| `mage init [name]` | Create a knowledge base. No name → detect: in a git repo, an in-repo `mage/`; otherwise a standalone hub in the current dir. A `name`/path → a hub there (like `git init`). Force with `--in-repo` / `--hub`. |
| `mage index` | Regenerate the always-loaded index (and per-wing indexes in hierarchical mode). Never hand-edit the output. |
| `mage skills` | (Re)generate the per-wing `mage-wing-<x>` skills so agents discover this knowledge base. |
| `mage dream` | Report knowledge-base health, read-only: stale, superseded-but-active, dangling links, orphan notes. |
| `mage link <hub>` | Register this repo's knowledge base with an external hub (hybrid). |
| `mage unlink` | Remove a hub linkage. |
| `mage verify` | Sanity-check structure, frontmatter, and links. |
| `mage list` | List notes / work units in the knowledge base. |
| `mage status` | Report knowledge-base health and pending changes. |
| `mage doctor` | Diagnose the environment (Node, git, Obsidian config, skills install). |

Run `mage <command> --help` for per-command flags.

## Modes

- **in-repo** — the knowledge base lives in `mage/` inside the code repo,
  committed alongside the code it describes. `metadata.json` has
  `mode: "in-repo"`.
- **hub** — a standalone repo *is* one Obsidian vault spanning several projects.
  Create it with `mage init <name>` (no code repo required), then `mage link`
  code repos into it. A hub-owned project's notes live **flat** at
  `<hub>/projects/<name>/`, surfaced as a wing; the code repo's `AGENTS.md`
  routes agents to `<hub>/_index.<project>.md`.
- **hybrid** (in-repo member) — an in-repo knowledge base that also registers
  with a hub (`mage init --in-repo`, then `mage link <hub>`). Notes stay with the
  code; the hub lists the member as a **pointer** to its repo's `INDEX`
  (`storage: in-repo`), never silently empty.

> `--external` is a deprecated alias of `--hub`.

## Skills

Skills are auto-discovered from the repo-root `skills/` directory. Each is a
folder containing a `SKILL.md` whose frontmatter carries a `name` and
`description`.

| Skill | Purpose |
|-------|---------|
| `mage` | Awareness — teaches agents to detect `mage/`, read the index first, capture by pointer, and never auto-commit. |
| `mage-learn` | Capture a durable note (insight + procedure + pointers) from the work just done. |
| `mage-wing-<x>` | Per-wing skill generated by `mage skills`, scoped to one wing's rooms. |

The carried spec-driven-development authoring skills also ship with the package.

## Obsidian-native

`mage/` ships with an `.obsidian/` vault config — open the folder directly in
Obsidian and your notes become a navigable graph. Because every cross-link is a
relative markdown link (`[text](path.md)`, never `[[wikilink]]`), the same links
that render as graph edges in Obsidian stay valid for any agent reading the raw
files.

## mage never auto-commits

mage **never** runs git for you. It only **suggests** the exact `git` commands
in its output and lets you run them. Work-unit `artifacts/` directories are
git-ignored by design, so scratch output never lands in history. The `mage`
awareness skill teaches agents the same rule.

## Status

v0.0.2. Early and evolving — the note model, command surface, and skill bundle
are documented here and reflect the actual CLI. 0.0.2 makes the scanner recurse
the whole vault (hub `projects/` are indexed), generalizes wings (optional,
multi-home), and adds a detection-first `mage init` with standalone hubs. Expect
refinement.

## License

MIT
