---
type: decision
tags:
  - mage/decisions
created: "2026-08-29"
updated: 2026-08-29
last_reviewed: 2026-08-29
status: proposed
provenance:
  repo: mage-memory
  work: adr-0047-machine-bindings
sources:
  - decisions/0012-wings-optional-convention-standalone-hubs.md
  - decisions/0043-hub-addressed-by-remote-located-by-derivation.md
  - decisions/0044-setup-is-a-conversation-over-one-address.md
  - decisions/0045-cross-environment-presence.md
  - src/paths.ts
  - src/commands/link.ts
  - src/commands/doctor/link-checks.ts
keywords:
  - metadata-schema
  - machine-binding
  - code-repo-path
  - hub-path
  - metadata-local
  - one-carrier
  - portable-metadata
---

# 0047 — Machine bindings leave committed metadata

> **Status: proposed (2026-08-29).** Settles which file owns which configuration key, so a
> knowledge base's committed metadata stays portable across every machine
> [ADR-0045](0045-cross-environment-presence.md) reaches. Amends
> [ADR-0012](0012-wings-optional-convention-standalone-hubs.md). Child of ADR-0045.

## Context

A knowledge base's committed `metadata.json` currently mixes values that are true everywhere with
values that are true on exactly one machine. From `prismalens/prismalens`, committed and shared:

```json
{
  "mode": "external",
  "project": "prismalens-platform",
  "hub_path": "/home/sumit/.mage/hubs/github.com/prismalens/prismalens-kb",
  "hub_repo": "https://github.com/prismalens/prismalens-kb.git"
}
```

`hub_repo` is portable. `hub_path` names one laptop's home directory and is wrong on every other
machine. A live GitHub Actions run on 2026-08-29 (run `33254009691`, which opened and closed
`prismalens/prismalens-kb#26`) confirmed mage already ignores the stored value and re-derives the
path from `hub_repo` and `MAGE_HOME`. The field does not merely fail to help. It states something
false and invites a reader to trust it.

The hub-side registry has the same shape: `projects[].code_repo_url` is portable,
`projects[].code_repo_path` is not. That one is worse than dead weight, because `doctor --fix`
writes the running machine's path back into the **committed** file
(`src/commands/doctor/link-checks.ts:144`), so every machine that heals the hub churns a shared
file against every other machine.

ADR-0045 settles where a hub lives and how a machine reaches it. It does not say what may be
written inside a knowledge base's metadata, and the two questions have now collided.

## Decision

### 1. One carrier per key class, and carriers never merge

Every key mage reads belongs to exactly one file. There is no precedence stack, no deep merge, and
no layer that overrides another, because no two carriers ever hold the same key.

| Key class | Carrier | Committed | Who may write it |
|---|---|---|---|
| Portable identity (`mode`, `project`, `hub_repo`, `name`, `projects[].{name, storage, code_repo_url}`) | the knowledge base's `metadata.json` | yes | whoever may merge to that repo |
| Policy (`grooming`, `redact`, `genres`) | the knowledge base's `metadata.json` | yes | whoever may merge to that repo |
| Machine binding, derivable (the hub path) | nothing; derived at runtime from `hub_repo` + `MAGE_HOME` | n/a | nobody, it is computed |
| Machine binding, non-derivable (`code_repo_path`) | `metadata.local.json` beside the committed file | no, gitignored | the machine itself |
| Secrets | no carrier; git resolves credentials (ADR-0045 §4) | never | nobody |

### 2. Policy is read from the knowledge base, never from the code repo

In external mode a code repo's `mage/metadata.json` answers only "which knowledge base am I, and
where does it live". The hub's own `metadata.json` answers "what is this knowledge base, and what
may be done to it". `grooming` is already read exclusively from the resolved knowledge base, so a
`grooming` block in an external-mode code repo has no effect today. That accident becomes a rule,
and `doctor` warns when it finds one. If a shorthand is wanted: the hub wins, because the code repo
is never asked.

### 3. A derivable binding is derived, and its field removed

`hub_path` and `hub_refs[].hub_path` leave the schema, completing what
[ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) §6 slated and
[ADR-0044](0044-setup-is-a-conversation-over-one-address.md) sequenced.

Derivation takes two inputs, `MAGE_HOME` and a canonical remote identity, and yields
`$MAGE_HOME/hubs/<host>/<owner>/<repo>`. So the field is derivable whenever `hub_repo` exists, which
is every hub reached over a remote.

