---
type: decision
tags:
  - mage/decisions
created: "2026-08-22"
updated: 2026-08-22
last_reviewed: 2026-08-22
status: proposed
provenance:
  repo: mage-memory
  work: adr-0046-hub-git-autonomy
sources:
  - decisions/0012-wings-optional-convention-standalone-hubs.md
  - decisions/0013-procedure-skills-self-grooming-loop.md
  - decisions/0030-agent-autonomy-ladder.md
  - decisions/0031-programmatic-provenance-stamp.md
  - decisions/0014-two-gate-redaction.md
  - decisions/0042-reach-tier-harness-grants.md
  - decisions/0043-hub-addressed-by-remote-located-by-derivation.md
  - decisions/0044-setup-is-a-conversation-over-one-address.md
  - decisions/0045-cross-environment-presence.md
keywords:
  - memory-autonomy
  - refuse-git-action
  - mage-submit
  - mage-sync
  - git-autonomy
  - hub-pr-ratification
  - memory-poisoning
  - provenance-channel
  - pipeline-memory
---

# 0046 — mage runs git only in derived hub clones; adoption is ratified by a human git action

> **Status: proposed (ruling 2026-08-22).** Defines the git execution policy, safety boundaries, and ratification model for unattended CI review memory and attended session synchronization. Amends [ADR-0012](0012-wings-optional-convention-standalone-hubs.md), [ADR-0013](0013-procedure-skills-self-grooming-loop.md), [ADR-0030](0030-agent-autonomy-ladder.md), and [ADR-0044](0044-setup-is-a-conversation-over-one-address.md). Paired with [ADR-0045](0045-cross-environment-presence.md).

## Context

Enabling AI coding agents to capture knowledge during automated workflows (e.g. GitHub Actions code review) and synchronizing session notes across machines surfaced three architectural questions:

1. **Memory landing site and ratification:** Where should CI-learned knowledge land, and who ratifies it? Writing directly to a code repository under review expands write scope and blurs repo ownership. Writing unratified notes to a knowledge base's default branch creates memory poisoning risks from untrusted PR diffs.
2. **Re-scoping the git invariant:** [ADR-0012](0012-wings-optional-convention-standalone-hubs.md) §3 established "mage never runs git" and [ADR-0013](0013-procedure-skills-self-grooming-loop.md) §4 established "the commit is the confirm" to prevent surprise mutations in user-owned code repos. Unattended CI workflows require git automation (creating branches, pushing, opening PRs) without risking arbitrary user repos.
3. **Environment-invariant safety without attendance detection:** Detecting whether a human is "attached" via TTY inspection or environment variables is unreliable: hook-invoked tools lack TTYs even when human-attended, while CI wrappers can allocate PTYs. Safety must come from structural constraints, not attendance heuristics.

## Decision

### 1. Destination: CI-learned memory lands in the external hub on a branch, ratified by human PR merge

CI-learned knowledge lands exclusively in the external hub (`~/.mage/hubs/<derived>`), never in the reviewed code repository.

- **Staging and promotion:** The CI review agent stages candidates via `mage stage` (`.mage/staging/`). At job end, **`mage submit`** promotes staged drafts through `promoteDraft` (Gate-2 redaction + provenance stamping) onto a dedicated branch `mage/submit-<slug>` in the derived hub clone, commits, pushes, and opens a hub PR.
- **Ratification boundary:** The hub PR diff is the ratification surface. The default branch gains notes only through an explicit human merge. Because recall reads only the checked-out default branch of the hub clone, unmerged proposals are completely invisible to future runs.
- **In-repo KBs:** In `mode: in-repo`, `mage submit` refuses and suggests linking an external hub.

### 2. Memory poisoning defenses

To defend against prompt-injected or low-quality rules from untrusted PR diffs:

1. **Structural quarantine:** Proposed notes exist only on unmerged hub branches. Human merge is the required security boundary.
2. **Provenance stamping:** `mage submit --context <url>` stamps `provenance.channel: "pipeline"` and `provenance.review: <url>` (with no `autonomy` field) into note frontmatter and lists them in the hub PR body.
3. **Trigger discipline:** Documented workflows run memory extraction on `pull_request: closed` where `merged == true`.
4. **Blast-radius caps:** At most one hub PR per workflow run and at most 5 notes per submit. Hub tokens are scoped strictly to the hub repo (`contents: write`, `pull-requests: write`), never reusing the code repository's token.
5. **Gate-2 redaction:** [ADR-0014](0014-two-gate-redaction.md) Gate-2 secret scanning runs over all submitted content before commit.

