---
name: implement
description: |
  Execute the tasks for a spec work unit, working through them in dependency
  order. Reads the spec, plan, tasks notes and any principle notes; suggests
  commits at meaningful milestones (never auto-commits). One authoring path
  within a mage knowledge base. Adapted from github/spec-kit (MIT) — see
  ATTRIBUTION.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
disable-model-invocation: true
---

<!-- Adapted from github/spec-kit (mage:implement command), MIT licensed. See ATTRIBUTION.md. -->

# mage:implement — execute tasks for a spec work unit

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

Reads the spec + plan + tasks notes (and optionally analysis.md), then
implements the work unit by working through tasks in dependency order. Writes
code in the code repo, ticks off completed tasks in `tasks.md`, and suggests
commits at meaningful boundaries.

## When to invoke

After `mage:tasks` (and ideally `mage:analyze`). Before any code work for the work unit.

## Workflow

1. **Identify the target work unit**. Find spec + plan + tasks at
   `<docs-root>/work/<NNN>-<name>/`. Abort if any are missing.

2. **Read** all four notes (spec, plan, tasks, optional analysis) + any relevant
   principle notes (e.g. `<docs-root>/notes/principles.md`).

3. **Check analysis**. If `analysis.md` exists and has `BLOCKER`s, refuse to
   implement until they're resolved. Tell the user to revise + re-run `mage:analyze`.

4. **Resolve docs-root vs code-repo**. mage notes live in the docs root (could
   be in the code repo or a separate hub). The code you'll write lives in the
   code repo — `<code_repo_path>` from the metadata. These may be the same
   directory (in-repo mode) or different (external mode).

5. **Pick the next task**. Order:
   - Phase 1 (Setup) tasks first
   - Then Phase 2 (Foundational)
   - Then Phase 3+ (user stories, in priority order)
   - Within a phase, respect explicit dependencies (`T-006 depends on T-003`)
   - Use `[P]` tasks for legitimate parallelism (only when they don't touch
     overlapping files)

6. **For each task**:
   a. Read the relevant existing code in the code repo (if any)
   b. Implement the change, following the project's principle notes
   c. Run any relevant tests / linters / type checkers locally if you can
   d. **Tick the task** in `<docs-root>/work/<NNN>-<name>/tasks.md` (change
      `- [ ]` to `- [x]`)
   e. Move to the next task

7. **Suggest commits** at meaningful boundaries (end of a phase, end of a
   user story, after a logical group of related tasks). Don't suggest one
   commit per task — that's too noisy. Don't suggest one giant commit for
   everything — that's too coarse.

   mage never auto-commits — it only SUGGESTS git commands; the user runs them.
   For each suggested commit, separate code repo writes from mage-notes writes:

   ```bash
   # code changes (always to code repo):
   git -C <code_repo_path> add src/...  tests/...
   git -C <code_repo_path> commit -m "feat: <user story summary> for <NNN>-<name>"

   # tasks.md tick-off (goes to whichever repo owns the docs root):
   # If mode=in-repo:
   git -C <code_repo_path> add mage/work/<NNN>-<name>/tasks.md
   git -C <code_repo_path> commit -m "tasks: tick off <task IDs>"

   # If mode=external:
   git -C <hub_path> add projects/<project>/mage/work/<NNN>-<name>/tasks.md
   git -C <hub_path> commit -m "tasks: tick off <task IDs>"
   ```

8. **When all tasks for a story are done**, propose marking the story complete
   in `tasks.md` and updating the spec's status to "Implemented" (or the like).

9. **When all tasks for the work unit are done**, propose:
   - Running `mage index` to refresh `<docs-root>/INDEX.md` if new notes emerged
   - Capturing reusable INSIGHT/PROCEDURE/POINTERS as a durable note via the
     `mage:learn` skill (capture-by-pointer — store the insight + how to do it
     faster + sources, never copies of what you read)
   - Authoring an ADR in `<docs-root>/decisions/` for any non-obvious technical
     decisions made during implementation (use the `mage` skill's
     proactive-suggestion guidance)

## Anti-patterns

- **Auto-committing**: never. This skill suggests, the user commits.
- **Implementing tasks out of order**: respect dependencies. Don't start US2 work before US1 is done unless explicitly allowed by the parallel-team strategy in tasks.md.
- **Modifying spec/plan/tasks during implementation**: don't. If the plan turns out to be wrong, STOP, surface the issue, and propose re-running `mage:plan` (and possibly `mage:analyze`) — don't silently deviate.
- **Adding scope**: if you notice something missing, surface it as a question. Don't quietly add it.
- **Skipping the principle check**: every implementation choice should pass through the project's principle notes. If a task would violate a principle, surface that explicitly.

## Quality bar

A good implementation pass:
- Ticks off tasks as work completes (live state visible in tasks.md)
- Surfaces problems EARLY (an hour into work, not a day)
- Has commits at meaningful boundaries (phase, user story, logical group)
- Doesn't deviate from the plan without flagging it first
- Ends with a clear summary: "All US1 tasks done, X commits suggested, here are the next steps"
