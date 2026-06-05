---
name: specify
description: |
  Define what you want to build — author a feature specification with user
  stories, requirements, success criteria. In mage, a spec is one type of WORK
  UNIT: it writes into the mage-managed work/ directory at the path resolved
  from the repo's mage mode. Adapted from github/spec-kit (MIT) — see ATTRIBUTION.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
disable-model-invocation: true
---

<!-- Adapted from github/spec-kit (mage:specify command), MIT licensed. See ATTRIBUTION.md. -->

# mage:specify — author a feature specification

Spec-Driven Development is one authoring path within mage, a portable file-based
knowledge base. A spec is just one note type — a `work/<slug>/` lab notebook
that captures WHAT we want to build. The encyclopedia (`notes/`), decisions
(`decisions/`), and other work units sit alongside it; the spec is not the center.

## Path resolution (added by mage)

Before reading or writing any file referenced as `.specify/...`, `work/...`, or
similar relative path in this skill, resolve the docs root for the current repo:

1. Find the nearest `mage/metadata.json` walking up from your current dir.
   If absent, abort: tell the user to run `mage init` first.
2. Parse it. Note `mode`, `project`, `hub_path`.
3. Compute docs root:
   - If `mode == "in-repo"`: docs-root = `<code-repo>/mage/`
   - If `mode == "external"`: docs-root = `<hub_path>/projects/<project>/mage/`
4. Everywhere this skill references `work/<slug>/`, treat it as
   `<docs-root>/work/<slug>/`.
5. After writing, suggest the commit per the `mage` skill's commit-hygiene
   rules — NEVER auto-execute. mage never auto-commits.

---

## What this skill does

Authors a **feature specification** as a mage work unit (`work/<slug>/`, a
task-scoped lab notebook). A spec is the human-language description of WHAT
we're building — distinct from HOW (which is the `mage:plan` skill). The files it
produces are mage notes; tag them so they appear in `mage index`.

## When to invoke

The user types `mage:specify <description>` to start working on a new feature, or
to fully document an existing one before planning implementation.

## Workflow

1. **Get the feature description** from the user's invocation arguments. If empty,
   ask.

2. **Generate a short feature name** (2-4 words, kebab-case) for the work-unit slug.

3. **Determine the next work-unit number** by scanning `<docs-root>/work/` for
   existing `<NNN>-<name>/` directories and picking `NNN+1` (zero-padded to 3 digits).

4. **Create the work-unit directory**: `<docs-root>/work/<NNN>-<name>/`.

5. **Author `<docs-root>/work/<NNN>-<name>/spec.md`** using the template below.
   Recommend frontmatter `type: spec` and a `tags: [<wing>]` tag so the note
   appears in `mage index`. Read the constitution at
   `<docs-root>/notes/principles.md` first if present — the spec
   must align with its principles.

6. **Suggest the commit** — mage never auto-commits, it only suggests. Pick the
   right repo: the code repo for `in-repo`, the hub for `external`:
   ```bash
   # mode=in-repo example (commit in the code repo):
   git -C <code-repo> add mage/work/<NNN>-<name>/
   git -C <code-repo> commit -m "spec: <NNN>-<name>"

   # mode=external example (commit in the hub):
   git -C <hub_path> add projects/<project>/mage/work/<NNN>-<name>/
   git -C <hub_path> commit -m "spec: <NNN>-<name> for <project>"
   ```

## Spec template

```markdown
---
type: spec
tags: [<wing>]
status: active
created: <ISO date>
updated: <ISO date>
---

# <Feature Name>

**Work unit**: <NNN>-<name>
**Status**: Draft
**Created**: <ISO date>

## Problem statement

<1-3 sentences. What user-facing problem does this solve, or what capability
does it add?>

## User stories

### Story 1 — <short title> (Priority: P1)

> As a <user type>, I want <action> so that <outcome>.

**Acceptance criteria**:
- ...
- ...

### Story 2 — <short title> (Priority: P2)

> As a <user type>, I want <action> so that <outcome>.

**Acceptance criteria**:
- ...

## Functional requirements

- FR-1: <unambiguous, testable statement of what the system must do>
- FR-2: ...

## Non-functional requirements

- Performance: <target>
- Security: <constraints>
- Observability: <what must be logged/metric'd>

## Out of scope

- <Things this feature explicitly does NOT do, to bound the design.>

## Success criteria

- <How we know this is done. Measurable.>
- <How we know it's adopted/used.>

## Open questions

- <Things to clarify before mage:plan. Use mage:clarify to resolve these.>

## Assumptions

- <Things being taken as true without verification.>
```

## Quality bar

A good spec:
- Says WHAT, not HOW. Implementation choices belong in `mage:plan`.
- Has acceptance criteria you can write tests against.
- Lists "out of scope" explicitly — bounds the design.
- Has open questions called out at the bottom so `mage:clarify` can resolve them.
- References the constitution by principle number where relevant.

## Common mistakes to avoid

- **Conflating spec and plan**: if you find yourself naming libraries or
  algorithms, that belongs in `mage:plan`. Spec is user-facing.
- **Skipping out-of-scope**: agents over-deliver without it. Be explicit.
- **Vague success criteria**: "users like it" isn't measurable. "p99 latency
  < 300ms for the /search endpoint at 1k req/s" is.