**The field is worse than dead weight: it wins over correct derivation.** Measured in a Claude Code
cloud session on 2026-08-29. The hub was present at the derived path
(`/home/user/.mage/hubs/github.com/prismalens/prismalens-kb`, a symlink to the harness's checkout),
`MAGE_HOME` was set to `/home/user/.mage` and passed explicitly on the command line. `mage doctor`
still resolved the hub to the committed `hub_path` value, `/home/sumit/.mage/hubs/...`, a directory
that does not exist in that container, and reported `link integrity: hub_path not reachable`.
`mage connect --yes` then wired thirteen hook events and pointed Claude Code's `autoMemoryDirectory`
at that unreachable path, so every capture write would have failed silently. The remedy `doctor`
offers, `mage link <hub-path>`, repairs the container by writing the container's own absolute path
into the **committed** `mage/metadata.json`, which is the multi-machine churn described above,
arriving by a second route.

An earlier reading of this decision held that mage "already ignores `hub_path` and re-derives",
generalising from the GitHub Actions probe where the hub sat at the derived path with no symlink and
derivation did win. That generalisation is wrong and is corrected here. A committed machine binding
does not merely fail to help on a foreign machine. It overrides the correct answer. It is not derivable for a hub that has no remote at all, created
locally and never pushed, because there is no host, owner, or repo to derive from. `src/hub-url.ts`
rejects local paths for exactly this reason and `src/paths.ts` falls back to `hub_path` only when
`hub_repo` is missing or will not canonicalize. That single case is what ADR-0044's proposed
`local://<name>` scheme exists to close.

Because the field overrides derivation rather than merely sitting unused, removal is more urgent
than "deprecated" implies. Removal of the *field* still waits on `local://`, since a remoteless hub
has nothing else to stand on, but **reading** it must be narrowed first: `hub_path` is consulted
only when `hub_repo` is absent or will not canonicalize, never as a fallback when derivation
produced a path that exists. And **writing** it waits on nothing. mage stops
writing `hub_path` and `hub_refs[].hub_path` for any hub whose `hub_repo` canonicalizes, at all four
write sites in `src/commands/link.ts`, and keeps the read fallback for remoteless hubs. New
knowledge bases stop being born carrying a false path immediately, and the field withers by
attrition rather than needing a migration to remove it.

### 4. A non-derivable binding moves to a gitignored file

`projects[].code_repo_path` cannot be derived. Hubs sit at a fixed derivation under `MAGE_HOME`;
code repos sit wherever their owner cloned them. It is also genuinely consumed, by doctor's
back-reference healing, `connect --all`, verify, status, list, the dashboard, and the in-repo
pointer decoration ADR-0012 §2 requires. So it is relocated, not deleted:

```json
{
  "schema": "mage-local.v1",
  "code_repo_paths": { "prismalens-platform": "/home/sumit/sources/prismalens-org/prismalens" }
}
```

A flat map keyed by project name, deliberately not a shadow of `metadata.json`. A carrier holding
one key class needs no merge semantics, and a shape that cannot express policy cannot leak policy
into an ignored file. The writer ensures the `.gitignore` entry before writing, and `doctor` checks
the ignore holds.

### 5. A missing local file is never an error

ADR-0045 §8 rules that a bare clone is the whole of "connected". `metadata.local.json` is a
convenience, never a prerequisite. Absent, mage degrades exactly as it does today when a path is
unknown, and heals through `doctor --fix` or `mage link`.

## Considered options

**Fold all of this into ADR-0045.** Rejected in part, accepted in part. The environment-carrier and
environment-identity corollaries genuinely belong to 0045 and are amended into it as §10, and the
consent-carrier rule belongs to 0046 §5. What remains is a schema decision that introduces a new
file, which would be buried inside a nine-section ADR about locating hubs.

**A general precedence stack (system, user, project, local, env).** Rejected. It is what mature
tools converge on, but ADR-0045 §8 forbids the machine-state layers it depends on, and mage has no
fleet administrator distinct from the knowledge base owner, so the managed tier has no owner.

**Delete `code_repo_path` outright.** Rejected on evidence. Nothing can derive it and eight call
sites consume it.

## Consequences

- Committed metadata becomes portable, so a checkout on a runner or a sandbox carries no false
  paths and no other machine's state.
- The `doctor --fix` multi-machine churn on shared hub metadata stops.
- One more gitignored file to explain during onboarding, and one more thing that can be absent.
- Existing knowledge bases carry dead fields until `mage migrate` runs; readers fold with a
  fallback for one release.

## Relations

- child_of [ADR-0045 — Cross-environment presence](0045-cross-environment-presence.md)
- amends [ADR-0012 — A wing is an optional convention; hubs are standalone-first](0012-wings-optional-convention-standalone-hubs.md) (HubProject loses committed `code_repo_path`; the pointer rendering reads the local carrier)
- completes [ADR-0043 — A hub is addressed by remote and located by derivation](0043-hub-addressed-by-remote-located-by-derivation.md) (§6, the `hub_path` removal)
- sequenced_by [ADR-0044 — Setup is a conversation over one address](0044-setup-is-a-conversation-over-one-address.md) (`local://` lands before `hub_path` goes)
- paired_with [ADR-0046 — A branch and a pull request are the only way knowledge lands](0046-derived-hub-git-and-merge-ratification.md)
