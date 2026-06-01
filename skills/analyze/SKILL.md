---
name: analyze
description: |
  Cross-artifact consistency + coverage analysis for a spec work unit. Reads the
  spec, plan, tasks notes (and optionally principle notes + existing code) and
  surfaces contradictions, missing coverage, and risks BEFORE /implement runs.
  One authoring path within a mage knowledge base. Adapted from github/spec-kit
  (MIT) — see ATTRIBUTION.md.
allowed-tools: Read, Glob, Grep, Bash
disable-model-invocation: true
---

<!-- Adapted from github/spec-kit (/analyze command), MIT licensed. See ATTRIBUTION.md. -->

# /analyze — cross-artifact consistency review

## Path resolution

mage is a file-based knowledge base; SDD is one authoring path within it, and a
spec is a **work unit** — a `work/<slug>/` lab notebook. Before reading any note
in a work unit, resolve the docs root for the current repo:

1. Find the nearest `mage/metadata.json` walking up from your current dir.
   If absent, abort: tell the user to run `mage init` first.
2. Parse it. Note `mode`, `project`, `hub_path`.
3. Compute docs root:
   - `mode == "in-repo"` → docs-root = `<repo>/mage/`
   - `mode == "external"` → docs-root = `<hub_path>/projects/<project>/mage/`
4. Treat a spec work unit as `<docs-root>/work/<NNN>-<name>/`; the spec, plan,
   and tasks notes live there.
5. Suggest commits, never auto-execute.

---

## What this skill does

Runs after `/tasks` and before `/implement`. Reads:
- The spec, plan, tasks notes for the target work unit
- Any relevant principle notes (e.g. `<docs-root>/notes/principles.md`)
- (Optionally) existing source code in the code repo

Surfaces:
- **Contradictions** between spec ↔ plan ↔ tasks
- **Missing coverage** — requirements without corresponding tasks
- **Principle violations** — places where plan/tasks contradict principle notes
- **Risks** — unaddressed failure modes, unhandled edge cases
- **Drift** — places where the code already differs from what the plan describes

Writes findings to an `analysis.md` note in the same work unit (recommend
frontmatter `type: note` and a `tags: [<wing>]` tag so it appears in `mage
index`). Does NOT modify the spec/plan/tasks — those updates are up to the user
(use `/specify`, `/plan`, or `/tasks` again to revise).

## When to invoke

- After `/tasks`, before `/implement` (recommended)
- After a major spec/plan revision, to recheck coherence
- Periodically during long-running implementations, to catch drift

## Workflow

1. **Identify the target work unit**. Find spec + plan + tasks at
   `<docs-root>/work/<NNN>-<name>/{spec,plan,tasks}.md`. Abort if any are
   missing (tell the user which command to run).

2. **Read** the relevant principle notes + all three artifacts.

3. **Build a checklist** of what to verify:

   ### Spec ↔ Plan
   - Does the plan address every user story from the spec?
   - Does the plan address every functional requirement?
   - Does the plan's tech stack contradict anything in the spec's constraints?
   - Does the plan introduce capabilities not in the spec? (scope creep)

   ### Plan ↔ Tasks
   - Does every plan component have at least one task?
   - Do any tasks contradict the plan's architecture?
   - Are observability requirements from the plan reflected in tasks?
   - Is the dependency order in tasks consistent with the plan?

   ### Spec ↔ Tasks
   - Does every acceptance criterion have a task that delivers it?
   - Does every "out of scope" item NOT have a task? (scope creep check)

   ### Principles ↔ all
   - Does any plan decision violate a principle note without
     explicit "exception with rationale"?
   - Do tasks include the testing discipline the principle notes require?

   ### Optional: Code ↔ Plan
   - If the code repo already has implementation, does it match the plan's
     architecture? Or has it drifted?

4. **Generate findings**. For each finding, classify by severity:
   - **BLOCKER**: must fix before `/implement` (e.g., contradictory contracts)
   - **WARNING**: should fix but `/implement` could proceed (e.g., missing test
     coverage for an edge case)
   - **NOTE**: informational (e.g., a non-obvious choice worth documenting)

5. **Write `<docs-root>/work/<NNN>-<name>/analysis.md`** with the structure below.

6. **Suggest the commit** (mage never auto-commits — it only suggests; the user
   runs the command, in the right repo: code repo for in-repo mode, hub for
   hub-owned notes):
   ```bash
   # mode=external example:
   git -C <hub_path> add projects/<project>/mage/work/<NNN>-<name>/analysis.md
   git -C <hub_path> commit -m "analyze: <NNN>-<name> for <project>"

   # mode=in-repo example:
   git -C <repo> add mage/work/<NNN>-<name>/analysis.md
   git -C <repo> commit -m "analyze: <NNN>-<name>"
   ```

7. **In chat output**, summarize the BLOCKER count up front. The user needs
   to decide whether to proceed to `/implement` or revise upstream artifacts.

## Analysis template

```markdown
# <Feature Name> — Cross-Artifact Analysis

**Work unit**: <NNN>-<name>
**Analyzed**: <ISO date>
**Verdict**: <READY | NEEDS FIXES BEFORE IMPLEMENT>

## Summary

- **Blockers**: <N>
- **Warnings**: <N>
- **Notes**: <N>

If Blockers > 0, do NOT proceed to /implement. Revise the upstream artifact.

## Blockers

### B-1: <one-line title>
- **Where**: <which files / sections>
- **Issue**: <description>
- **Suggested fix**: <which command to re-run, what to change>

(repeat per blocker)

## Warnings

### W-1: <one-line title>
- **Where**: ...
- **Issue**: ...
- **Suggested fix**: ...

## Notes

### N-1: <one-line title>
- ...

## Principle compliance

| Principle | Compliant? | Notes |
|-----------|:----------:|-------|
| I — <name> | ✓ / ✗ | ... |
| II — <name> | ✓ / ✗ | ... |

## Coverage matrix

| Requirement | Plan addresses it? | Task covers it? |
|-------------|:------------------:|:---------------:|
| FR-1 | ✓ | T-006 |
| FR-2 | ✓ | T-009 |
| FR-3 | ✗ | (none) — BLOCKER B-2 |
```

## Quality bar

A good analysis:
- Has a verdict up front (READY vs NEEDS FIXES)
- Each finding has a SPECIFIC location + a SPECIFIC fix
- Coverage matrix makes gaps visible at a glance
- Doesn't nitpick — every finding affects implementation
- Principle check is honest (no rubber-stamping)
