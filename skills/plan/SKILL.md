---
name: plan
description: |
  Translate a feature spec into a technical implementation plan — tech stack,
  architecture, data flow, key contracts, sequencing. Writes plan.md alongside
  the spec inside the same mage work unit. Adapted from github/spec-kit (MIT)
  — see ATTRIBUTION.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
disable-model-invocation: true
---

<!-- Adapted from github/spec-kit (mage:plan command), MIT licensed. See ATTRIBUTION.md. -->

# mage:plan — derive a technical implementation plan from a spec

Spec-Driven Development is one authoring path within mage, a portable file-based
knowledge base. The plan is a note (`type: plan`) living in the same
`work/<slug>/` lab notebook as the spec it derives from.

## Path resolution (added by mage)

Before reading or writing any file referenced as `.specify/...`, `work/...`, or
similar relative path in this skill, resolve the docs root for the current repo:

1. Find the nearest `mage/metadata.json` walking up from your current dir.
   If absent, abort: tell the user to run `mage init` first.
2. Parse it. Note `mode`, `project`, `hub_path`.
3. Compute docs root:
   - `mode == "in-repo"` → docs-root = `<code-repo>/mage/`
   - `mode == "external"` → docs-root = `<hub_path>/projects/<project>/mage/`
4. Treat `work/<slug>/` references as `<docs-root>/work/<slug>/`.
5. Suggest commits, never auto-execute. mage never auto-commits.

---

## What this skill does

Reads a spec and the constitution, then authors `plan.md` alongside it in the
same work unit. The plan covers the HOW: tech stack, architecture, data flow,
contracts, sequencing.

## When to invoke

- After `mage:specify` and (recommended) `mage:clarify`
- When pivoting an existing plan in response to new constraints

## Workflow

1. **Identify the target work unit**. If invoked with a name/number, use that.
   Otherwise list `<docs-root>/work/*/` and prompt.

2. **Read the spec** (`spec.md`) and the **constitution** in full. Note any
   `(unresolved)` questions — if present, abort and tell the user to run
   `mage:clarify` first.

3. **Phase 0 — Outline & research**. Identify what needs to be decided:
   - Tech stack pieces not yet chosen
   - External dependencies / services to integrate
   - Performance / scalability concerns
   - Security concerns
   
   Generate a brief research summary that picks specific options for each open
   tech decision. **Justify each pick** against the constitution.

4. **Phase 1 — Design & contracts**. Author:
   - High-level architecture (components + their responsibilities)
   - Data model (key entities, relationships, where state lives)
   - API contracts (endpoints, payloads, error cases)
   - Critical sequences (auth flow, ingest flow, etc.)
   - Observability strategy (what logs/metrics/traces this needs)

5. **Constitution check**. For each principle in the constitution, state how
   this plan complies. Flag exceptions explicitly with rationale.

6. **Complexity tracking**. List anything that's borderline-overengineered
   (third-party deps, abstractions, etc.) with a 1-line justification per item.

7. **Write `<docs-root>/work/<NNN>-<name>/plan.md`** with the structure below.
   Recommend frontmatter `type: plan` and a `tags: [<wing>]` tag (matching the
   spec's wing) so the note appears in `mage index`.

8. **Suggest the commit** — mage never auto-commits, it only suggests. Pick the
   right repo: the code repo for `in-repo`, the hub for `external`:
   ```bash
   # mode=in-repo example (commit in the code repo):
   git -C <code-repo> add mage/work/<NNN>-<name>/plan.md
   git -C <code-repo> commit -m "plan: <NNN>-<name>"

   # mode=external example (commit in the hub):
   git -C <hub_path> add projects/<project>/mage/work/<NNN>-<name>/plan.md
   git -C <hub_path> commit -m "plan: <NNN>-<name> for <project>"
   ```

## Plan template

```markdown
---
type: plan
tags: [<wing>]
status: active
created: <ISO date>
updated: <ISO date>
---

# <Feature Name> — Implementation Plan

**Work unit**: <NNN>-<name>
**Spec**: ./spec.md
**Status**: Draft
**Created**: <ISO date>

## Summary

<2-3 sentences. What we're building (from spec) + how (one-line architecture summary).>

## Technical context

- Languages / runtimes:
- Frameworks:
- Storage:
- External services:
- Deployment target:

## Constitution check

For each principle in `<docs-root>/notes/principles.md`:
- **Principle I (<name>)**: <how this plan complies, OR explicit exception with rationale>
- **Principle II (<name>)**: ...

## Phase 0 — Decisions

### Tech-stack pick: <area>
- **Picked**: <option>
- **Considered**: <alternatives>
- **Rationale**: <why>

(repeat per open decision)

## Phase 1 — Design

### Architecture
<components + responsibilities + diagram if useful>

### Data model
<entities, relationships, where state lives>

### Contracts
<API endpoints / message schemas / event shapes>

### Critical sequences
<numbered steps for the 2-3 most important flows>

### Observability
<what gets logged, metric'd, traced, alerted>

## Work-unit structure (this feature's files)

- `<docs-root>/work/<NNN>-<name>/spec.md` — the spec
- `<docs-root>/work/<NNN>-<name>/plan.md` — this file
- `<docs-root>/work/<NNN>-<name>/tasks.md` — generated by `mage:tasks`
- `<docs-root>/work/<NNN>-<name>/analysis.md` — generated by `mage:analyze` (optional)
- `<docs-root>/work/<NNN>-<name>/artifacts/` — scratch/large outputs (git-ignored)

## Source code (repository root)

- `src/<area>/...` — <what lives here>
- `tests/<area>/...` — <what lives here>

## Complexity tracking

| Concern | Why it's here | Mitigation |
|---------|---------------|-----------|
| ... | ... | ... |

## Risks & open questions

- <Risks the plan accepts, with mitigation strategy.>
- <Anything still unresolved despite mage:clarify — should usually be empty.>
```

## Quality bar

A good plan:
- Picks specific tech and justifies each pick against the constitution
- Has at least one architecture sketch (text is fine; Mermaid is better)
- Lists what observability looks like — not after-the-fact
- Acknowledges complexity explicitly rather than hiding it
- Is short enough that the user can read it in 10 minutes
