---
type: plan
tags:
  - mage/work
created: "2026-08-22"
updated: 2026-08-22
last_reviewed: 2026-08-22
status: active
provenance:
  repo: mage-memory
  work: adr-0045-0046-implementation
sources:
  - decisions/0045-cross-environment-presence.md
  - decisions/0046-derived-hub-git-and-merge-ratification.md
  - src/paths.ts
  - src/grooming/config.ts
  - src/provenance.ts
  - src/adapters/claude-code/nudge.ts
keywords:
  - implementation-plan
  - mage-home
  - resolution-states
  - groom-submit
  - github-actions
  - fixture-hub
---

# Plan — implementing ADR-0045 and ADR-0046

The two decision records state *what* was decided. This plan carries the *how*: signatures,
shapes, file paths and sequencing. Nothing here is a decision; changing any of it does not require
reopening an ADR.

## Sequencing

1. **Ratify [ADR-0042](../decisions/0042-reach-tier-harness-grants.md),
   [ADR-0043](../decisions/0043-hub-addressed-by-remote-located-by-derivation.md) and
   [ADR-0044](../decisions/0044-setup-is-a-conversation-over-one-address.md) first.** 0045 amends
   0043 and 0044 and leans on 0042. Amending unratified decisions is what produced the six-deep
   stack. **Done** — the pull request carrying 0045 and 0046 flips all three to `accepted`. 0044's
   `local://` address scheme still has no implementation; that is lane work, not a ratification
   blocker.
2. **Land the resolution-states work** (below). ADR-0045 §5 depends on it.
3. **Then the presence lane**, then the proposal lane. The proposal lane writes into a knowledge
   base that must be resolvable first.

## Lane A — resolution states (ADR-0045 §2, §5, §8)

