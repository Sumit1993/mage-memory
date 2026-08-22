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
  work: adr-0045-cross-env-presence
sources:
  - decisions/0043-hub-addressed-by-remote-located-by-derivation.md
  - decisions/0044-setup-is-a-conversation-over-one-address.md
  - decisions/0042-reach-tier-harness-grants.md
  - decisions/0025-one-transient-state-home.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - decisions/0032-capture-redirect-native-memory.md
  - src/hub-url.ts
  - src/paths.ts
  - src/commands/connect.ts
keywords:
  - cross-environment
  - mage-home
  - hub-ensure
  - hub-use
  - hub-mandate
  - redirects
  - project-scope-grant
  - setup-mage
  - detection-line
  - cloud-sandbox
---

# 0045 — Cross-environment presence: one root variable, one obtain verb, explicit location registration, and the cloud mandate

> **Status: proposed (ruling 2026-08-22).** Settles the mechanism for hub state presence and correctness across environments (developer machine, CI runners, and cloud VM sandboxes) and defines the shipped setup surface. Amends [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) and [ADR-0044](0044-setup-is-a-conversation-over-one-address.md). Paired with [ADR-0046](0046-derived-hub-git-and-merge-ratification.md).

## Context

[ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) decided that external hubs are located by derivation from their remote URL under a machine root, and [ADR-0044](0044-setup-is-a-conversation-over-one-address.md) unified setup around addresses. However, running across ephemeral environments (GitHub Actions runners, cloud VM sandboxes such as Claude Code web/VM) surfaced four operational requirements:

1. **State relocation:** Tools with a single semantic class of machine-level state (e.g. Cargo, gh) succeed with a single root variable; tools adopting XDG config/data/cache splits (e.g. uv, Terraform) suffer multi-variable relocation friction. Because per-KB state lives at `<docsRoot>/.mage/` ([ADR-0025](0025-one-transient-state-home.md)), `~/.mage/` holds only machine-level, remote-backed state.
2. **Obtainment and auth:** Private hubs in CI runners require automated obtainment without storing credentials or branching on environment identity.
3. **Cloud sandboxes:** Harness-managed cloud environments attach repositories as out-of-tree siblings (e.g. `/home/user/<hub>` alongside `/home/user/<project>`) where moving or symlinking is prohibited, requiring explicit location registration and proactive agent context.
4. **Environment detection discipline:** Fragile heuristics (`GITHUB_ACTIONS`, container markers, hostname checks) must be replaced by uniform correctness mechanisms and an enforceable detection line.

## Decision

### 1. State-directory contract: one variable, `MAGE_HOME`, default `~/.mage`

Everything mage keeps machine-wide lives under `$MAGE_HOME` (default `~/.mage`). No XDG split is adopted. The derivation below that root stays fixed (`<root>/hubs/<host>/<segments...>/<repo>`, per [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) §2), and no second relocation variable will ever be added. `MAGE_HOME` is promoted from a test override to the documented product contract.

### 2. Hub materialisation: three ways, one shared resolution

Hubs materialize in exactly three ways, all routing through the one shared resolution:

1. **`mage hub ensure` (plumbing verb):** Idempotent obtainment verb (`terraform init` analog). For each hub pair in metadata (external: one; hybrid: every `hub_refs[]` entry), it runs `resolveHubGrant`. If absent with a remote, it runs `git clone -- <hub_repo> <derived path>`. If present, it verifies arrival. It never prompts and never touches settings files.
   - Flags: `--check` resolves and reports without cloning; `--update` executes `git fetch` and `git merge --ff-only` (refusing on dirty tree or non-fast-forward).
   - Exit codes: `0` (present, cloned, or updated), `2` (origin mismatch), `3` (absent with no usable remote, including `local://` hubs), `4` (clone/update failed), `1` (any other error).
   - `mage connect` serves as the interactive human surface that gathers consent and calls the same obtain engine.
