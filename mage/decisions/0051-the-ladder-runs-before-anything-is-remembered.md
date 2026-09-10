---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [ladder, rung, note, trigger, pointer, skipped, memory-hook, native-memory, admission, capture]
---

# 0051 — The ladder runs before anything is remembered
## Decision
The highest rung that can carry a lesson wins: impossible (architecture, config, a deny rule); check (lint,
test, CI job, pre-commit); hook (blocks or rewrites at the moment of the action); rule (one line in AGENTS.md
or a skill, carrying an id); note (a rung-5 guard). A lower rung only when every higher rung is shown not to
apply, and the proposal records each skipped rung with its reason. The moment an agent tries to save a memory
is the trigger: native memory stays on and pointed at the store; the PreToolUse memory hook blocks the write,
returns the ladder, and lets through only a note that names its skipped rungs, its trigger moment and its
pointer. The same hook fires on a direct write under `notes/`, and `mage index` rejects a note without those
fields. If the hook itself fails, a `notes/` write is denied and every other write passes. A note is insight,
procedure and pointers in one screen of plain words, never a copy of a source, and it is expected to leave:
climb to a higher rung, or a delete proposal when its trigger stops occurring.
## Why
Routing this repo's 39 notes through the ladder gave 1 impossible, 11 checks, 5 hooks, 9 rules, 8 notes, 5
deletions: the store was enforcement debt. Native memory minted lessons nobody read, and nothing asked, at the
moment of saving, whether a hook or a check should exist instead.
## Forbids
A note without trigger, pointer and skipped rungs. A copy of a source as a note. A hook that judges (it makes
the agent judge). An admission gate that fails open on `notes/`. A frontmatter type or genre deciding a recall
rung (0041, superseded). An automated note-to-skill graduation. A recurrence count as the admission test.
## Example
Agent: Write `mage/notes/npx-runs-published.md`. Hook: deny, "which rung? impossible, check, hook, rule, note.
A note needs `trigger:`, `pointer:` and `skipped:`". Agent rewrites with `trigger: "deciding which mage binary
a verify command runs"`, `pointer: "package.json bin"`, four skipped rungs with reasons. Hook: pass.
## Relations
Absorbs 0004, 0005, 0032, 0035, 0041 and decisions 2, 4, 7 of 0048. Today the hook is the 0032 scrub-and-redirect
at `src/adapters/claude-code/memory-hook.ts:93`, fail-open at `:243`; #229 (PR #258) repoints it, #231 (PR #255)
adds the schema check, #253 the one-screen check. Landing a note: 0057.
