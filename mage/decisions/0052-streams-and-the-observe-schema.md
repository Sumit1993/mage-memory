---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [observe, stream, schema, tool_attempt, guard_fired, finding, digest, gate-1, jsonl]
---

# 0052 — Streams and the observe schema
## Decision
A stream is anything that emits observe events. The envelope is v1 and additive only: new event types are
appended, existing ones are never reopened, and there is no `seq`. Built-in streams: the Claude Code hooks
(SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, SubagentStop),
operator corrections, kit hooks reporting `guard_fired` with their guard id, and one review-findings puller
writing `finding {rule, path, text, pr}`. `tool_attempt` (PreToolUse) and `tool_use` both carry the harness
invocation id; an attempt with no matching use is a prevented call. Every stream writes through `mage observe`
on stdin so Gate-1 scrubs it; nothing appends to `.mage/learnings/` directly. Streams carry no weights: a
finding is real and fits a rung, or it does not. Narrowing is deterministic and the digest is chronological.
## Why
Tool errors are 1.6 percent of calls and almost all crashes. Review findings on the same repos number in the
hundreds and reached no log. A block by another plugin was invisible because the observer listened after the
call. Recurrence-sorting was tried three times; chronological order plus the agent's judgement is what worked.
## Forbids
An event written to the log by anything but `mage observe`. A schema change a v1 reader cannot skip. A
producer-specific weight. A digest sorted by count. Storing a copy of tool output beyond the scrubbed detail.
## Example
`{"v":1,"type":"tool_attempt","tool":"WebFetch","tool_use_id":"toolu_01"}` with no `tool_use` sharing the id
is one `prevented` for `kit/guard/webfetch`. A kit hook that blocks pipes
`{"type":"guard_fired","guard_id":"kit/guard/no-haiku"}` to `mage observe` on stdin within 500 ms, fail-open.
## Relations
Absorbs 0015, 0027, 0028, 0029 and decision 3 of 0048. Enforced by `src/observe/types.ts:10` (the event union),
`src/observe/scrub.ts` (Gate-1), `src/adapters/claude-code/settings.ts:80` (hook groups). Not yet in the union:
`tool_attempt` (#209, PR #260) and `guard_fired` (#230, PR #254). Puller #217; corrections with a rule id #244.