2. **`mage hub use <path>` (explicit registration):** Registers an existing clone that cannot be moved to the derived path (e.g. a cloud-attached sibling or harness-managed worktree). It verifies arrival at `<path>` (`looksLikeHub` plus canonical origin match against `hub_repo`) and records `{ "<canonical key>": "<absolute path>" }` in `$MAGE_HOME/redirects.json` (schema: `mage.redirects.v1`). Refuses on mismatch. `--clear` removes the entry. The redirect is machine-local, outside git tracking, and verified on every read.
3. **Human clone at the derived path:** Cloned directly to the derived path, verified identically on arrival.

**Resolution order (amends ADR-0043):**
`redirect` (if registered for the canonical key AND passes arrival verification) → `derived path` under `hubsRoot()` (with arrival check) → deprecated `hub_path` (shape check) → `absent`.

A registered redirect that fails arrival is skipped with a warning and reported by `doctor` as stale. Committed project-scope grants record only the home-relative derived form (`~/.mage/hubs/...`, [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) §8); redirects never appear in git-tracked files.

**Shared-function invariant survives and is strengthened:**
`chosenHubRoot` and `resolveHubGrant` remain the single resolution engine (with redirect maps injected by a shared loader). All entry points (`hub ensure`, `hub use`, `hub mandate`, `connect`, `doctor`, and `externalDocsRoot`) route strictly through this shared path without bespoke lookups.

### 3. Auth delegation to git

mage accepts no token flags, reads no token environment variables, and stores no credentials. `git clone` and `git fetch` resolve credentials entirely through git's native machinery (credential helper, `gh auth`, `GIT_ASKPASS`, or runner configuration).

The documented CI recipe is GitHub App authentication via `actions/create-github-app-token` scoped to the hub repository (with PAT-as-secret as documented fallback). The `setup-mage` action configures git credentials prior to invoking `mage hub ensure`.

### 4. Shipped setup surfaces

1. **CLI / npm package:** `npm install -g mage` / `npx mage`. Primary CLI surface with `mage hub ensure` and `mage connect --project`. No exported setup script is shipped.
2. **`setup-mage` marketplace action (`Sumit1993/setup-mage`):** Public GitHub Actions entry point. Inputs: `version` (default: latest), `token` (optional), `check` (boolean), `update` (boolean). It pins the CLI installation, configures git credentials when a token is provided, and invokes `mage hub ensure`. It is forbidden from parsing `metadata.json`, deriving paths, or implementing custom resolution logic.
3. **Committed `.claude/settings.json` (`mage connect --project`):** Writes project-scope settings at `<cwd>/.claude/settings.json`. Carries capture hooks, the home-relative reach grant `~/.mage/hubs/<host>/<owner>/<repo>`, and the SessionStart mandate hook. Forbidden from writing absolute paths, machine-specific values, or `autoMemoryDirectory` (the [ADR-0032](0032-capture-redirect-native-memory.md) commandeer tier remains local-scope only).
4. **Deferred:** Devcontainer feature and `mage init --ci` workflow scaffolder are deferred.

### 5. Cloud-sandbox arm and SessionStart mandate

In cloud sandboxes where repos are attached via harness primitives (`add_repo`), the hub arrives via the agent in response to a deterministic mandate:

- **Mandate emission:** The committed `.claude/settings.json` includes a SessionStart hook running `mage hub mandate`. This read-only verb resolves all hub pairs. When all hubs are verified present, it outputs nothing and exits 0. When any hub is absent, it prints the mandate block to stdout (delivered to the agent as session context) and exits 0 without network access or clone attempts.
- **Mandate format:**
  ```
  [mage hub mandate] External knowledge base ABSENT in this environment.
    hub:      <redacted address>            (from mage/metadata.json hub_repo)
    expected: <derived path under $MAGE_HOME/hubs>
    To make it available in this session:
      1. Attach the hub repo to the session: add_repo <owner>/<repo>
         (reason: "mage external knowledge base for project <project>")
      2. Register the attached clone: mage hub use <path where it was attached>
      3. Verify: mage doctor
    Until then, mage commands that write knowledge will refuse to run.
  ```
