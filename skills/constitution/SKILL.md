---
name: constitution
description: |
  Create or update the project's governing principles — the guardrails that
  guide every spec, plan, and implementation decision in this project. Authors a
  durable `type: principle` NOTE into the mage knowledge base (e.g.
  notes/principles.md) at the docs root resolved from the repo's mage mode.
  Adapted from github/spec-kit (MIT) — see ATTRIBUTION.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
disable-model-invocation: true
---

<!-- Adapted from github/spec-kit (mage:constitution command), MIT licensed. See ATTRIBUTION.md. -->

# mage:constitution — establish or amend the project's governing principles

## Path resolution

mage is a file-based knowledge base; SDD is one authoring path within it. The
"constitution" is just a durable principle NOTE in the knowledge base — no
special `.specify/memory/` path. Before reading or writing, resolve the docs
root for the current repo:

1. Find the nearest `mage/metadata.json` walking up from your current dir.
   If absent, abort: tell the user to run `mage init` first.
2. Parse it. Note `mode`, `project`, `hub_path`.
3. Compute docs root:
   - If `mode == "in-repo"`: docs-root = `<repo>/mage/`
   - If `mode == "external"`: docs-root = `<hub_path>/projects/<project>/mage/`
4. Author the principles as a `type: principle` NOTE at
   `<docs-root>/notes/principles.md` (or another descriptive filename under
   `<docs-root>/notes/`). Give it `tags: [<wing>]` so it appears in `mage index`.
5. After writing, suggest the commit per the `mage` skill's commit-hygiene
   rules — NEVER auto-execute.

---

## What this skill does

Establishes or updates the project's **governing principles** — a small note of
guardrails (code-quality standards, testing discipline, architectural
guardrails, performance budgets, etc.) that all subsequent specs, plans, and
tasks must respect. In mage this is an ordinary durable note (`type: principle`)
in the knowledge base — other notes reference it by relative markdown link
(e.g. `[principles](../notes/principles.md)`) rather than by a constitution path.

## When to invoke

- Starting a new project that doesn't yet have a principle note at
  `<docs-root>/notes/principles.md`
- Amending existing principles (the user has decided on a new constraint)
- Reviewing the principles against the current codebase to surface drift

## Workflow

1. **Read the existing principle note** if present at
   `<docs-root>/notes/principles.md`. If absent, this is a new note — create it.

2. **Gather the principles**. Use the user's input plus what you can infer from:
   - The project's README and code
   - Existing ADRs in `<docs-root>/decisions/`
   - Related principle/topic notes already in `<docs-root>/notes/`

3. **Structure the note** with frontmatter then these sections:
   - **Frontmatter**: `type: principle`, `tags: [<wing>]`, `created`/`updated`
     ISO dates
   - **Title + version**: e.g., "my-api Principles v1.0.0"
   - **Ratification date + last-amended date**: ISO dates
   - **Principles**: numbered, each with a description and rationale
   - **Governance**: how amendments happen, who decides, versioning policy

4. **Use semantic versioning** for the principle note itself:
   - MAJOR: backward-incompatible principle removals or redefinitions
   - MINOR: new principles added, materially expanded guidance
   - PATCH: clarifications, wording, typo fixes

5. **Propagation check** (after writing). Re-read any spec work units under
   `<docs-root>/work/<NNN>-<name>/` and any reusable note templates the project
   keeps. Ensure none contradict the updated principles. Flag conflicts and
   suggest re-running `mage:plan` or `mage:tasks` where they do.

6. **Suggest the commit** (mage never auto-commits — it only suggests; the user
   runs the command, in the right repo: code repo for in-repo mode, hub for
   hub-owned notes):
   ```bash
   # If mode=external:
   git -C <hub_path> add projects/<project>/mage/notes/principles.md
   git -C <hub_path> commit -m "principles: <one-line summary of change>"

   # If mode=in-repo:
   git -C <repo> add mage/notes/principles.md
   git -C <repo> commit -m "principles: <one-line summary of change>"
   ```
   Then suggest `mage index` so the note shows up in `<docs-root>/INDEX.md`.

## Principle note template (minimal)

```markdown
---
type: principle
tags: [<wing>]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# <Project Name> Principles

**Version**: <MAJOR>.<MINOR>.<PATCH>
**Ratified**: <YYYY-MM-DD>
**Last amended**: <YYYY-MM-DD>

## Core Principles

### I. <Principle Name>

<Description in 2-4 sentences. State the principle clearly, then state WHY.>

### II. <Principle Name>

<...>

## Governance

- Amendments require: <criteria>
- Version policy: semantic versioning per the rules above
- Compliance review: <when, by whom>
```

## Quality bar

A good principle note:
- Has 3-7 principles (not 1, not 20)
- Each principle is actionable (an agent can check "does this design violate principle II?")
- Each principle has a clear WHY (so future-you can judge edge cases)
- Carries `type: principle` frontmatter + a `tags: [<wing>]` tag so `mage index` picks it up
- Stays under ~500 lines total
