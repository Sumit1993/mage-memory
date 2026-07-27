# AGENTS.md

Instructions for AI coding agents working in this repository.

<!-- BEGIN mage -->
## mage knowledge base

This repository has a **mage** knowledge base at `mage/`. mage is a portable, file-based knowledge base of notes — insight,
procedure, and pointers (not copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read `mage/INDEX.md` first — the always-current index of what's known
   (one line per note: type · title · keywords · → link). Open only the notes
   the task actually touches; don't read everything.
2. Follow the links in those notes (standard markdown `[text](path.md)` links)
   and skim `mage/decisions/` for governing decisions.
3. Treat notes as point-in-time. If a note is `status: stale-suspect`, or its
   `last_reviewed` / `provenance.commit` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with `mage:learn`, or
add a note under `mage/notes/` and run `mage index`. Capture the reusable
*insight + procedure + pointers*, never a copy of the source.

**Docs surfaces:** Every implementation spec handed to a coding agent must include a "Docs surfaces" deliverable section naming the specific files to update, or an explicit "none affected because …".

**Commit hygiene:** mage never commits for you. It suggests `git` commands; you
run them.
<!-- END mage -->
