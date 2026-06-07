# mage

> **M**emory for **AGE**nts. A portable, file-based, self-maintaining knowledge
> base for software systems: durable git-backed markdown **notes** that capture
> insight, procedure, and **pointers** to sources — never copies of sources —
> navigable as an Obsidian graph and usable by any AI coding agent.

[![npm](https://img.shields.io/npm/v/mage-memory?style=flat&logo=npm)](https://www.npmjs.com/package/mage-memory)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)
![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=flat&logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?style=flat)
![Status](https://img.shields.io/badge/status-0.0.6-orange?style=flat)

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
```

mage's skills ship as a **Claude Code plugin** so they group under a clean
`mage:` namespace. Install the whole group:

```text
/plugin marketplace add Sumit1993/mage-memory
/plugin install mage@mage
```

You get `mage:learn` (capture a note), `mage:guide` (how to use the base), and the
`mage:specify` · `mage:clarify` · `mage:plan` · `mage:tasks` · `mage:implement` ·
`mage:analyze` · `mage:constitution` spec-driven-development workflow. `mage init`
prints these two lines for you (it never runs slash commands). Per-wing
`mage-wing-*` skills are still **generated** into `.claude/skills/` + `.agents/skills/`
by `mage skills`. Backfill existing docs/skills with `mage:learn --from <dir>`.

> The `mage:` namespace is a Claude Code feature. Other agents that read
> `.agents/skills/` directly will see bare skill names.

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
├── .learnings/         GENERATED capture scratch (git-ignored; `mage observe`)
├── .metrics/           GENERATED context-match rollup (git-ignored; `mage skills --metrics`)
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
| `mage skills` | (Re)generate the per-wing `mage-wing-<x>` skills into `.claude/skills/` + `.agents/skills/` so agents discover this knowledge base. `mage skills --metrics` prints the read-only context-match report (`--json`, `--quiet`). |
| `mage ingest <dir>` | Enumerate + classify ingestable sources under `<dir>` (read-only) — what `mage:learn --from` distills into notes. |
| `mage observe` | Hook-fired capture seam: read a Claude Code hook event on stdin and append one normalized event to `.learnings/` (plumbing — wired by `mage connect`, not run by hand; never blocks the host). |
| `mage connect` / `mage disconnect` | Opt-in: wire (or remove) mage's capture hooks in `.claude/settings.local.json` (`--user` for `~/.claude/settings.json`). Idempotent, backs up to `.bak`, refuses malformed JSON. |
| `mage redact <file>` | Scan/strip secrets from a file or stdin — redaction Gate 2 before a note/skill is written. |
| `mage dream` | Report knowledge-base health, read-only: stale, superseded-but-active, dangling links, orphan notes. |
| `mage link <hub>` | Register this repo's knowledge base with an external hub (hybrid). |
| `mage unlink` | Remove a hub linkage. |
| `mage verify` | Sanity-check structure, frontmatter, and links. |
| `mage list` | List notes / work units in the knowledge base. |
| `mage status` | Report knowledge-base health and pending changes. |
| `mage doctor` | Diagnose the environment (Node, git, Obsidian config, skills install). |

Run `mage <command> --help` for per-command flags.

## Auto-capture (opt-in)

From 0.0.5–0.0.6 mage can **learn from what agents actually do** — with no server
and no background process. It rides the host agent's **hooks**:

- **`mage observe`** is a hook-fired seam that turns one Claude Code hook event
  into one normalized line in a git-ignored `mage/.learnings/<session>.jsonl`
  scratch — a *salient extract* (which tool, which files, which skill loaded, the
  prompt's intent), **never a transcript copy**. Free-text fields are scrubbed at
  capture (redaction **Gate 1** — fail-open, it never blocks the host).
- **`mage connect`** wires those hooks into Claude Code's gitignored, per-repo
  `.claude/settings.local.json` (or `~/.claude/settings.json` with `--user`).
  It's **strictly opt-in** — capture is *not* bundled with the skills plugin —
  idempotent, `.bak`-safe, and refuses to touch malformed JSON. `mage disconnect`
  removes exactly what it added.
- **`mage skills --metrics`** reports **context-match**, read-only: when a skill
  auto-loaded, did the work that followed actually touch its wing/keywords? The
  tally lives in a git-ignored `mage/.metrics/` rollup that outlives the scratch
  purge. It only *flags* a weak trigger — it never edits a skill.

The `.learnings/` schema is harness-neutral, so other agents become additive
capture adapters later; Claude Code ships first. **Metrics and raw capture never
enter git** — only the human-committed notes they motivate do.

### Redaction — two gates

mage scrubs secrets and PII at every write that could escape the machine.
**Gate 1** is the fast scrub at capture (`mage observe` → `.learnings/`,
fail-open); **Gate 2** (`mage redact`) is a stronger deterministic scan at the
commit boundary, where a miss becomes shared. The detector covers private keys,
cloud and provider tokens (AWS, GitHub, GitLab, Stripe, Google, npm, OpenAI,
Anthropic), JWTs, bearer tokens, `KEY=VALUE` / env-style secrets, high-entropy
blobs, and emails.

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

mage's hand-authored skills ship as a **Claude Code plugin** (`.claude-plugin/`,
marketplace `mage`); the plugin namespace groups them as `mage:<name>` so the names
stay clean. Install the group with `/plugin marketplace add Sumit1993/mage-memory`
then `/plugin install mage@mage` (`mage init` prints both lines).

| Installed as | Purpose |
|-------|---------|
| `mage:guide` | Awareness — teaches agents to detect `mage/`, read the index first, capture by pointer, and never auto-commit. |
| `mage:learn` | Capture a durable note (insight + procedure + pointers) from the work just done; `mage:learn --from <dir>` bulk-imports existing docs/skills. |
| `mage:specify` … `mage:constitution` | The spec-driven-development workflow (`specify`, `clarify`, `plan`, `tasks`, `implement`, `analyze`, `constitution`). |
| `mage-wing-<x>` | Per-wing skill **generated** by `mage skills` into `.claude/skills/` + `.agents/skills/`, scoped to one wing's rooms. |

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

v0.0.6. Early and evolving — the note model, command surface, and skills here
reflect the actual CLI. Recent releases:

- **0.0.6** — `mage connect` / `mage disconnect` (opt-in host-hook adapter) +
  read-only context-match metrics (`mage skills --metrics`, `mage/.metrics/`
  rollup) + a dedicated Anthropic-key redaction detector.
- **0.0.5** — `mage observe`, the hook-fired capture seam
  (`.learnings/*.jsonl`) + redaction **Gate 1** (scrub at capture).
- **0.0.4** — `mage ingest`: deterministic enumeration of ingestable sources
  behind `mage:learn --from`.
- **0.0.3** — skills ship as a Claude Code **plugin** (the `mage:` namespace) +
  `mage redact` (Gate 2, ADR-0014).
- **0.0.2** — the scanner recurses the whole vault (hub `projects/` indexed),
  wings generalized (optional, multi-home), detection-first `mage init` + hubs.

Expect refinement.

## License

MIT
