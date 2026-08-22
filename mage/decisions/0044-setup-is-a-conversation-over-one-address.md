---
type: decision
tags:
  - mage/decisions
created: "2026-07-31"
updated: 2026-08-22
last_reviewed: 2026-08-22
status: proposed
provenance:
  repo: mage-memory
  work: adr-c-setup-conversation
sources:
  - decisions/0043-hub-addressed-by-remote-located-by-derivation.md
  - decisions/0042-reach-tier-harness-grants.md
  - decisions/0041-genre-decides-the-recall-rung.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - src/commands/link.ts
  - src/commands/connect.ts
  - src/commands/init.ts
  - work/plan-adr-0041-waves.md
  - https://github.com/Sumit1993/mage-memory/issues/104
keywords:
  - setup-conversation
  - wave-c
  - link-address
  - local-hub
  - local-scheme
  - reserved-segment
  - storage-inference
  - confirmed-not-announced
  - command-chaining
  - idempotent
  - hub-refs
  - hub-path-removal
---

# 0044 — Setup is a conversation over one address (ADR-C, Wave C of ADR-0041)

> **Status: proposed (grilled 2026-07-31).** This is the ADR-C that
> [ADR-0041](0041-genre-decides-the-recall-rung.md)'s wave plan named and never
> drafted, closing [#104](https://github.com/Sumit1993/mage-memory/issues/104).
> It sits **on top of** [ADR-0042](0042-reach-tier-harness-grants.md) (grants) and
> [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) (addressing),
> and amends 0043 in two places (Decision §2–3).

## Context

Wave C was scoped as "connect / external layers" before either adjacent ADR
existed. Both then took a bite out of it: **0042** answered how the harness is
granted read access to an out-of-repo KB, and **0043** answered where a hub lives
and how it is named. What neither touched is the part a human actually meets —
**the conversation the tool has with you while setting this up.** That is what
remains, and it is the taste-critical piece the wave plan deliberately held for a
fresh session.

**The stale artifact that proves it is still live.** `mage link` takes
`<hub-path>` — a filesystem path. ADR-0043 decided a hub is addressed by its
*remote* and located by derivation, precisely because a machine-specific absolute
path in a git-tracked file was the defect. So the primary argument of the main
setup command is now the wrong *type of thing*. ADR-0043 did not fix it because
it is a human-surface question, not a resolution-mechanism one.

**A hole found while grilling, verified empirically 2026-07-31.** `link.ts:171`
reads `const hubRepoUrl = (await getRemoteOriginUrl(hub)) ?? hub;` — so a hub with
**no remote** gets a *filesystem path* written into `hub_repo`. Feeding that to
0043's canonicalizer throws `Invalid git remote URL … missing host:path
separator`, and `deriveHubPathSafe` returns `null`. Today it degrades to
`hub_path` and nothing breaks. But 0043 declares `hub_path` "slated for removal",
and on that day **every local-only hub becomes unaddressable.** A decision that
cannot be completed is not a decision; this ADR completes it.

**Storage mode is inferred and announced, never asked.** `link` auto-detects
`repo-owned` vs `hub-owned` from whether `mage/` has content, prints
`auto-detected: <reason>`, and proceeds — there is no `confirm()` in the file. It
is the single most consequential setup decision, since it determines where every
future note is written, and the user reads the reason line only *after* the
choice is made.

## Decision

**1. ADR-C's subject is the setup conversation.** Addressing and grants are
settled mechanism beneath it. What this ADR governs is what `init`/`link`/
`connect` ask, what they infer, how many steps the operator sees, and what lands
in `metadata.json`.

**2. Local-only hubs get a derived home too — there is exactly ONE resolution
path.** A local hub is not an exception to derivation; it is a hub whose address
happens not to be a network remote. This is what finally lets `hub_path` die
rather than survive indefinitely as the fallback for one unhandled case.

> The rejected alternative was scoping derivation to remote-backed hubs and
> keeping an explicit path for local ones. It is defensible — derivation buys
> *portability*, and a local-only hub has no second machine — but it preserves two
> resolution paths forever to serve the narrowest case, and "temporary fallback"
> fields do not get removed once something depends on them.

**3. A local hub is addressed `local://<name>`, deriving to a reserved
`_local/<name>`.** `local` joins ADR-0043 §2's scheme allowlist
(`ssh`/`https`/`http`/`git`). The derived segment is `_local`, **not** `local`,
and the underscore is load-bearing: `_` is illegal in a hostname, which is the
same property ADR-0043 already relies on for its `host_port` join. That makes
collision with a real remote **structurally impossible** rather than merely
unlikely — a host genuinely named `local` (mDNS `.local` is real) would otherwise
derive to the same directory.

> The bare scp-like form `local:<name>` is **rejected**: that is exactly
> `host:path` syntax and is ambiguous with an SSH remote to a host named `local`.
> The scheme form is unambiguous under the existing parser.

**`<name>` grammar.** `<name>` is **exactly one path segment** and inherits
ADR-0043 §2's segment rules rather than inventing its own: lowercased (so
`local://My-Hub` and `local://my-hub` are one hub, matching the case fold that
keeps a remote from minting two clones); rejected when empty, `.`, or `..`;
rejected when it contains `/`, since a local hub has no owner namespace to nest
under and multi-segment names would collide with the `<host>/<segments…>` shape.
Percent-encoding is **not decoded** — consistent with the remote path, where
`%2e%2e` stays a literal directory name and never becomes traversal. Permitted
characters are those legal in a repository name: alphanumerics, `-`, `_`, `.`.