**The bug this fixes.** `resolveDocsRoot` in `src/paths.ts` currently ends the code-repo branch with
`external ?? { root: codeRepoDocsRoot(codeRepo), … }`, so an external-mode project whose hub is
unreachable silently resolves to `<codeRepo>/mage/`. The inline comment ("a bad read degrades to
repo KB") documents the behaviour as intentional.

**Shape.** Resolution returns three outcomes rather than a nullable one: no knowledge base, a
resolved knowledge base, and *unreachable* carrying which hub was expected and where. Callers
branch on the third explicitly; there is no default that turns it into the second.

- Interactive callers (via `requireDocsRoot`) report and offer to clone.
- `mage observe` drops the event and exits 0. It cannot prompt: its input arrives on stdin and it
  must not block a tool call.
- `doctor` reports it as a failing check.

**Existing work.** PR #171 ("fix(paths): distinguish not-external from hub-unreachable in
resolveDocsRoot") is this change, and is currently blocked with three open reviewer findings
covering the `try` scope around `readMetadata`, a false `hub-corrupted` message on origin mismatch,
and a commandeer-skip warning that fires for scope-only skips. Resolve those rather than restarting.

**Removed by ADR-0045 §2.** The `hub_path` fallback inside `externalDocsRoot` goes; a displaced
clone is unreachable, not an alternative location.

**Guard for §8.** A test that runs mage against a `MAGE_HOME` containing only a bare hub clone, with
no prior `connect` and no other machine-local state, and asserts read and write both work.

## Lane B — the session-start message (ADR-0045 §6)

One additional case in `src/adapters/claude-code/nudge.ts`. It already fires on `startup` / `resume`
/ `compact` and already writes two channels: a terse `systemMessage` for the human and
`additionalContext` for the agent.

- Exempt from the backlog throttle (`grooming.nudgeThrottleHours`), like the digest already is.
- The agent-facing text names the hub, the derived path it was expected at, and the one command that
  obtains it. It does not instruct the agent to run `mage init`, which would mint a second knowledge
  base.
- Silent when the hub resolves.

## Lane C — the CI story (ADR-0045 §9)

**Artifacts**

- `examples/github-actions/hub-sync.yml` — the copy-paste recipe.
- `.github/workflows/examples-e2e.yml` — the same steps against a private fixture hub, installing
  the CLI from the working tree via `npm pack` (never `npx mage-memory`, which runs the published
  release — see [the gotcha note](../notes/npx-mage-runs-the-published-release.md)). Closes its own
  pull request and deletes the branch so the fixture stays clean. Runs on pull request plus a weekly
  schedule.
- `docs/src/content/docs/guides/github-actions.md` — the guide, cross-linked from
  `guides/hub-and-external-mode.md`.

**The recipe.** `actions/checkout` refuses paths outside the workspace, and ADR-0045 §2 pins the
clone to its derived path. Both hold at once by relocating the root:

```yaml
env:
  MAGE_HOME: ${{ github.workspace }}/.mage-home
steps:
  - uses: actions/checkout@v4                 # the code repo
  - uses: actions/checkout@v4                 # the hub, at its derived path
    with:
      repository: <owner>/<hub-repo>
      token: ${{ secrets.MAGE_HUB_TOKEN }}
      path: .mage-home/hubs/github.com/<owner>/<hub-repo>
```

Checkout persists the token into that clone's git config, so the later push resolves it and mage
never sees a credential (ADR-0045 §4).

**Credentials.** A fine-grained PAT scoped to the hub repository (`contents: write`,
`pull-requests: write`) is the documented default, since the audience is individuals with private
hubs. A commented variant shows `actions/create-github-app-token` for organisation use, which is
GitHub's documented recommendation for cross-repository access. In-repo projects need neither: the
workflow's own token can write to its own repository.

**Trigger safety.** Documented workflows run on `push`, `schedule` or `workflow_dispatch`, or on a
merged pull request. Never `pull_request_target` while a hub credential is in scope, per GitHub's
security hardening guidance.

**Docs surface note.** The guide must carry a worked walkthrough of the derivation —
`MAGE_HOME` → `hubs/<host>/<owner>/<repo>` → why checkout's `path:` lands correctly. This is a
resolution-order surface, so prose alone is an incomplete deliverable under AGENTS.md.

## Lane D — the environment rule (ADR-0045 §7)

A guard test over production sources asserting that no correctness path branches on environment
identity. Pass-through (`{ ...process.env }` into a child process) and recording (stamping which
harness produced a capture) are permitted; the check targets branching, not access.

The house pattern already exists and should be preferred as the fix wherever a read needs to move:
`src/adapters/claude-code/settings.ts` and `projects.ts` both take `env: NodeJS.ProcessEnv =
process.env` as an injected parameter.

**Known violations to clear**

- `src/commands/doctor.ts:159` — `process.env.VITEST` branches production behaviour on the test
  runner. Delete it; inject the flag.
- `scripts/cloud-setup.sh` — no-ops unless `CLAUDE_CODE_REMOTE` is `true`. This is vendor detection
  selecting behaviour, in mage's own shipped bootstrap. A TypeScript-only check would never see it,
  so the guard's scope needs to include shipped scripts or the script needs to stop branching.
- `src/commands/doctor.ts:222` — `CLAUDE_CONFIG_DIR` is a legitimate harness config read sitting
  outside the adapter layer. Move it.

## Lane E — proposals (ADR-0046)

**The flag.** `mage groom --accept <slugs|all>` gains an option that, instead of leaving promoted
notes in the working tree, creates a branch, commits, pushes and opens the pull request. Same
`promoteDraft` chokepoint, same redaction, same stamping.

Branch names are namespaced under a reserved prefix so the refusal check can recognise them, and a
name that is not under that prefix, or that equals the default branch, is refused.

**Refusal conditions.** One pure, total predicate gates every git write. It takes the resolved
knowledge base, the repository root and how it was resolved, the configured setting, the default
branch name, the redaction result and — for the branch it is about to create — the intended name.
It returns either permission or the message shown verbatim to the user. It reads no environment
variable and no terminal state; a test asserts that.

It refuses on seven conditions, checked in this order, first match winning so the message is
always the most fundamental reason:

1. the setting is not enabled;
2. the target branch is the default branch;
3. the target branch is outside the reserved prefix;
4. the redaction scan blocked;
5. the repository is not the one the resolved knowledge base lives in;
6. the working tree holds changes outside recognised knowledge-base paths;
7. the run would propose more notes than the cap.

Every message says what to do next, not only what went wrong.

**Config field.** One more key in the `grooming` block read by `readGrooming` in
`src/grooming/config.ts`, narrowed the same way as `autonomy` and `sensitivity`, absent meaning off.
Settable through the existing settings command.

**Provenance.** Two additional fields at the creation stamp in `src/provenance.ts`: the channel the
note arrived through, and a reference to the review that produced it. Creation-only, consistent with
[ADR-0031](../decisions/0031-programmatic-provenance-stamp.md) §3. No authorship level is set, which
is what keeps the reject-ledger cohort in `src/grooming/reconcile.ts` unchanged.

**Bounds.** One pull request per run, and at most **five** notes in it (ADR-0046 §7). Five is
what one person can actually read in a sitting, which is the whole point of merge-as-ratification.

## Docs surfaces

- `docs/src/content/docs/guides/github-actions.md` — new; the recipe and the derivation walkthrough.
- `docs/src/content/docs/guides/hub-and-external-mode.md` — cross-link; the unreachable-hub state.
- `docs/src/content/docs/reference/layout.md` — `MAGE_HOME` as a supported contract, and the fact
  that a bare clone is sufficient.
- `docs/src/content/docs/model/modes.md` — the three resolution outcomes. Carried by a terminal
  transcript, not prose: one block per outcome (resolved, no knowledge base, hub unreachable) as
  the CLI actually prints it, and for the third, what `mage observe` and `mage doctor` each do
  with it.
- `skills/guide/SKILL.md` — the unreachable-hub state and what an agent should do about it.
- `docs/src/content/docs/loop/stage-groom.md` — the `--propose` flag on `groom --accept`, the
  `grooming.proposals` setting, and what a run produces. Carried by a worked example: one accept
  run with the flag, from staged drafts through to the pull request it opens.
- `src/cli-program.ts` — the help string for `--propose`.
- `docs/src/content/docs/reference/` — the refusal conditions. This is a precedence rule with
  seven ordered cases, so it is carried by a table of condition, message and what the user does
  next, never by a paragraph listing them.

## Open

- The cloud-sandbox probe (`~/ai-context/mage-cloud-grant-probe.md`) is now decisive rather than
  informational: under ADR-0045 §2 the sandbox is supported only if the hub can exist at the derived
  path there. Record the answer into ADR-0045 as a dated environment fact.
- The `0046-derived-hub-git-and-merge-ratification.md` filename no longer matches its title, since
  git is no longer restricted to derived hub clones. Renaming costs link updates in five decision
  files (0012, 0013, 0030, 0044, 0045); deferred deliberately.
