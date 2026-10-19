---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-10-20"
last_reviewed: "2026-10-20"
keywords: [ladder, recall, trigger, deny-once, groom, loop, cut, receipt, corrected]
---

# 0060 — The ladder reset
## Decision
Keeps 0051 (the ladder) and 0058 (a bounded roster that lists every note). Adds recall at the action: a note
that passes admission (`rung`, `trigger`, `pointer`) and whose `trigger.match` globs hit a Bash, Write, Edit,
MultiEdit or NotebookEdit call is injected as context by a PreToolUse hook, once per session; only admitted
notes are recalled. The gate stays, once, and asks by default: the first memory write of a session, at the root or under `notes/`,
that carries no `rung` is allowed and the ladder with a template per rung is attached as context
(`ladder.gate: "ask"` in `mage/metadata.json`). `"deny-once"` is opt-in: it refuses that write once with a reply that
ends in a retry. Every later write passes, a write carrying `rung` always passes, and a failed secret scan denies in
both modes. A write to a regenerated index is refused with a redirect to its own file under `mage/notes/`. Reserved root files (AGENTS.md, CLAUDE.md,
IDENTITY.md, README.md, Dashboard.md) are not memory targets; only INDEX.md, MEMORY.md and `_index.*.md` are
denied, because `mage index` regenerates them. Recall de-dup and the ladder marker are keyed per `session_id`,
so subagents that share their parent's `session_id` share both. `mage groom` walks existing notes up the ladder
and lands the result by pull request. The loop is cut from the surface: its verbs, skills and docs, the ledger and the two-count release. Its code
(observe on its hook events, distill, the proposal engine, the dashboard) stays until #223 removes it. Success is fewer operator corrections per session, read from the
receipt's `corrected`.
## Why
3 of 126 sessions read a note (0050). In eval E2 (n=3, one model) plain scored 1 of 5, attach-only 1.00 and
deny-once 1.33. In E2 with neutral examples (n=3, one model) deny-once lost every lesson in 2 of 3 runs while the
agent told the user they were recorded, hence ask as the default (#282). A per-call hook cost 102 ms before the fast path (#239).
## Forbids
A recall hook that blocks or decides permission. Regex matchers. Recall of decisions. Denying a memory write twice
in a session, or one that carries `rung`. A counting gate on a release. A second recall field beside `trigger`.
## Example
A session writes `feedback_dashes.md` with no `rung`: it is saved, and the ladder arrives as context once. The agent adds one line to
AGENTS.md, rewrites the note with `rung: note`, a `trigger` and a `pointer`, and the write passes. Later
`mage recall-hook --explain` on `npx mage index` prints `match  notes/npx-mage-runs-the-published-release.md
Bash(npx mage *)` and `would inject 1 note(s)`.
## Relations
Supersedes the loop half of 0050; 0051's every-attempt deny, its fail-closed-on-error clause and its "without
skipped" forbid; 0052 beyond hook capture; 0057's machinery except the pull-request rule; 0058's "after 0.1.0
(#201)" sentence; 0059's two counts (release-please and the docs drift test stay); 0055's verb list. Enforced by
`src/adapters/claude-code/recall-hook.ts`, `src/scanner/trigger.ts`, `src/adapters/claude-code/memory-hook.ts`.
Work: #282, #223.
