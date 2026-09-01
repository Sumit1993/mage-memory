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
  - decisions/0025-one-transient-state-home.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - src/hub-url.ts
  - src/paths.ts
  - src/commands/connect.ts
keywords:
  - cross-environment
  - mage-home
  - derived-path
  - no-substitute
  - bare-clone
  - environment-detection
  - github-actions
  - example-workflow
---

# 0045 — Cross-environment presence: one state root, one place a hub can be, and no silent substitute

> **Status: proposed (2026-08-22).** Settles how mage finds and obtains an external hub on any
> machine — laptop, CI runner, or cloud sandbox — and what it does when it cannot. Amends
> [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) and
> [ADR-0044](0044-setup-is-a-conversation-over-one-address.md). Paired with
> [ADR-0046](0046-derived-hub-git-and-merge-ratification.md).

## Context

[ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) settled that a hub is addressed
by its remote and located by derivation. [ADR-0044](0044-setup-is-a-conversation-over-one-address.md)
settled that setup is a conversation over that one address. Running the same knowledge base from a
CI runner and a cloud sandbox exposed what those two left open: how a hub arrives on a machine
nobody is sitting at, and what mage does when it has not arrived.

The second question turned out to be the urgent one. In external mode with the hub unreachable,
`resolveDocsRoot` today returns the code repo's own `mage/` directory. Capture then writes notes
into the repo under review, which is the one outcome external mode exists to prevent, and nothing
distinguishes "this project has no hub" from "this project's hub is missing right now".

## Decision

### 1. One machine state root

Everything mage keeps machine-wide lives under `$MAGE_HOME`, default `~/.mage`. No XDG split, and
no second relocation variable. The derivation below that root is fixed by
[ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) §2.

`MAGE_HOME` is a supported public contract, not a test hook, and CI depends on it: a runner points
it inside the workspace so an ordinary checkout can place the hub where derivation expects.

### 2. A hub lives at its derived path, and nowhere else

There is exactly one place a hub clone can be. mage does not consult a registry, follow a redirect,
or accept a pointer to a clone that lives somewhere else. A clone that cannot be at the derived
path is not reachable, and mage says so rather than adapting.

The consequence is deliberate and stated rather than hidden: in an environment that attaches
repositories at fixed paths of its own choosing and forbids moving them, mage works only if
`MAGE_HOME` can be set such that the attached path *is* the derived path, or if the hub can be
cloned again. Where neither holds, mage does not run there.

This completes the retirement of `hub_path` as a location of record.

### 3. Obtaining stays inside `connect`, with consent

Cloning a hub is something `connect` already does, after asking. No separate obtain verb exists.
Consent is the human answering, or `-y` standing in for that answer where a human has decided in
advance.

### 4. mage never handles credentials

mage accepts no token flag and reads no token variable. It runs git; git resolves credentials from
whatever the machine already has — a credential helper, an authenticated CLI, or a checkout that
persisted them. Whoever prepares an environment is responsible for git being able to clone there,
which every CI recipe already knows how to do.

### 5. An unreachable hub is never substituted

Resolution reports three distinct states: no knowledge base, a knowledge base, and a hub that
should be reachable but is not. The third never silently becomes the second.

- Where a human can answer, the command says the hub is unreachable and offers to clone it.
- The capture hook cannot ask, because its input arrives on stdin and it must not block a tool
  call. It drops the observation and exits clean.
- `doctor` reports an unreachable hub as failing.

What never happens is writing knowledge into the code repo because the hub was missing.

### 6. The session-start message carries it

An agent starting work in an environment where the hub never arrived learns this from the existing
session-start nudge, which already runs on startup and resume and already addresses the agent on
its own channel. This message is exempt from the backlog throttle: a missing hub is a state, not a
periodic reminder.

No new verb and no new hook registration is introduced for this.

### 7. No correctness path branches on environment identity

Nothing that decides where a file goes, what gets written, or whether an action is permitted may
branch on which environment it is running in. Vendor markers, CI flags, container tells and
hostnames are all excluded from those paths.

Reading the environment to pass it to a child process, or to record which harness produced a
capture, is not branching and is unaffected. Presentation — colour, prompting, progress output —
may adapt, provided the underlying answer does not change.

Mechanism reaches mage through arguments, configuration and `MAGE_HOME`, which is a knob any
machine can set; CI is simply a machine that sets it. How this is enforced is an implementation
concern and may change without reopening this decision.

