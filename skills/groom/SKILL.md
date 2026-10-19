---
name: groom
description: |
  Walk the notes up the ladder with `mage groom`: for each note, judge whether
  it climbs to a deny rule, check, hook or AGENTS.md rule, is deleted, or stays
  a note. Fires on "groom", "tidy the notes", "what should be a hook or check",
  and right after a `mage:ladder` deny on a memory write.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# /mage:groom — walk the notes up the ladder

A note is the last rung. Four rungs sit above it: a deny rule, a check, a hook,
an AGENTS.md rule. Each rung carries a fact better than a note can, because it
acts without anyone remembering to read it. groom takes the notes one at a time
and moves each as high as it can go. No model lives in mage (ADR-0050): you
judge, `mage groom` lists and the tools you already have build.

## Steps

1. **List.** Run `mage groom --json` (or without `--json` for the readable
   block). It lists memory notes, flat captures at the docs root included,
   notes without a `rung` first. `--limit <n>` and `--all` size the walk. This is
   what the human output looks like, from a real run on a fixture knowledge base:

   ```text
   mage groom: 2 of 4 notes to judge (notes without a rung come first).
     1. notes/gate2-fp-blocks-autonomy.md  "Gate-2 false positives block autonomy"  rung: -  trigger: -  pointer: -
     2. notes/npx-mage-runs-the-published-release.md  "npx mage runs the published release"  rung: note  trigger: deciding which mage binary a verify command runs  pointer: [#282](https://github.com/Sumit1993/mage-memory/issues/282)
     2 more: mage groom --all
   For each note: climb (build the rung below, then delete the note), delete (stale, or a copy of a source),
   or keep (add rung, trigger and pointer). mage never commits: land the whole diff as one pull request.

   mage:ladder
   Take each fact in a note to the highest rung that can carry it.
   Build that, then keep as a note only what no rung above can carry. Copy the template that fits.

   1 impossible: a deny rule in .claude/settings.json
     {"permissions": {"deny": ["Edit(<path-glob>)", "Write(<path-glob>)"]}}
   2 check: a versioned check that fails on the mistake: a test, a lint rule, or a CI job or
     package script committed to the repo, so it reaches a pull request and every clone
     "<script name>": "<command that exits non-zero when <forbidden pattern> is found>"
     Do not edit .git/hooks/pre-commit (mage's secret scan lives there) and keep the check out of .git: it is local only.
   3 hook: a PreToolUse hook in .claude/settings.json that blocks with a reason
     {"hooks": {"PreToolUse": [{"matcher": "<tool name>", "hooks": [{"type": "command", "command": "node .claude/hooks/<name>.mjs"}]}]}}
     The script reads the tool call JSON on stdin; to block it prints
     {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "<rule text>"}}
   4 rule: one line in AGENTS.md carrying an id
     - <rule text>. [mage:repo/rule/<slug>]
   5 note: add to the note's frontmatter
     rung: note
     trigger: {when: "<the moment it matters>", match: ["Bash(<cmd> *)", "Edit(<glob>)"]}
     pointer: "[<source>](<path or issue>)"
   A memory that carries rung: is never stopped.
   ```

2. **Judge each note.** Read it, then pick one:
   - **climb**: the fact can be a rung above. Build the artifact from the matching
     template. Prove it fires: run the check on a bad sample; pipe a sample tool
     call JSON into the hook script and read its output. Only then delete the note.
   - **delete**: stale, or a copy of a source the note only mirrors.
   - **keep**: nothing above can carry it. Add `rung`, `trigger` (`when` plus
     `match`) and `pointer`. Test the match with `mage recall-hook --explain`,
     feeding it a sample tool call on stdin, against calls it should and should
     not hit. `rung` is one of `impossible`, `check`, `hook`, `rule`, `note`; `trigger`
     is a string, or `{when, match}` with `Bash(<glob>)` and `Edit(<glob>)` entries
     (an `Edit` glob is relative to the code repo being edited); `pointer` is a
     markdown link to the source. Details:
     [Admission and triggers](https://github.com/Sumit1993/mage-memory/blob/main/docs/src/content/docs/model/notes.md#admission-and-triggers).
3. **Regenerate.** Run `mage index`. Its `Roster:` line says how many notes are
   admitted and how many recall at the action.
4. **Land one pull request.** Show the whole diff (the artifacts, the deleted
   notes, the changed notes) and open one pull request from a branch. Never
   commit to the default branch. mage never commits for you.

## Rules

- A climb edits code-repo files (AGENTS.md, `.claude/settings.json`, CI), so it
  lands as an ordinary pull request. `--propose` refuses those paths by design.
- Run the redaction gate (`mage redact <file>`) before a new tracked file holds
  anything copied from a note (ADR-0053).
- Notes are insight, procedure and pointers, never a copy of a source.
- Staged drafts from 0.0.17 can still wait in `.mage/staging/`; clear them with
  `mage groom --accept|--reject <slugs|all>`.

## See also

- **/mage:learn**: writes a note, after asking the ladder first.
- **/mage:optimize**: keeps recall sharp once notes carry a `match`.
- ADR-0060 (`mage/decisions/0060-the-ladder-reset.md`): the decision behind the walk.