- **Absence handling (no silent degradation):**
  - Interactive KB-writing verbs in external mode with unresolved hubs fail fast (`requireDocsRoot` throws) with the mandate remedy and non-zero exit.
  - The hook capture path (`mage observe`) drops observations and exits 0 in this state rather than misfiling into code repo scratch.
  - `mage doctor` reports hub-absent as a failing check (non-zero) and flags stale redirects.
  - The mandate re-emits on every session start until resolved.

### 6. The detection line and process.env rule

Environment detection is partitioned into four strict categories:

- **A. Mechanism inputs (allowed, uniform everywhere):** `MAGE_HOME` (read only in `src/hub-url.ts`), CLI flags, `mage/metadata.json`, `$MAGE_HOME/redirects.json`, and git's credential machinery.
- **B. Cosmetic inputs (allowed, confined to `src/interactive.ts` and `src/logger.ts`):** `stdin/stdout.isTTY`, `CI`, `NO_COLOR`, `FORCE_COLOR`, `TERM`. Detecting CI may suppress a prompt, never alter the underlying answer.
- **C. Harness-adapter config reads (allowed, confined to `src/adapters/**`):** Reading host harness settings or harness-defined configuration variables.
- **D. Forbidden everywhere:** Branching on `GITHUB_ACTIONS`, `CODESPACES`, `CLAUDECODE`/sandbox markers, hostname, container heuristics, or vendor detection to select resolution order, clone behavior, auth, write targets, or settings scopes.

**Enforcement:** `process.env` access is restricted to `{src/hub-url.ts (MAGE_HOME only), src/interactive.ts, src/logger.ts, src/adapters/**}` and enforced by automated tests.

## Considered options

- **XDG split / multiple relocation variables:** Rejected. mage's machine-level state is a single semantic class; splitting creates multiple variables for zero benefit.
- **In-repo composite action as GHA surface:** Rejected. Field survey demonstrates external composite actions are dogfood-only; public distribution requires a standalone action repository.
- **`actions/cache` for the hub:** Rejected. Caches are evictable tarballs unable to perform git fetch/push operations.
- **`actions/checkout` + `mv` in CI:** Rejected. Forces arbitrary path moves; `mage hub ensure` maintains parity with local mechanisms.
- **Symlink at derived path for cloud siblings:** Rejected per [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) §3 due to unverified VM realpath semantics.
- **Moving attached siblings to `~/.mage/hubs/`:** Rejected. Breaks harness clone tracking and push wiring.
- **Per-hub environment variable overrides (`MAGE_HUB_PATH_<x>`):** Rejected. Unbounded namespace, invisible to doctor, and dies with the shell.
- **Mage-side token flag / token env var:** Rejected. Makes mage a credential handler; git natively manages credentials.
- **Blanket "no environment detection anywhere":** Rejected in favor of the enforceable narrow line that permits standard cosmetic adaptations (TTY, color) while keeping correctness paths invariant.

## Consequences

- Machine-wide state is strictly confined under `$MAGE_HOME`.
- Hub obtainment is standardized across local, CI, and cloud environments via `mage hub ensure` and `mage hub use`.
- Silent degradation on unresolved external hubs is eliminated.
- Automated tests enforce the `process.env` restriction.

## Relations

- amends [ADR-0043 — A hub is addressed by its remote, located by derivation](0043-hub-addressed-by-remote-located-by-derivation.md) (§1, §4, §5, and resolution order)
- amends [ADR-0044 — Setup is a conversation over one address](0044-setup-is-a-conversation-over-one-address.md) (§4 obtainment plumbing vs human interaction)
- honors [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) (mandate runs on host hooks without daemons or network)
- bounded_by [ADR-0032 — capture-redirect into native memory](0032-capture-redirect-native-memory.md) (`autoMemoryDirectory` commandeer tier stays local-scope only)
- extends [ADR-0025 — one transient-state home](0025-one-transient-state-home.md) (`$MAGE_HOME/redirects.json` as transient machine state)
- paired_with [ADR-0046 — mage runs git only in derived hub clones; adoption is ratified by a human git action](0046-derived-hub-git-and-merge-ratification.md)