### 8. A bare clone is the whole of "connected"

mage requires no machine-local state beyond the repositories themselves. Everything needed to
resolve, read and write a knowledge base lives inside the repos. Hooks and settings written by
`connect` serve capture; they are never prerequisites for resolution or for writing notes.

This is what lets a runner check out a hub and use it immediately, and it is why §2 can be absolute.

### 9. What ships

The npm package is the product. Alongside it, this repository carries an example GitHub Actions
workflow and a guide page showing how `MAGE_HOME` and the derived path fit together, and mage's own
CI exercises that same recipe against a fixture hub so the example cannot rot unnoticed.

No marketplace action and no separate action repository. mage is a Node CLI; the runtime that
installs it is already standard, and the remaining steps compose from maintained actions. A wrapper
would be a versioned support surface with no functional gain.

### 10. Configuration reaches mage as a given value, never as a detected identity

Two corollaries, one of §1 and one of §7, stated here because both were reopened by running mage in
real CI.

`MAGE_HOME` is the only environment variable that carries a policy or configuration value mage
reads outside a harness adapter. No policy key gains an environment carrier, and none gains a
generic `-c key=value` flag. The reason is not that
environment variables are untrustworthy. It is that a mechanical mapping from key path to variable
name auto-mints a carrier for every field anyone ever adds, including write-enables, so the trust
question would have to be re-answered per field forever. A curated table makes granting a carrier a
reviewed decision, and the table currently holds one entry. Prior art splits along exactly this
line: the mechanical mappers (Terraform, npm) run where the environment's setter is the trusted
operator by construction, while the tools that run inside repositories of mixed trust (git, Codex,
Claude Code) all curate.

An environment-*selected* configuration layer is forbidden. A profile auto-chosen by detecting
Actions, a container, or a vendor marker is §7's prohibition wearing a config file as a disguise. A
config file is a value somebody chose; identity detection is a value nobody chose. Configuration
may vary per machine only through values that machine was explicitly given.

What may live in which file is settled by
[ADR-0047](0047-machine-bindings-leave-committed-metadata.md).

## Considered options

- **A registry or redirect file mapping a hub to wherever it actually is.** Rejected. It buys one
  environment at the cost of a second resolution path that every consumer must honour, and machine
  state that §8 exists to forbid.
- **A dedicated obtain verb.** Rejected. `connect` already clones, and a second entry point for the
  same act is surface without capability.
- **A marketplace action.** Rejected. The pattern across comparable tools is that compiled binaries
  needing platform-specific installation ship setup actions, while npm-distributed CLIs document a
  recipe. A solo-maintained action repository is a liability, as pre-commit's own retreat to
  maintenance-only shows.
- **XDG split.** Rejected. mage's machine state is one class; splitting it costs three variables to
  relocate one directory.
- **A token flag or token variable.** Rejected. It makes mage a credential handler and duplicates
  what git already does.
- **Blanket "no environment detection anywhere".** Rejected as unenforceable and wrong at the edges:
  it convicts passing the environment to a subprocess and recording which harness ran, neither of
  which changes an answer.
- **Degrading to the code repo when the hub is missing.** Rejected. It is today's behaviour and it
  misfiles knowledge silently.

## Consequences

- Machine-wide state stays under one root, and relocating it stays a one-variable operation.
- One resolution path, with no environment ever taking a different route through it.
- Environments that cannot host a clone at the derived path are unsupported, explicitly.
- The silent substitution of the code repo's knowledge base ends; capture drops rather than misfiles.
- Whoever prepares an environment owns git credentials there.
- Setup instructions for CI are documentation plus an example, and mage's own CI keeps them honest.

## Relations

- amends [ADR-0043 — A hub is addressed by its remote, located by derivation](0043-hub-addressed-by-remote-located-by-derivation.md) (`MAGE_HOME` as public contract; derived path as the only location)
- amends [ADR-0044 — Setup is a conversation over one address](0044-setup-is-a-conversation-over-one-address.md) (§4: `connect` obtains, `link` registers, no obtain verb)
- honors [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) (the session-start message rides an existing hook and makes no network call)
- extends [ADR-0025 — one transient-state home](0025-one-transient-state-home.md)
- parent_of [ADR-0047 — Machine bindings leave committed metadata](0047-machine-bindings-leave-committed-metadata.md)
- paired_with [ADR-0046 — a branch and a pull request are the only way knowledge lands](0046-derived-hub-git-and-merge-ratification.md)
