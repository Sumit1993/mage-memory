---
type: decision
tags:
  - mage/decisions
created: "2026-07-27"
updated: 2026-07-27
last_reviewed: 2026-07-27
status: proposed
provenance:
  repo: mage-memory
  work: adr-0042-reach-tier
sources:
  - decisions/0032-capture-redirect-native-memory.md
  - decisions/0036-defer-harness-adapter-seam.md
  - decisions/0037-readiness-doctor-remit-and-autofix-line.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - src/commands/connect.ts
  - src/adapters/claude-code/settings.ts
  - notes/connect-doesnt-ensure-ignores.md
  - cc-session:fcc130b6-ad37-480e-b975-caf13add356c
keywords:
  - reach-tier
  - additional-directories
  - external-mode
  - hybrid
  - hub-access
  - permissions
  - grant
  - commandeer-tier
  - settings-local
  - worktree
  - portability
  - t3code
modified: 2026-07-27T17:20:22.726Z
---

# 0042 — the reach tier: mage grants the harness access to an out-of-repo knowledge base

> **Status: proposed.** Output of a 2026-07-27 grill prompted by onboarding repos into
> t3code (a wrapper over Claude Code and other harnesses). Sibling to the ADR-0032
> commandeer tier, deliberately gated apart from it.

## Context

`mage connect` wires capture hooks and, for the commandeer tier, points Claude Code's
`autoMemoryDirectory` at the KB docs root. For `mode: external` that root lives in a
**different repo** — the hub. Claude Code confines file access to the project root, so
the agent was pointed at a knowledge base it had no permission to read: every note read
became a permission prompt mid-task, and `autoMemoryDirectory` named a path the agent
could not open.

The drift was live and silent. On the author's machine `prismalens` had a hand-added
`permissions.additionalDirectories` entry; `sreforge` — same external shape, same hub
pattern — had `autoMemoryDirectory` set and **no grant**. Nothing detected the
difference, because nothing knew the grant was part of a working setup.

This is the third instance of one bug shape: `connect` turns a capability on without
ensuring its precondition (see [connect-doesnt-ensure-ignores](../notes/connect-doesnt-ensure-ignores.md)).
The durable fix is therefore split between the writer and `doctor`, not left in the writer alone.

The trigger was an editor change (t3code has no multi-root workspace; a project is one
`workspaceRoot`), but the bug is not editor-specific — t3code executes Claude Code's own
`.claude/settings.local.json`. VS Code's multi-root workspaces had been masking it by
keeping both repos in one window.

## Decision

**1. A grant tier independent of the commandeer tier.** Gated on LOCAL scope and a KB
that lives outside the code repo — **not** on `isAutoMemoryEnabled`. Reading the KB and
redirecting memory writes are separate concerns; disabling CC auto-memory must never
sever filesystem reach to the knowledge base.

**2. The grant set is a pure function of metadata**, `outOfRepoKbRoots(meta, projectRoot)`:

| mode | grants |
| --- | --- |
| in-repo | none — docs sit at `<repo>/mage/`, already under the project root |
| external | `hub_path` — the hub REPO root |
| hybrid | every `hub_refs[].hub_path` |

External grants the hub **repo root**, not the project docs root beneath it: the hub top
carries its own `INDEX.md`/`decisions/`/`notes/` plus the cross-project `_index.*` files,
so one grant covers both levels and following a hub-root link never prompts. This pairs
with the commandeer tier rather than duplicating it — `autoMemoryDirectory = kb.root`
(*where memories land*), `additionalDirectories += hub_path` (*what the agent may reach*).
Paths at or under the project root are dropped (self-referential when cwd is inside the hub).

**3. Hybrid is included**, justified by array semantics rather than by anticipated
harnesses: `additionalDirectories` is an array, so an ownership record is required for
`disconnect` regardless, and N grants is then a loop rather than new machinery.
Speculative-integration reasoning would have invited [ADR-0036](0036-defer-harness-adapter-seam.md)
as a counter; this rationale does not.

**4. `connect` is the sole writer of host config.** `link`/`init` inherit it (they already
delegate to `connect`). `doctor` **detects and instructs** — it does not write, so
[ADR-0037](0037-readiness-doctor-remit-and-autofix-line.md) §2's "read-only (never writes
host config)" stands unamended. Note the tension this resolves: the repair passes §3's
auto-fix test (idempotent ∧ mage-owned ∧ local ∧ reversible), so §3 *would* permit
`doctor --fix` to write it. We decline, because one host-config writer is the invariant
worth more than saving the user one idempotent command — and every drift case (missing
grant, orphaned grant, fresh worktree) then collapses to a single remedy.

**5. Ownership is recorded, not inferred** — `mageOwnedAdditionalDirectories`, mirroring
the `mageStashedAutoMemoryDirectory` precedent. mage records only entries it actually
inserted; a path the user already listed is granted for free and never claimed, so
`disconnect` leaves it. `connect` reconciles **both** directions, so a moved hub sheds its
stale grant. Inferring the set from metadata at disconnect time was rejected: `hub_path`
changes and metadata may already be unlinked, orphaning the grant with nothing recording it.