Consequently `mage init --local` **mints a `local://<name>` address** rather than
leaving `hub_repo` null. Existing local-only hubs carry a filesystem path in
`hub_repo` and need a one-time migration — see Consequences.

**4. `link` takes an ADDRESS. A path is a deprecated shim. `link` never clones.**
The canonical form is `mage link <address>` — a remote URL or `local://<name>` —
and derivation resolves it to the hub's location.

`link` **registers**; it does not obtain. Its writes are confined to the code
repo's own `mage/metadata.json` (mode, project, `hub_repo`, or a `hub_refs[]`
entry). It writes nothing hub-side and performs no network operation. When the
derived path is absent, `link` reports the hub as unobtained and points at the
command that obtains it — `mage connect` for a remote-backed hub,
`mage init --local <name>` for a local one — and exits without registering.
Clone-on-demand stays wired to `connect` alone, which is what keeps
[ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) honest and the capture
path free of network calls.

> An earlier draft of this section said derivation would find "or offer to clone"
> the hub, which contradicted this ADR's own Relations line. Recorded here rather
> than silently corrected: **`connect` obtains, `link` registers, and neither
> borrows the other's job.**
>
> **Amendment (2026-08-22, [ADR-0045](0045-cross-environment-presence.md) / [ADR-0046](0046-derived-hub-git-and-merge-ratification.md)).** `mage hub ensure` is the obtain plumbing; `connect` remains the human surface that gathers consent and drives it; `link` still registers and still never clones. `mage hub use` joins as registration-of-*location* (distinct from `link`'s registration-of-*address*). Clone-on-demand stays wired to `connect` alone — plus, behind an explicit `--clone` flag, to `mage submit` ([ADR-0046](0046-derived-hub-git-and-merge-ratification.md)), where the committed workflow file that invokes it is the standing consent.

A filesystem path still works as a deprecated shim: mage reads its origin,
resolves the address, **prints the canonical command**, warns, and — having
resolved a real hub — proceeds with the registration. This follows the house
posture that mage suggests the command rather than silently doing something
adjacent to what you asked (ADR-0043 §5), and gives existing users a migration
path instead of a broken invocation.

**5. The inferred storage mode is CONFIRMED, not announced.** The heuristic stays
— empty-vs-populated `mage/` is a genuinely strong signal — and the reason string
stays visible. What changes is that it becomes a confirmation step rather than a
notification, because it decides where every future note is written. `--storage`
and `-y` remain the non-interactive path and are unaffected.

> This is the one place the ADR deliberately adds friction. The justification is
> not that the heuristic is weak; it is that the cost of the rare wrong guess is
> silent misfiling of knowledge, and the reason line currently arrives too late to
> act on.

**6. Three commands stay; the chaining becomes explicit and every step
idempotent.** `init` → `link` → `connect` map to three genuinely distinct acts —
create a KB, register it with a hub, wire the harness — and CONVENTIONS.md §10's
command-tier discipline already separates human verbs from plumbing. Today the
chain is half-hidden (`init` connects; `link` auto-invokes `connect` unless
`--no-connect`). The fix is to make the chain **visible in the output** and each
step safe to re-run, not to collapse it. A single wrapper would hide a three-part
model the operator must understand the first time anything breaks.

## Considered options

- **A guided `mage setup` folding all three** — best first-run experience by a
  wide margin, and honest that the chain already exists. **Rejected** for now: it
  adds a fourth entry point and a second surface to keep in sync with the three
  beneath it, and it hides the model rather than teaching it. Revisit if first-run
  friction shows up in real use.
- **Collapsing `link` into `connect`** — smaller surface, one fewer concept.
  **Rejected**: it merges "where do my notes live" with "how does the agent reach
  them", which 0042 and 0043 just spent two decisions separating.
- **`link` takes an address, hard cut, no shim** — cleanest single code path, and
  this is early development with no compatibility promises. **Rejected** narrowly:
  the shim is a handful of lines and converts a broken invocation into a teaching
  moment.
- **A separate `hub_local` field instead of the `local://` scheme** — keeps
  "`hub_repo` means a real git remote" honest. **Rejected**: two address fields
  and a branch in every resolver is materially the `hub_path` situation 0043 just
  removed.
- **`file://` URLs for local hubs** — standard and already parseable, but carries
  an absolute path, reintroducing the exact machine-specific-path-in-a-git-tracked
  -file problem 0043 exists to kill.

## What this amends in ADR-0043

- **§2 (derivation) gains the `local` scheme and the `_local` reserved segment.**
  The canonicalization table is otherwise unchanged.
- **§6 (`hub_path` deprecated, slated for removal) becomes completable.** With
  local hubs addressable, no case requires the fallback, so removal stops being
  blocked on an unhandled scenario.
- **Everything else stands for remote-backed hubs** — no symlinks (§3),
  clone-on-demand (§4), suggest-the-move (§5), and home-relative grants (§8) are
  untouched.
- **The verification pair needs a local reading, because a local hub has no
  origin.** "Derive the address, verify the arrival" is the posture; only the
  arrival half changes shape:
  - **`looksLikeHub` (§7) remains mandatory and unchanged.** It is the check that
    does not care where the address came from — `_local/<name>` is still just a
    directory some other process may have created, so the shape gate is exactly as
    load-bearing here as anywhere.
  - **Origin-match (§2) is replaced, not skipped.** There is no remote to
    canonicalize, so the identity check becomes: the hub's own `metadata.json` at
    the derived path must record the same `local://<name>` address being resolved.
    A mismatch is a hard error naming both, mirroring the remote case. Skipping the
    check outright would make `_local/` the one unguarded rung in the mechanism.
  - **A missing derived path is not a clone opportunity.** There is nothing to
    clone from, so §4's remedy does not apply; the remedy is
    `mage init --local <name>`, and §5's suggest-the-move still applies to a local
    hub found at the wrong path.

## Consequences

- **`hub_refs[]` drops `hub_path`, becoming `{ hub_repo, project }`.** It carries
  the same pair as the top-level fields and inherits the same fix; hybrid mode
  gains the portability property external mode got in 0043. Treated as a
  consequence of §2, not a separate decision.
- **Existing local-only hubs need a one-time migration.** Their `hub_repo` holds a
  filesystem path that now throws on canonicalization. This is a real upgrade step,
  not a no-op, and belongs in the same release as the `local://` scheme. Its
  mechanics are specified in [#123](https://github.com/Sumit1993/mage-memory/issues/123),
  which blocks the removal of `hub_path`.
- **The implementation lands in two passes, deliberately.**
  [#121](https://github.com/Sumit1993/mage-memory/pull/121) (superseding #117)
  implements ADR-0043 as written — allowlist `ssh/https/http/git`, no `local`
  scheme — and lands as-is. The scheme, the `link` argument change, the
  confirmation step, and the `hub_refs` shape follow as this ADR's own
  implementation. Widening #121 would make its body claim an ADR it no longer
  matches, and #113's docs checklist is already scoped to it.
- **Setup gains exactly one keypress** in the interactive path (§5) and loses none
  elsewhere. `-y` behaviour is unchanged.

## Ratification

This ADR stays `proposed` until its implementation ships and one real setup run —
a fresh code repo linked to each of a remote-backed hub and a local-only hub —
completes without consulting the source. **KILL if** the confirmation step in §5
proves to be the enter-key reflex it was meant to avoid (measured by whether any
`--storage` override is ever issued after a confirmation), or if the `local://`
scheme collides with a real-world remote form not anticipated in §3.

## Relations

- Implements Wave C of [ADR-0041](0041-genre-decides-the-recall-rung.md); see
  [plan-adr-0041-waves](../work/plan-adr-0041-waves.md)
- Amends [ADR-0043](0043-hub-addressed-by-remote-located-by-derivation.md) §2 and §6
- Sits on [ADR-0042](0042-reach-tier-harness-grants.md) — grants are unchanged
- Honors [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md): setup asks and
  suggests; it starts no watcher and clones only from `connect`
- amended_by [ADR-0045 — Cross-environment presence](0045-cross-environment-presence.md) (§4 obtain plumbing vs human surface)
- amended_by [ADR-0046 — mage runs git only in derived hub clones](0046-derived-hub-git-and-merge-ratification.md) (§4 clone-on-demand for submit)