### 3. Permitted git actions and the two verbs

mage may run git **only** inside a hub clone derived from `hub_repo` under `$MAGE_HOME/hubs/` ([ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md)), verified by `looksLikeHub` and origin matching. It is strictly forbidden from executing git in the code repo, in an in-repo KB, in a `hub_path` fallback directory, or in any repository outside `$MAGE_HOME/hubs/`.

Two verbs provide git capabilities across workflows:

- **`mage submit` (unattended-safe):** Operates in a temporary linked worktree branched from `origin/<default>`, writes promoted notes, commits, pushes `mage/submit-<slug>`, and opens a PR (`gh pr create` with compare URL fallback). It never touches the default branch or main checkout.
- **`mage sync` (attended convenience):** Operates in the hub clone's main checkout. Commits KB-path changes with a templated message, runs `git pull --rebase`, and pushes to the default branch. Consent is established by explicit CLI invocation. It refuses if dirty paths contain any files outside documented KB paths (`notes/`, `decisions/`, `_index*`, `INDEX.md`, `MEMORY.md`, `skills/`, `metadata.json`, `CONVENTIONS.md`). It is never wired into automated hooks or nudge mandates.

### 4. Hub-tracked policy ladder in `metadata.json`

Git write capabilities are governed by a fail-closed field in the **hub's own** `metadata.json`:

```json
{
  "git": {
    "autonomy": "suggest"
  }
}
```