**6. `unlink` leaves orphans**; `doctor` detects and the next `connect` reconciles. Keeps
`unlink` narrow and non-surprising; a stale entry granting read access to a directory is inert.

**7. Only a real hub root is granted — `hub_path` is untrusted input.** `metadata.json` is
git-tracked, so anyone who can land a commit controls `hub_path`. Existence alone is not a
sufficient gate: pointed at `~/.ssh` or `/`, it would widen harness access to an arbitrary
directory on the next `mage connect`. The writer requires `looksLikeHub` (a `projects/` dir
plus a hub `metadata.json`), which every legitimate grant target has. This subsumes the
absent-hub case — a hub not cloned on this machine and a path that is not a hub are both
simply "no hub here": warn, grant nothing, record nothing. Routine on a fresh clone
(`hub_path` is absolute and machine-specific), so it is a supported state, not an error.
`doctor` mirrors the same gate rather than `exists`, or it would nag for a fix `connect`
will never make.

**8. doctor reports it as a failing RECALL check, three-state.** Grant missing while the
hub exists → **fail** (the agent cannot read its own KB — the same class as a stale index,
and worse in practice). Hub absent → **skip**, optional-pass with a note, so a CI runner
that never clones the hub is not failed. Grant present → pass. The check reads BOTH local
and user scope, because Claude Code concatenates array-valued settings across scopes — a
grant placed in `~/.claude/settings.json` is genuinely effective.

## Explicitly out of scope

- **The `HarnessAdapter` seam.** Written Claude-Code-concrete. `outOfRepoKbRoots` is
  harness-neutral (it returns paths, never policy) so a second harness consumes it directly.
  [ADR-0036](0036-defer-harness-adapter-seam.md)'s revisit trigger is unchanged: a second
  harness. **t3code is not one** — it executes Claude Code's own settings and hooks.
- **Worktree propagation.** `settings.local.json` is gitignored, so it never reaches a new
  worktree, and Claude Code exposes no worktree-creation hook. Mitigated only: doctor's
  check flags a bare worktree and the remedy is `mage connect`. Needs its own research.
- **Project-scope (git-tracked) grants.** Blocked structurally, not by Claude Code: a
  committed `settings.json` is the same file in every worktree, while the hub sits at a
  different relative offset from each, so no single project-relative path is correct from
  both. Environment-variable indirection is also dead in practice — a t3code server process
  carries ~18 environment variables, none from a shell profile.

## Revisit trigger

**The hub is addressed by remote, located by derivation.** `hub_repo` is already recorded
in every `metadata.json` and read by nothing. If the local hub path were *derived* from it
(a deterministic location such as `~/.mage/hubs/<slug>`, cloned on demand) rather than
recorded, the derived path would be identical on every machine and from every worktree —
which unlocks git-tracked project-scope grants, portable clones, and hub-absent machines in
one move, and retires the absolute-`hub_path` smell. The open question that grill must
settle: derived-path determinism **versus** reusing a local clone the user already edits
(preferring an existing clone destroys the determinism that makes it work; a symlink at the
derived path is the candidate synthesis, unverified on both Claude Code symlink-following
and WSL behaviour).

## Consequences

- **Gate-0 does not cover manual hub writes when the commandeer tier is off.** The grant
  permits Write/Edit and the scrub hook is commandeer-gated. **Gate-2 remains the durable
  boundary** — `mage connect` installs `mage:redact-precommit` in the hub repo, so a staged
  secret is caught at commit. Accepted deliberately, not overlooked.
- **Grant widening is bounded by hub-shape, not by trust in the repo.** A hostile or
  mistaken `hub_path` cannot widen access beyond a directory that is already a mage hub.
  The residual exposure is a *legitimate* hub whose contents an attacker controls — which
  is the same trust boundary as the notes themselves, not a new one.
- **A pre-existing crash was fixed as a prerequisite.** `ensureSinkIgnores` threw ENOENT
  when `mode: external` resolved through a `hub_path` absent on this machine, aborting
  `connect` entirely — which made §7's "skip and warn" unreachable. Now fail-open.
- **The containment rule was consolidated.** `isUnder` existed in five places; it now lives
  once in `paths.ts` and the two named copies import it.
- **`doctor` gains a required check that can fail a previously-passing repo** — correctly:
  `sreforge` fails today and is genuinely misconfigured.

## Relations

- sibling_of [ADR-0032 — capture-redirect into the git-durable pipeline](0032-capture-redirect-native-memory.md) (the commandeer tier this is gated apart from)
- constrained_by [ADR-0036 — defer the HarnessAdapter seam](0036-defer-harness-adapter-seam.md)
- constrained_by [ADR-0037 — doctor's remit and the auto-fix line](0037-readiness-doctor-remit-and-autofix-line.md) (§2 keeps doctor read-only here)
- extends [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- recurrence_of [connect doesn't ensure ignores](../notes/connect-doesnt-ensure-ignores.md) (same bug shape: connect enables a capability without its precondition)
