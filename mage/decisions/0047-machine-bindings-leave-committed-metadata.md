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
| Machine binding, non-derivable (`code_repo_path`) | none; the field is removed and nothing replaces it | n/a | nobody |
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
has nothing else to stand on. **Reading** it needs narrowing in two places, and they are not the
same fix.

The first is correct but insufficient: `hub_path` is consulted only when `hub_repo` is absent or
will not canonicalize, never as a fallback when derivation produced a path that exists. That closes
`chosenHubRoot` (`src/hub-url.ts`), which already rejects local paths and reaches `hub_path` only
when there is no remote to derive from.

The second is the fallback that actually fired in the incident measured above, and an earlier draft
of this section named the wrong one. [#191](https://github.com/Sumit1993/mage-memory/issues/191),
"hub_path overrides correct derivation even when the derived path exists," traced it to
`externalDocsRoot`'s post-derivation fallback (`src/paths.ts:672-677`). `chosenHubRoot` had already
picked the derived path and derivation had already succeeded; the narrowing above does nothing
here. If `verifyHubArrival` on that derived path does not return `ok`, `externalDocsRoot` falls back
to `meta.hub_path` anyway, whenever it looks hub-shaped, including on a hard origin mismatch. The
code says as much: `// fall back to the deprecated hub_path (incl. on a mismatch)`.

`resolveHubGrant` (`src/paths.ts:860-876`) makes the same call for permission grants that
`externalDocsRoot` makes for reads, and its doc comment says the two "mirror" each other so "a grant
decision never drifts from a docs-root decision" (`src/paths.ts:857-859`). The code does not hold to
that claim: on `arrival.reason === "origin-mismatch"`, `resolveHubGrant` returns
`{ root: null, reason: "mismatch" }` and does not fall back, while `externalDocsRoot` falls back on
that same mismatch. The two functions had already drifted from each other on exactly the case each
one's own comments claim to guard against.

**Ruling (2026-09-01).** On an origin mismatch at the derived path, the derived path wins. mage uses
it, reports the mismatch loudly, and never falls back to `hub_path` for this case.
`externalDocsRoot` and `resolveHubGrant` both change to agree, closing the drift between them. The
other arrival failures, an absent hub, the wrong shape, or an unreadable origin, keep the existing
fallback to `hub_path` for now; only the mismatch case changes.

This accepts a risk: if a genuinely different hub sits at the derived path, mage will use it. The
alternative was a renamed remote or a fork blocking every read until the operator hand-edits
metadata on the affected machine, and the renamed-remote cost was judged higher. It is the common
case, and `hub_path` was already committed state a reader had no business trusting once derivation
succeeds.

And **writing** it waits on nothing. mage stops
writing `hub_path` and `hub_refs[].hub_path` for any hub whose `hub_repo` canonicalizes, at all four
write sites in `src/commands/link.ts`, and keeps the read fallback for remoteless hubs. New
knowledge bases stop being born carrying a false path immediately, and the field withers by
attrition rather than needing a migration to remove it.

### 4. A non-derivable binding is dropped, not relocated

`projects[].code_repo_path` cannot be derived; hubs sit at a fixed derivation under `MAGE_HOME`,
code repos sit wherever their owner cloned them. An earlier draft of this section relocated it to a
gitignored `metadata.local.json` beside the committed file. **Ruling (2026-09-01): the field is
dropped instead, along with the hub-side fan-out it exists for.** No local carrier replaces it.

No prior-art tool commits an absolute filesystem path to a shared repo so a central store can reach
outward into a consumer checkout. Storing a repo path locally is standard. Claude Code's
`~/.claude.json` and Codex CLI's `~/.codex/config.toml` both do it, but neither tool reaches into
the target repo with that path; each remembers only where to relaunch or what trust applies.
`connect --all-projects`, mage's own feature that writes settings files into other checkouts from a
central registry, was found in no other tool.

An earlier draft of this section claimed `code_repo_path` was "genuinely consumed" by eight peers.
That both overstated some and missed one; the corrected count is seven load-bearing consumers:

- `connect.ts:518,527`. `connect --all-projects` reads the path to check the code repo is present,
  then uses it as the `cwd` to wire hooks into that repo.
- `kb-checks.ts:192,197`. Doctor's per-project liveness rollup: present-on-this-machine and
  connected counts.
- `status.ts:91`. Status's hub expansion, collecting each registered project's path to check.
- `link-checks.ts:172-173`. The hub-side advisory listing registered projects whose code repo
  isn't present here.
- `collect.ts:500-501`. The dashboard's cloned flag; the path itself is truncated to a basename
  (`html.ts:102`) before it reaches a client.
- `verify.ts:196-207`. `mage verify`'s per-project check for a repo-owned project: is its code repo
  reachable here.
- `index-cmd.ts:209-211,233-238`. ADR-0012 §2's own in-repo-member pointer (`pushLinkedRepos`),
  which writes `code_repo_path` verbatim into the generated, committed `INDEX.md`
  ("notes live in `<path>/mage` → open its INDEX"), with no fallback to `code_repo_url`. This is a
  second instance of the anti-pattern section 3 closes for `hub_path`: a local machine path landing
  in a shared, committed file. It needs its own fix as part of removal.

Two more read the field without being load-bearing:

- `list.ts:57` sets a `codeRepo` field on the returned `ProjectInfo` and never reads it back; the
  printed table (`list.ts:93-105`) never includes it. Dead.
- Doctor's back-reference healing (`link-checks.ts:130-160`) doesn't need the field to find its own
  location; it already has that from `cwd`. It reads the hub's stored copy only to check it against
  the true path and heal it when stale, on behalf of the seven sites above that do rely on the value
  being correct.

An earlier draft also credited `index-cmd.ts:207-208` with sidestepping the field by preferring
`code_repo_url`. That line is real but is a different feature: it decorates a wing heading with
"code repo: `ref`" for any registered project (`decorationByWing`), not ADR-0012 §2's in-repo
pointer, which is `pushLinkedRepos` and does not prefer `code_repo_url`. Both errors are corrected
here.

Dropping the field costs the seven sites above the value outright, with no relocation to fall back
to. `connect --all-projects` and the ADR-0012 §2 pointer are the two that most directly need a
replacement, a target to wire into, a location to point a reader at. The rest degrade to "unknown"
the same way they already do for a legacy hub with no registry. The removal work, dropping the
field, the four `link.ts` write sites' hub-side counterpart, and updating the seven consumers
above, needs its own tracking issue: [#193](https://github.com/Sumit1993/mage-memory/issues/193),
"Remove code_repo_path and the hub-side fan-out it exists for."

Android's `repo` manifests and Chromium's `gclient` DEPS are the closest prior art for reverse
linkage done safely. Both commit paths, but relative to a root the tool itself creates and controls,
never absolute, and `repo`'s own docs forbid absolute paths. If a hub ever needs to point back at a
code repo again, that is the shape to copy, not this one.

## Considered options

**Fold all of this into ADR-0045.** Rejected in part, accepted in part. The environment-carrier and
environment-identity corollaries genuinely belong to 0045 and are amended into it as §10, and the
consent-carrier rule belongs to 0046 §5. What remains is a schema decision that introduces a new
file, which would be buried inside a nine-section ADR about locating hubs.

**A general precedence stack (system, user, project, local, env).** Rejected. It is what mature
tools converge on, but ADR-0045 §8 forbids the machine-state layers it depends on, and mage has no
fleet administrator distinct from the knowledge base owner, so the managed tier has no owner.

**Delete `code_repo_path` outright.** First rejected on a call-site count: eight peers were
believed to consume it, too many to strand without a replacement. **Accepted (2026-09-01)** once
that count was corrected to seven load-bearing consumers (§4) and prior art was checked rather than
assumed. No tool commits an absolute filesystem path to a shared repo so a central store can reach
outward into a consumer checkout. Local path registries are standard, Claude Code's
`~/.claude.json` and Codex CLI's `~/.codex/config.toml` both keep one, but neither reaches into the
target repo with it; each remembers only where to relaunch or what trust applies.
`connect --all-projects`, mage's own feature that writes settings files into other checkouts from a
central registry, was found in no tool at all. That absence, not the corrected count alone, is what
changed the answer.

**Relocate `code_repo_path` to a gitignored `metadata.local.json` beside the committed file.** What
an earlier draft of §4 prescribed. Rejected: once deletion was accepted, no local carrier is needed
for a field nothing derives and only the machine itself already knows, and a local file is one more
thing to explain during onboarding for consumers that no longer read it.

## Consequences

- Committed metadata becomes portable, so a checkout on a runner or a sandbox carries no false
  paths and no other machine's state.
- The `doctor --fix` multi-machine churn on shared hub metadata stops.
- Seven consumers lose their input and need reworking or removing, three of which degrade
  silently today. `connect --all-projects` loses the ability to fan out at all, since writing
  settings into another checkout is the behaviour being retired.
- Every hub's committed `INDEX.md` currently carries one machine's absolute paths, written by
  `pushLinkedRepos`/`inRepoMembers` (`src/commands/index-cmd.ts:209-211,233-238`), so existing
  hubs need regenerating, not just a schema migration.
- Whatever ADR-0012 §2's pointer requirement becomes, it can no longer be a filesystem path.
- Existing knowledge bases carry dead fields until `mage migrate` runs; readers fold with a
  fallback for one release.

## Relations

- child_of [ADR-0045 — Cross-environment presence](0045-cross-environment-presence.md)
- amends [ADR-0012 — A wing is an optional convention; hubs are standalone-first](0012-wings-optional-convention-standalone-hubs.md) (HubProject loses `code_repo_path` outright, not relocated; §2's in-repo pointer, which reads the field directly, loses its filesystem detail and needs its own fix)
- completes [ADR-0043 — A hub is addressed by remote and located by derivation](0043-hub-addressed-by-remote-located-by-derivation.md) (§6, the `hub_path` removal)
- sequenced_by [ADR-0044 — Setup is a conversation over one address](0044-setup-is-a-conversation-over-one-address.md) (`local://` lands before `hub_path` goes)
- paired_with [ADR-0046 — A branch and a pull request are the only way knowledge lands](0046-derived-hub-git-and-merge-ratification.md)
