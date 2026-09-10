---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [proposal, pull-request, landing, consent, applier, guard-file, provenance, autonomy, skill, delete]
---

# 0057 — A guard lands by pull request; the human merges
## Decision
The only way a guard lands is a branch and a pull request, opened when explicitly invoked (`groom --propose`),
never as a side effect of a hook. Landing scopes: the code repo and the kit the user names at connect; an org
workflows repo comes later. Consent is a committed field (the `landing` key of the knowledge base's grooming
block; the kit's committed contract file), never a machine-local or environment carrier; a scope is writable
when consent is present and its repo is reachable. Types: deny, hook, check, rule, skill, note, delete; rung
must match type; a hook carries a test; a check lands as an issue and is `landed` only when the guard inventory
finds a CI job named with its id. One applier is the single writer: it mints `<scope>/<kind>/<slug>`, stamps
provenance, and refuses a missing skipped reason, an illegal type-rung pair, a hook without a test, a note
without trigger and pointer, a delete without a target. A guard is one committed file per id, `guards/<id>.md`
beside `notes/`; the six carriers are outputs of landing and the compiled table under `.mage/` is a cache.
Autonomy (operator, approver, overseer) sets how much the agent drains alone; the merge is the human gate at
every level. A skill is one output rung, measured by firing, never a graduated note.
## Why
mage never commits; the pull request is the reviewable unit and git blame is the history. A derivation that
silently stops matching looks like a healthy inventory: `flatten`'s detector went dark for weeks (#200).
## Forbids
Committing to a default branch. Pushing outside the proposal branch. Deleting on disk (a delete is a PR diff).
A proposal without skipped reasons. Marking a check landed on issue closure alone. Consent from an environment
variable or a local file. A threshold in the proposer. Guard files under transient `.mage/`.
## Example
`{"type":"hook","scope":"repo","slug":"commit-trailer","rung":"hook","skipped":[{"rung":"impossible","reason":
"git cannot refuse a message shape"},{"rung":"check","reason":"CI runs after the commit"}],"artifact":{"path":
".githooks/commit-msg"},"test":{"path":"test/commit-msg.test.ts"}}` opens one pull request in this repo.
## Relations
Absorbs 0013, 0016, 0019, 0024, 0030, 0031, 0038, 0046 and decisions 1 and 5 of 0048; #249 ruled one file per
guard (it wrote `.mage/guards/`; 0054 makes `.mage/` transient, so the file lives in the vault). Enforced today:
`src/provenance.ts:57`, `src/commands/autonomy.ts:35`; the branch-and-PR machinery is PR #182, unmerged. #235, #233, #237, #236, #216.
