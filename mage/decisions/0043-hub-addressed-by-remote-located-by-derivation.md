---
type: decision
tags:
  - mage/decisions
created: "2026-07-29"
updated: 2026-07-31
last_reviewed: 2026-07-31
status: proposed
provenance:
  repo: mage-memory
  work: adr-0043-hub-derivation
sources:
  - decisions/0042-reach-tier-harness-grants.md
  - decisions/0011-recursive-scan-hub-projects.md
  - decisions/0012-wings-optional-convention-standalone-hubs.md
  - decisions/0025-one-transient-state-home.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - src/paths.ts
  - work/future-thoughts.md
  - https://github.com/Sumit1993/mage-memory/issues/103
  - additionalDirectories tilde-expansion probe 2026-07-29 — two headless Claude Code projects on WSL, control vs. project-scope grant (local artifact; the method and both outcomes are inlined under Decision §8)
keywords:
  - hub-repo
  - derived-path
  - canonical-slug
  - clone-on-demand
  - no-symlinks
  - single-root-harness
  - worktree-propagation
  - project-scope-grant
  - hub-path-deprecation
  - portability
  - tilde-expansion
  - workspace-trust
---

# 0043 — A hub is addressed by its remote, located by derivation

> **Status: proposed.** Owner decisions of 2026-07-29, settling the open question the
> 2026-07-27 grill left in [ADR-0042](0042-reach-tier-harness-grants.md)'s **Revisit
> trigger**. This ADR *is* that revisit, and it is the decision
> [#103](https://github.com/Sumit1993/mage-memory/issues/103) asks for.

## Context

**Single-root harnesses break the external-hub model, and multi-root was hiding it.**
ADR-0042 recorded that VS Code multi-root workspaces "had been masking" the missing-grant
bug by keeping code repo and hub in one window. That reading was too mild. Multi-root was
not masking a defect — it was **load-bearing UX for the whole external-hub model**. It is
the only reason opening a hub was ever ergonomic. Claude Desktop and t3code (both
WSL-capable now) operate **one project root at a time**; a two-root workspace does not
translate to them, and there is nothing to translate it into. Every single-root harness
breaks it, so the fix cannot be "open the hub too."

The hub must stop being something you *open*. Under derivation it is **infrastructure at a
known machine-wide location**, reached from whichever project root is active via the
ADR-0042 grant. Opening it — Obsidian, a second window, a browse — becomes optional, never
a requirement for the agent to read its own knowledge base.

**The address already exists and nothing reads it.** Every `metadata.json` in `mode:
external` carries `hub_repo` alongside `hub_path`; `src/paths.ts` resolves everything
through `hub_path` and `hub_repo` is dead weight. `hub_path` is an **absolute,
machine-specific path in a git-tracked file** — which is why ADR-0042 §7 had to treat it as
untrusted input, why a fresh clone routinely has no hub at the recorded path, and why
ADR-0042 had to declare git-tracked project-scope grants *structurally* blocked: a
committed `settings.json` is one file shared by every worktree, and no project-relative
path is correct from all of them.

**Worktrees are where this fails unwatched.** `settings.local.json` is gitignored, so a new
worktree starts with no grant and Claude Code exposes no worktree-creation hook. Worse, the
grill observed a **harness-managed** worktree at `.claude/worktrees/wf_*` inside sreforge's
own `.claude/` — created by neither mage nor the user, carrying settings and no grant. A
remedy that depends on someone remembering to run `mage connect` fails exactly there.

The grill left one question open: **derived-path determinism versus reusing a clone the
user already edits**, with a symlink at the derived path floated as the synthesis. This ADR
settles it in favour of determinism, and rejects the symlink.

## Decision

**1. The local path of an external hub is DERIVED from `hub_repo`, never recorded.** One
deterministic location per remote, rooted at `~/.mage/hubs/` (`$MAGE_HOME/hubs` when set —
an override for tests and non-default homes; the derivation *below* the root is what is
fixed). The same remote yields the same path on every machine, from every worktree, from
every harness. A **real directory** — an ordinary clone — lives there.

**2. Derivation is canonical and injective.** `git@host:owner/repo.git` and
`https://host/owner/repo` are the same hub and must derive the same path. The derived path
is `<root>/<host>/<path segments…>/<repo>` — one directory segment per URL path component:

| step | rule | why |
| --- | --- | --- |
| parse | accept the forms git itself accepts: `scp`-like `git@host:path`, `ssh://`, `https://`, `http://`, `git://` | the remote is whatever the user typed at `git remote add` |
| userinfo | drop everything before `@` in the authority | `git@`, a username, or an embedded PAT is a **credential, not an identity** — and must never appear in a path |
| host | lowercase; drop a default port (22, 443, 80, 9418); a non-default port joins as `host_port` | DNS is case-insensitive; `_` is not legal in a hostname, so the join stays reversible |
| path | strip leading and trailing `/`; strip **one** trailing `.git` | `…/repo` and `…/repo.git` are one repo |
| case | lowercase every segment | GitHub, GitLab and Gitea treat owner/repo case-insensitively, and so do macOS and Windows filesystems — preserving case would mint two clones of one repo |
| segments | each remaining path component becomes one directory segment | GitLab subgroups make the owner multi-segment; `/` cannot occur *inside* a component, so the tuple→path map is injective |
| containment | reject an empty, `.`, or `..` segment; assert the result `isUnder` the hubs root | `hub_repo` is git-tracked and therefore untrusted, exactly as `hub_path` was — `isUnder` already lives once in `paths.ts` (consolidated by ADR-0042) |

**A flat `host-owner-repo` slug is rejected**, not merely disliked: it is not injective.
`acme/web-ui` and `acme-web/ui` both flatten to `github.com-acme-web-ui`, and `-`, `_`, `.`
are all legal inside owner and repo names on every major host, so no separator character is
safe. Nested segments make the collision structurally impossible instead of patching it
with an escape rule, absorb GitLab subgroups for free, and match the deployed precedent
(the Go module cache is `<host>/<owner>/<repo>` for the same reason).

**Residual collisions fail loud, never silently share.** Case-folding is a *deliberate*
collapse, but a genuinely case-sensitive host could in principle put two repos at one
derived path — and on a case-insensitive filesystem no slug function could keep them apart
anyway. So the policy is **verify on arrival, not a cleverer hash**: mage canonicalizes the
`origin` of the clone found at the derived path and compares it to the requested
`hub_repo`. A mismatch is a hard error naming both remotes. Never reuse, never clobber.

**3. No symlinks anywhere in the mechanism.** A machine-wide real path needs no link. This
is early development with no compatibility shims to honour, and a symlink at the derived
path would make link resolution **load-bearing for a permission check** — leaving Claude
Code's realpath behaviour and WSL's link semantics as unverified dependencies of whether
the agent can read the knowledge base at all. Determinism bought with an unverified
indirection is not determinism.

**4. Clone-on-demand.** When the derived path is absent and the hub is needed, mage obtains
it by cloning `hub_repo` there. *Which* command offers this and when is an implementation
question — `mage connect` offering it on a hub-absent machine is the obvious surface — and
this ADR deliberately does not fix the surface. What it fixes is the principle: **a missing
hub is a recoverable state with a defined remedy, not an error the user must diagnose.**
ADR-0042 §7's hub-absent case stops being merely "warn and grant nothing."

**5. An existing clone is MOVED, once — and mage only suggests the move.** A hub already
cloned somewhere else is relocated to its derived path, and **no symlink is left behind**.
mage prints the exact `git`/`mv` command; the human runs it (AGENTS.md: mage never commits
for you). The move preserves uncommitted work, which a delete-and-reclone would destroy —
that is why it is a move and not a fresh clone.

**6. `hub_repo` becomes the authoritative address; `hub_path` is deprecated.** `hub_path`
is read as a **fallback** during a transition window and is slated for removal.

**The fallback may widen a LOCAL-scope grant, never a git-tracked one.** ADR-0042 §7's
absolute-path smell is retired in two steps, not one. A `hub_path` resolution stays
grantable in local scope (`settings.local.json` — gitignored, machine-specific, written
while a human is running `mage connect`), because that is exactly the posture ADR-0042 §7
already accepted, and because withdrawing it would strand every hub linked before this ADR
behind a migration they have not been offered yet. It is **never** written into a
project-scope grant: a committed `settings.json` takes effect in every clone and every
worktree, unattended, which is precisely where "an attacker lands a commit" stops being
theoretical. §8's project-scope grant therefore emits only the derived home-relative form;
a target that resolved via `hub_path` is skipped there and reported as a migration prompt
(`mage link` again, to record `hub_repo`).

So the guarantee — an attacker who lands a commit can name only a remote, and the path
mage derives from it is confined under the hubs root by construction — holds
**unconditionally for project-scope grants from the day they ship, and for every grant
once `hub_path` is removed**. Until then local scope carries the deprecated fallback,
under the unchanged `looksLikeHub` gate of §7.

**7. The `looksLikeHub` gate REMAINS, at the derived path.** Derivation changes *where the
path comes from*, not *whether its contents are trusted*. `~/.mage/hubs/<derived>` is still
a directory on disk that some other process may have created, so ADR-0042 §7's shape check
(a `projects/` dir plus a hub `metadata.json`) still gates the grant — now paired with the
origin-match check of §2. Two checks, one posture: **derive the address, verify the
arrival.**

**8. A git-tracked project-scope grant records the derived path HOME-RELATIVE** —
`~/.mage/hubs/<host>/<owner>/<repo>`, never `/home/<user>/.mage/…`. `$HOME` differs across
machines and users, so the home-relative form is the only one a committed `settings.json`
can carry. **Tilde expansion inside `permissions.additionalDirectories` is verified
empirically** (Claude Code, WSL, 2026-07-29): two headless probe projects with
`permissions.defaultMode: "default"`, so an out-of-workspace read auto-denies
non-interactively. Control, no grant — reading `$HOME/.mage/hubs/expansion-probe/probe.txt`
was **denied**. Probe, with project-scope `.claude/settings.json` carrying
`"additionalDirectories": ["~/.mage/hubs/expansion-probe"]` — the read **succeeded**, exact
contents returned. Claude Code's docs document tilde/`$HOME` expansion for settings paths
generally and `~/` in permission rules, but name neither for this array, so this rests on
**documented general rules plus verification on this platform and version — not a
documented contract**. Treat a future expansion regression as a supported failure mode:
doctor's RECALL check already reads the effective grant, not the literal string.

## Considered options

- **A symlink at the derived path pointing to the clone you already edit** (the grill's
  candidate synthesis) — **rejected**: see §3. It makes the symlink load-bearing for a
  permission check, on two unverified behaviours (Claude Code realpath following, WSL link
  semantics), to buy an ergonomic property (§5's one-time move already delivers) at the
  cost of the mechanism's only real guarantee.
- **Prefer an existing clone wherever it happens to be** — **rejected**: it destroys the
  determinism that makes the whole thing work. The derived path would then be a *hint*, and
  a hint cannot be committed into a project-scope grant.
- **A user-scope grant in `~/.claude/settings.json`** (issue #103, direction 3) —
  **works, and is the wrong shape.** Claude Code concatenates array-valued settings across
  scopes, so one machine-wide entry genuinely covers the hub from every worktree. But it
  buys a per-project need with a **machine-wide trust posture**, it grows monotonically as
  hubs accumulate, and it leaves `hub_path` absolute and untrusted — none of the other
  problems move. Still available as a stopgap; not the decision.
- **Status quo — doctor detects, the human runs `mage connect` per worktree** (issue #103,
  direction 1) — **rejected**: it fails precisely when nobody is watching. The observed
  harness-managed `.claude/worktrees/wf_*` worktree had settings and no grant, and no human
  was ever going to be prompted about it.

## What this changes in ADR-0042

- **Fulfils the Revisit trigger** verbatim, and settles its stated open question in favour
  of determinism (the symlink synthesis is rejected, not adopted).
- **§7 stands, retargeted.** `looksLikeHub` is unchanged and still required; what changes is
  that the path it guards is derived rather than read from a git-tracked field. The
  hub-absent branch gains §4's remedy.
- **§2's grant table changes its source, not its shape.** `outOfRepoKbRoots` still returns
  the hub repo root; it computes it from `hub_repo` (falling back to `hub_path` during the
  transition) instead of reading it.
- **"Project-scope grants are structurally blocked" is retired, and delivery is unblocked.**
  The structural blocker was that no single path is correct from every worktree; a derived
  path is. The one fact that stood between the principle and a shippable grant — whether the
  harness expands `~` inside `additionalDirectories` — is now **verified working** (§8). A
  git-tracked `settings.json` carrying `~/.mage/hubs/<host>/<owner>/<repo>` is effective from
  every worktree of the repo, including worktrees mage never created. What remains is a
  precondition, not a blocker: the workspace must be trusted once (see Consequences).
- **"Worktree propagation needs its own research"** is answered: the research is
  [#103](https://github.com/Sumit1993/mage-memory/issues/103) and this is its decision.

## Explicitly out of scope

- **The command surface.** Which command clones, whether it prompts, the flag that makes it
  non-interactive — implementation, deliberately unfixed here (§4).
- **The edges of §8's expansion result.** `~/` as the leading segment is verified; the
  `$HOME` and `${HOME}` forms are **untested** (so mage writes `~/`, the tested one).
  Behaviour in scopes other than project `settings.json` is **untested** — the ADR-0042
  local-scope grant keeps writing absolute paths, where the question does not arise. And
  because the docs do not name this array, the behaviour is **not contract-protected across
  versions**; a regression would surface as doctor's RECALL check failing, which is the
  correct place for it to surface.
- **Hubs with no remote.** See the ADR-0012 note below.
- **[FT-20](../work/future-thoughts.md)'s global user-level hub.** That proposes a *new*
  hub as a personal memory tier. This decides **where all hubs live**. Independent.

## Relation to ADR-0011 and ADR-0012

- **[ADR-0011](0011-recursive-scan-hub-projects.md) — no contradiction.** A hub is still one
  vault, the scanner still recurses, generated indexes still live at the vault root.
  Derivation moves the vault's *mount point*, never its interior. `~/.mage/hubs/` is a
  directory of hub clones, not itself a vault, and nothing scans it as one.
- **[ADR-0012](0012-wings-optional-convention-standalone-hubs.md) §3 — a real tension,
  resolved by a line, not by an exception.** ADR-0012 states `init` "never runs git", so
  §4's clone-on-demand needs an answer. The invariant that matters, as written in
  `AGENTS.md`, is that **mage never lands a commit and never mutates a repo you own** — an
  agent must not surprise you with git history. A clone into a mage-derived, mage-owned,
  previously-absent directory *creates new state*; it mutates nothing of yours and is undone
  by `rm -rf`. That is why §4 may clone and §5 may only suggest: **§5 touches a directory
  the human owns.** The clone is offered and consented to, never silent.
- **[ADR-0012](0012-wings-optional-convention-standalone-hubs.md) §3 — the remote-less
  standalone hub.** `mage init <name>` can create a hub that is never pushed anywhere. It
  has no address, so it cannot be derived. Such a hub keeps `hub_path` and keeps the
  ADR-0042 local-scope grant; it gains nothing here and loses nothing. **This bounds §6:**
  `hub_path`'s removal is gated on that case having an answer, not merely on the transition
  window elapsing. A hub without a remote is also not shareable, so it has no cross-machine
  problem to solve — only the per-machine one it already has.
- **[ADR-0025](0025-one-transient-state-home.md) — a namespace worth naming.** `.mage/` at a
  docs root means "git-ignored machine-written state." `~/.mage/` is the machine-level
  equivalent and hub clones are its first tenant. They fit its stated test — *regenerable or
  rebuildable working state* — because **the remote is the durable copy and the clone is
  not**. The one thing that is not regenerable is uncommitted work in an existing clone,
  which is exactly why §5 moves rather than re-clones.

## Consequences

- **The hub stops being a window.** Single-root harnesses (Claude Desktop, t3code) become
  first-class for external mode without a multi-root workspace. Opening the hub in Obsidian
  is browsing, not setup.
- **`hub_repo` gains its first reader** after being written and ignored since external mode
  shipped. `src/paths.ts` grows the canonicalizer; every `hub_path` read site becomes
  derive-then-fall-back.
- **Every hub gets one conventional home** instead of scattering wherever it was first
  cloned. `ls ~/.mage/hubs/*/*` is the machine's hub inventory.
- **Portable clones.** A fresh machine reproduces the whole layout from the code repos
  alone; a hub-absent machine has a defined remedy rather than a warning.
- **A one-time migration per existing hub**, human-run, that mage detects and suggests.
  `doctor` is the natural detector — read-only, consistent with
  [ADR-0037](0037-readiness-doctor-remit-and-autofix-line.md) §2.
- **A project-scope grant is inert until the workspace is trusted once.** Found while
  probing §8. Claude Code's exact warning: *"Ignoring 1
  permissions.additionalDirectories entry from .claude/settings.json: this workspace has not
  been trusted. Run Claude Code interactively here once and accept the trust dialog…"* So a
  git-tracked grant does **not** make a fresh clone work unattended — it makes it work after
  the one interactive acceptance that clone needed anyway. That is a reasonable precondition,
  not a defect: trust is per-project and one-time, and doctor's RECALL check still reports a
  grant that is present but not in force. **Residual unknown: the trust status of
  harness-managed worktrees** (`.claude/worktrees/wf_*`, the case that motivated this ADR)
  was **not tested** — if such a worktree counts as an untrusted workspace, the very scenario
  §8 was meant to cover still needs one interactive visit. Worth settling before the
  project-scope grant ships.
- **A new failure mode: two remotes, one derived path.** Made loud by §2's origin check.
  Preferable to the silent alternative, and the check is cheap.
- **A path under `$HOME` is now load-bearing for a permission grant.** Anything that wipes
  `~/.mage/` costs a re-clone, not knowledge — the remote holds it.

## Relations

- fulfils [ADR-0042 — the reach tier: harness grants](0042-reach-tier-harness-grants.md) (this ADR is its Revisit trigger, resolved)
- extends [ADR-0042 — the reach tier: harness grants](0042-reach-tier-harness-grants.md) (§7's `looksLikeHub` gate is kept and retargeted at the derived path)
- constrained_by [ADR-0011 — recursive scan; hub projects are wings](0011-recursive-scan-hub-projects.md) (the hub interior is untouched)
- constrained_by [ADR-0012 — a wing is an optional convention; hubs are standalone-first](0012-wings-optional-convention-standalone-hubs.md) (the "mage never runs git" line, and the remote-less hub)
- constrained_by [ADR-0025 — one transient-state home](0025-one-transient-state-home.md) (`~/.mage/` as the machine-level equivalent)
- see_also [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- decides [FT-26 — house every external hub centrally](../work/future-thoughts.md)
