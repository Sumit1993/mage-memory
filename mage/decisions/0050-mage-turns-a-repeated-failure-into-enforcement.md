---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [charter, loop, guard, rung, fire, proposal, unit, enforcement, repeated-failure, vocabulary]
---

# 0050 — mage turns a repeated failure into enforcement; memory is the queue
## Decision
mage is the loop that turns a repeated failure into a guard. Streams feed observe events; code narrows on
first sight; counts rank the digest and never gate it; at most three proposals per pass; the agent judges the
highest rung the fix can reach; the fix lands by pull request; a ledger counts how often it fires; what never
fires is proposed for deletion. mage has no model and never judges: a hook makes the agent judge.
Five words and no others. A guard is any landed artifact, at any rung. A rung is impossible, check, hook, rule
or note. A fire is one counted event attributed to a guard id. A proposal is a guard not yet landed. A unit is
one knowledge base with its own ledger. Plans and evidence live in the issue tracker; decisions and notes live
in the knowledge base; a decision fits on one screen.
## Why
39 notes in three months; 3 of 126 sessions here read one; three deterministic note selectors were built and
killed (0 of 62, 0 of 55, 115 buckets to 0 proposals). What survived: code narrows, the agent judges, the human merges.
## Forbids
A threshold or recurrence count that gates what the agent sees. A reasoner in the CLI, or a hook that reasons.
Coordination primitives between agents. Depending on another memory product's engine. Spec-driven-development
skills. A plan or task list committed as a repo file. The words lesson, learning, chapter, wing, room, staged,
admitted or graduate anywhere but inside the observe event schema.
## Example
A review bot flags a prismalens changeset naming packages the config ignores. The puller writes a `finding`
event; the next digest lists it; the agent reads the guard inventory, sees nothing covers it, proposes a check.
It lands as an issue carrying the assertion; a CI job named `repo/guard/changeset-packages` follows. The next
bad changeset fails that job: one `prevented` in prismalens-kb's ledger.
## Relations
Absorbs 0001, 0002, 0007, 0010, 0022 and decisions 1, 2, 9, 10 of 0048; vocabulary #248; order of work #204.
Ladder 0051, streams 0052, landing 0057, gate 0059. Nothing in `src/` runs the loop yet: P1 is PRs #254 to #260.