- Allowed values: `"suggest"` (default) | `"submit"` | `"sync"`.
- Ordered ladder: `"sync"` implies `"submit"`.
- Absent, unrecognized, or invalid values evaluate to `"suggest"` (today's print-commands behavior).
- The policy is committed into the hub repository; environment variables cannot grant write posture.

### 5. Attendance and environment detection are banned as inputs

Attendance (TTY presence, human attachment) is explicitly banned as an input to git operations. Safety is enforced by structural invariants (branch-only writes for `submit`, KB-path restrictions for `sync`) and the asynchronous human merge gate.

### 6. The safety boundary: `refuseGitAction` pure predicate

All git write operations are gated by a pure predicate in `src/git-policy.ts`:

```ts
/** Hub-tracked git posture (metadata.json → git.autonomy). Fail-closed. */
export type GitAutonomy = "suggest" | "submit" | "sync";

export type GitIntent =
  | { verb: "submit"; branch: string } // must match /^mage\/[a-z0-9][a-z0-9/-]*$/, must not be default branch
  | { verb: "sync" };                  // default branch of hub clone, main checkout

export interface GitActionInputs {
  /** paths.ts resolution of the KB. Must be mode "external" (or one hybrid ref). */
  resolved: ResolvedDocsRoot;
  /** The git repo root the action targets, and HOW it was resolved. */
  hub: HubResolution;
  /** verifyHubArrival(hub.root, meta.hub_repo): looksLikeHub + canonical origin === hub_repo. */
  arrival: { ok: boolean; reason?: string };
  /** readGitAutonomy(resolved) — junk-narrowed, absent ⇒ "suggest". */
  policy: GitAutonomy;
  /** `origin/HEAD` short name, e.g. "main". */
  defaultBranch: string;
  /** Gate-2 (`redact --check`) over the exact bytes to be committed. */
  redaction: { blocked: boolean; findings: string[] };
  /** For "sync" only: repo-relative dirty paths from `git status --porcelain`. */
  dirtyPaths: string[];
}

/** null ⇒ allowed. A string ⇒ the refusal message (verbatim to the user). Pure, total. */
export function refuseGitAction(i: GitActionInputs, intent: GitIntent): string | null;
```

**Six structural conditions (evaluated in order):**

| # | Condition | Refusal guards against |
|---|---|---|
| 1 | `i.resolved` is external mode, `isUnder(hubsRoot(), i.hub.root)` is true, and `i.hub.source === "derived"` | Running git in a user-owned repo, in-repo KB, hand-placed clone, or `hub_path` fallback. |
| 2 | `i.arrival.ok` (`looksLikeHub` and canonicalized `origin` matches canonicalized `hub_repo`) | Pushing to a substituted remote or committing to an unverified directory. |
| 3 | Policy ladder (`submit` requires `policy !== "suggest"`; `sync` requires `policy === "sync"`) | Unintended git execution when policy is unconfigured or set to suggest-only. |
| 4 | For `submit` only: `intent.branch` matches `/^mage\/[a-z0-9][a-z0-9/-]*$/` and `intent.branch !== i.defaultBranch` | Unattended writes landing on the default branch without human merge ratification. |
| 5 | `!i.redaction.blocked` | Secrets leaking onto pushed branches ([ADR-0014](0014-two-gate-redaction.md)). |
| 6 | For `sync` only: every entry in `i.dirtyPaths` is under recognized KB paths | Accidental commits of unrelated working tree changes. |

**Banned inputs:** `process.stdout.isTTY`, `process.env.CI`, `GITHUB_ACTIONS`, `CLAUDE_CODE*`, and all other environment variables are strictly forbidden from `src/git-policy.ts`.

## Considered options

- **Direct commit of learned notes to hub default branch in CI:** Rejected. Lacks human ratification, recreates memory poisoning vulnerabilities, and grants unreviewed write access to memory.
- **Landing memory in reviewed code repository:** Rejected. Expands CI write blast radius to the target codebase and violates cross-repository boundaries.
- **Server-side or PR-comment store:** Rejected per [ADR-0001](0001-memory-first-product-supersedes-specshub.md) (files-as-truth) and [ADR-0020](0020-no-server-tiered-dashboards.md) (no server). Comments are not searchable memory.
- **"No TTY" as unattended predicate:** Rejected. Hook executions lack TTYs while attended; CI wrappers can allocate PTYs.
- **Environment detection flags (`GITHUB_ACTIONS`, etc.):** Rejected. Safety is guaranteed by structural branch isolation and merge ratification.
- **Fourth rung on ADR-0030 ladder:** Rejected. [ADR-0030](0030-agent-autonomy-ladder.md) governs session grooming judgment; git transport is a separate operational dial.
- **Approval-delay / auto-merge timers:** Rejected. Timers turn silence into ratification, undermining the human security boundary.
- **Reusing `mage dream` proposal terminology / naming verb `mage propose`:** Rejected. Avoids collision with `mage dream --apply` proposal formats.

## Consequences

- Autonomous memory capture in CI runners is safely enabled via isolated branch proposals and asynchronous PR review.
- The invariant "mage never runs git against a repo you own" is preserved while enabling hub-internal git transport.
- [ADR-0031](0031-programmatic-provenance-stamp.md) reconciler cohorts are undisturbed: pipeline notes omit `provenance.autonomy`, so `src/grooming/reconcile.ts:130` skips them.
- Hub owners retain complete authority over durable memory adoption via git merge.

## Relations

- amends [ADR-0012 — A wing is an optional convention; hubs are standalone-first](0012-wings-optional-convention-standalone-hubs.md) (§3 bullet 4: invariant re-scoped to user-owned repos)
- amends [ADR-0013 — Procedure skills and the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) (§4: ratification extends from commit to hub PR merge)
- amends [ADR-0030 — Agent autonomy ladder](0030-agent-autonomy-ladder.md) (§3 bullet 1: floor takes second form on pipeline branches)
- amends [ADR-0044 — Setup is a conversation over one address](0044-setup-is-a-conversation-over-one-address.md) (§4: clone-on-demand permitted behind explicit `--clone` on `mage submit`)
- rides [ADR-0014 — Two-gate redaction](0014-two-gate-redaction.md) (Gate-2 secret redaction enforced before commit/push)
- extends [ADR-0042 — the reach tier: harness grants](0042-reach-tier-harness-grants.md) and [ADR-0043 — A hub is addressed by its remote, located by derivation](0043-hub-addressed-by-remote-located-by-derivation.md) (re-uses `looksLikeHub` and derivation gates)
- bounded_by [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) (deterministic git plumbing, host agent judgment)
- paired_with [ADR-0045 — Cross-environment presence: one root variable, one obtain verb, explicit location registration, and the cloud mandate](0045-cross-environment-presence.md)
