# AGENTS.md

Instructions for AI coding agents working in this repository.

<!-- BEGIN mage -->
## mage knowledge base

This repository has a **mage** knowledge base at `mage/`. mage is a portable, file-based knowledge base of notes — insight,
procedure, and pointers (not copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read `mage/INDEX.md` first — the always-current index of what's known
   (one line per memory-genre note: type · title · keywords · → link; the
   auto-loaded `MEMORY.md` roster is its bounded subset). Open only the notes
   the task actually touches; don't read everything.
2. Follow the links in those notes (standard markdown `[text](path.md)` links)
   and skim `mage/decisions/` for governing decisions.
3. Treat notes as point-in-time. If a note is `status: stale-suspect`, or its
   `last_reviewed` / `provenance.commit` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with `/mage:learn`, or
add a note under `mage/notes/` and run `mage index`. Capture the reusable
*insight + procedure + pointers*, never a copy of the source. This rule targets
the **memory** genre only (`mage/notes/`). `mage/work/` (plans, specs, task
lists) and `mage/decisions/` (ADRs) are authored deliberately, not destinations
for captured knowledge; if the artifact has a done-state it belongs in work or
decisions, not notes (ADR-0041).

**Docs surfaces:** Every implementation spec handed to a coding agent must include a "Docs surfaces" deliverable section naming the specific files to update, or an explicit "none affected because …". Where a named surface explains three or more interacting parts (a resolution order, a topology, a state machine, a pipeline, a precedence rule), the spec must also say which concrete artifact will carry it — a worked example, a terminal transcript, a diagram, or (only if genuinely graphical) a screenshot with a stated invalidation trigger. Prose-only for that kind of surface is an incomplete spec.

**Commit hygiene:** mage never commits for you. It suggests `git` commands; you
run them.
<!-- END mage -->

## Order of work

The pinned tracking issue on GitHub is the order of work. Read it before picking anything up.
ADR-0048 is the charter; `docs/plans/0048-road-to-0.1.0/` holds the plan page and evidence.
