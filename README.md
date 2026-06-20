<p align="center">
  <img src="assets/mage-mark.svg" alt="mage" width="120" />
</p>

# mage

> **Durable memory for AI coding agents — portable markdown notes you own,
> navigable as an Obsidian graph.**

> **M**emory for **AGE**nts. A portable, file-based, self-maintaining knowledge
> base for software systems: durable git-backed markdown **notes** that capture
> insight, procedure, and **pointers** to sources — never copies of sources —
> navigable as an Obsidian graph and usable by any AI coding agent.

[![CI](https://github.com/Sumit1993/mage-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/Sumit1993/mage-memory/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mage-memory?style=flat&logo=npm)](https://www.npmjs.com/package/mage-memory)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)
![Node](https://img.shields.io/badge/Node-%3E%3D20-339933?style=flat&logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?style=flat)
![Status](https://img.shields.io/badge/status-pre--1.0-orange?style=flat)

<p align="center">
  <img src="assets/social-card.png" alt="mage — durable memory for AI coding agents" width="640" />
</p>

## Why mage

- **Files you own.** Every note is plain markdown in *your* git repo. No
  database, no lock-in, no export step — `cat`, `grep`, and `git log` all work.
- **Obsidian-native.** `mage/` ships an `.obsidian/` vault config; cross-links
  are relative markdown (`[text](path.md)`, never `[[wikilinks]]`), so notes
  render as a navigable graph **and** stay portable to any agent reading raw
  files.
- **No server.** Nothing to host, no daemon, no background process. mage rides
  the host agent's hooks; the dashboard is a generated artifact, not a service
  ([ADR-0020](mage/decisions/0020-no-server-tiered-dashboards.md)).
- **No telemetry — nothing leaves your machine.** mage never phones home. The
  only network egress is `doctor`'s opt-in connectivity check; metrics stay
  local and never enter git
  ([ADR-0021](mage/decisions/0021-offline-no-telemetry-local-signal.md)).
- **Self-grooming, human-in-the-loop.** mage *proposes* (graduate / merge /
  reword …); **you** confirm and commit. Nothing is ever auto-committed.

### How mage differs from a server-backed memory store

mage was designed by mining the *idea* behind server-backed agent-memory tools
(durable memory that outlives a session) — not their mechanism. The contrast is
deliberate and factual:

| | mage | server-backed memory store |
|--|------|----------------------------|
| Source of truth | **Files in your repo** (markdown + git) | A running server / database |
| Curation | **Human-in-the-loop**: propose → confirm → *you* commit | Automatic writes / decay |
| Network | **Offline by default**; no telemetry | Typically server-hosted |
| Viewer | Generated `dashboard.html` + Obsidian | Live web console |

Same goal — memory that survives the session — reached by *file-as-truth +
offline + human-curated* rather than an automatic, server-shaped store.

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
`mage:` namespace. `mage init` prints the two install lines for you (it never
runs slash commands):

```text
/plugin marketplace add Sumit1993/mage-memory
/plugin install mage@mage
```

You get `mage:guide` (how to use the base), `mage:learn` (capture a note), and
the self-grooming skills `mage:groom`, `mage:graduate`, and `mage:optimize`.
Per-wing `mage-wing-*` skills are **generated** into `.claude/skills/` +
`.agents/skills/` by `mage skills`. Backfill existing docs with
`mage:learn --from <dir>`.

> The `mage:` namespace is a Claude Code feature. Other agents that read
> `.agents/skills/` directly will see bare skill names.

## Quickstart

```bash
# 1. Initialize a knowledge base inside this repo. This also auto-wires the
#    capture hooks + the redaction pre-commit gate (pass --no-connect to skip).
mage init --in-repo

# 2. Regenerate the always-loaded index
mage index

# 3. (Re)generate the per-wing skills so agents discover this knowledge base
mage skills
```

You rarely hand-write notes: in Claude Code, say **`mage:learn`** (or "remember
this") right after you figure something out, and mage drafts the note — insight
+ procedure + pointers — and writes it only once you confirm. You can also author
one by hand — `mage/notes/billing/payments.md`:

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

## Documentation

The full, navigable manual — **generated from this code and drift-tested in CI**,
so the reference can't silently diverge from the implementation — lives at the
**[mage documentation site](https://sumit1993.github.io/mage-memory/)**:

- **[Start Here](https://sumit1993.github.io/mage-memory/)** — what mage is,
  install, and your first knowledge base.
- **[The Model](https://sumit1993.github.io/mage-memory/model/notes/)** — notes
  (insight + procedure + pointers), the graph (wings & rooms), and modes &
  storage.
- **[The Self-Grooming Loop](https://sumit1993.github.io/mage-memory/loop/overview/)**
  — how capture, the boundary nudge, stage & groom, promote & graduate, and
  optimize fit together, end to end.
- **[Reference](https://sumit1993.github.io/mage-memory/reference/commands/)** —
  every command, hook, and threshold, rendered from the code, plus the on-disk
  layout and the two redaction gates.

The site tracks the latest published release. `mage <command> --help` gives the
per-command flags from your installed version.

## mage never auto-commits

mage **never** runs git for you. It only **suggests** the exact `git` commands
in its output and lets you run them. Captured scratch and metrics are git-ignored
by design, so they never land in history — only the human-committed notes they
motivate do. The `mage:guide` skill teaches agents the same rule.

## Reporting issues

Hit a bug? Run **`mage doctor --report`** and attach the redacted bundle. It's a
**content-free** support snapshot — mage / Node / OS versions, KB + connection
health (including capture-sink ignore coverage), and metrics **summary numbers
only** — run through the redaction boundary, so it **never** carries note
content, keywords, paths, or secrets
([ADR-0021](mage/decisions/0021-offline-no-telemetry-local-signal.md)). Open
issues at [github.com/Sumit1993/mage-memory/issues](https://github.com/Sumit1993/mage-memory/issues).

## Status

Pre-1.0 and evolving — the note model, command surface, and skills reflect the
actual CLI. See the **npm badge** above for the current release, the
[CHANGELOG](CHANGELOG.md) for history, and the
[documentation site](https://sumit1993.github.io/mage-memory/) for the current
model. Expect refinement.

## License

MIT
