---
title: Modes and storage
description: In-repo knowledge bases, standalone hubs, and how a code repo links to one — plus where the notes physically live.
sidebar:
  order: 3
---

A mage knowledge base is just files in a git repo. The question this page answers is *which* git repo those files live in — and how mage finds them. There are two basic shapes, and one way to connect them.

## The two shapes

### An in-repo knowledge base

The simplest setup: the knowledge base lives **inside the code repo it describes**, in a `mage/` directory at the repo root.

```
my-service/
  src/
  mage/
    metadata.json      # mode: in-repo
    INDEX.md
    notes/  decisions/  work/
```

You create it with:

```bash
mage init --in-repo
```

```mermaid In-repo mode: mage init --in-repo scaffolds mage/ inside the code repo, mage connect wires capture and recall, and the loop produces notes you commit alongside the code.
flowchart TD
  i["mage init --in-repo"] --> s["creates the repo's mage/<br/>notes · decisions · work · metadata.json · INDEX.md"]
  s --> c["mage connect — wires capture + recall"]
  c --> w["work → the loop → groom → notes/ → you commit"]
```

The notes travel with the code, in the same history, behind the same branch protection. This is the right default when one repo's knowledge belongs to that one repo.

### A standalone hub

A **hub** is a knowledge base that is its own repo, not nested in any one code repo. It is two things at once:

- a knowledge base in its own right — with its own top-level `notes/`, `decisions/`, `work/`, and `INDEX.md` for **cross-cutting** knowledge that spans the whole system, and
- a registry of *projects* under `projects/<name>/`, each a wing for one code repo.

```
my-hub/
  metadata.json        # the registry of projects
  INDEX.md             # the hub's OWN index
  MEMORY.md            # the hub's OWN pushed roster
  notes/  decisions/  work/   # the hub's own cross-cutting knowledge
  projects/
    engine/            # one project's flat docs root — its notes live here
      INDEX.md         # the project's OWN index, scoped to its notes
      MEMORY.md        # the project's OWN roster — what an external repo loads
    web/               # another
```

Notice the layout is **flat**: a project's notes live at `projects/<name>/notes/`, not `projects/<name>/mage/notes/`. There is no second `mage/` nested inside the hub, because the hub root already *is* a mage knowledge base. A project looks like the hub it lives in, not like a code-repo `mage/` (this was settled in ADR-0011 and ratified in ADR-0023).

The hub having its own `notes/` *and* `projects/<name>/` is intentional scope separation, not duplication: the hub's own notes hold what spans the whole fleet (the shared architecture, the conventions every project obeys); each project's notes hold what is scoped to that one code repo. That separation runs all the way through recall: `mage index` at the hub root regenerates the hub's own `INDEX.md` + `MEMORY.md` and fans out to give **each project its own pair**, scoped to that project's notes — which is what an `external`-mode code repo actually loads. See [Set up a hub and external mode](../guides/hub-and-external-mode.md).

You create a hub with:

```bash
mage init --hub <your-hub>
```

`mage init` is **detection-first**: run it bare inside a git repo and it scaffolds an in-repo knowledge base; run it bare somewhere that is not a git repo and it creates a standalone hub. The `--in-repo` and `--hub` flags make the choice explicit (useful for agents and CI). A bare hub name becomes `./<name>`; a path is used as-is, like `git init`.

> mage never runs git for you. `mage init` prints the exact commit command and stops — an agent will never land a surprise commit.

## Linking a code repo to a hub

Once a hub exists, you connect a code repo to it with `mage link`. This is where **storage kind** comes in — it decides who owns the project's notes.

```bash
mage link
```

Run from inside the code repo, `mage link` registers it with a hub and **auto-detects** the storage kind from whether the repo already has `mage/` content. There are two kinds:

- **repo-owned** — the notes stay in the code repo's own `mage/` directory; the hub just *registers awareness* of the project and links to it. The code repo is the source of truth. In mage's metadata this code repo's mode is **`hybrid`**: an in-repo knowledge base that is *also* known to a hub.
- **hub-owned** — the notes live in the hub at `projects/<name>/`; the code repo carries no notes of its own, only a pointer to the hub. The code repo's mode here is **`external`**.

You can override the auto-detection:

```bash
mage link --storage repo-owned   # hybrid: the repo keeps its docs
mage link --storage hub-owned    # external: the hub owns the docs
```

To undo a link, `mage unlink` removes the linkage from both sides' metadata.

```mermaid Hub mode: mage init --hub creates a standalone knowledge base, mage link registers a code repo, and ownership decides whether that repo's notes live in the hub (external mode) or in the repo (hybrid mode).
flowchart TD
  h["mage init --hub"] --> hs["the hub<br/>notes · decisions · projects/ · metadata.json"]
  hs --> l["in a code repo: mage link"]
  l --> q{"who owns this repo's notes?"}
  q -->|hub-owned| e["live in the hub · projects/name/<br/>repo mode = external"]
  q -->|repo-owned| r["live in the repo · mage/<br/>repo mode = hybrid"]
```

### The shapes, side by side

| Shape | Where notes live | metadata `mode` | Storage kind |
| --- | --- | --- | --- |
| In-repo | `<code-repo>/mage/` | `in-repo` | (none — no hub) |
| Hybrid | `<code-repo>/mage/` | `hybrid` | `repo-owned` |
| External | `<hub>/projects/<name>/` | `external` | `hub-owned` |
| Hub (itself) | `<hub>/notes/` etc. | (the hub's own registry) | (it owns its own notes) |

All four are knowledge bases. The distinction is purely about which repo holds the files.

## How mage finds the knowledge base

Most mage commands need to locate the docs root to operate on. They do this by walking up the directory tree from where you run them (this is `resolveDocsRoot` in `src/paths.ts`):

1. Look upward for a code repo with `mage/metadata.json`.
   - If its mode is `in-repo` or `hybrid`, the docs root is that repo's `mage/`.
   - If its mode is `external`, mage resolves the hub's location (see below) and
     follows it to the hub's `projects/<name>/` — so captures and grooming land
     in the hub, where the notes actually are, not in the code repo. If the hub
     cannot be reached, mage resolves **nothing** rather than falling back to the
     code repo's own `mage/` — see [When the hub is
     unreachable](#when-the-hub-is-unreachable--the-five-reasons-and-what-you-see).
2. Otherwise, look upward for a **hub root** (a directory with a `projects/` registry and a top-level `metadata.json`). Inside a `projects/<name>/` directory it resolves to that project's flat docs root; anywhere else under the hub it resolves to the hub root itself.

This is why you can run `mage` commands from anywhere inside a repo or hub and they find the right knowledge base. It is also why an `external`-mode code repo's captures end up in the hub even though you were working in the code repo — the metadata pointer redirects them.

The on-disk schema is stamped as `mage.v2`. Older `mage.v1` metadata is read leniently and upgraded in memory; `mage migrate` rewrites it to the current schema (and, like `init`, never commits).

## Where a hub actually lives — derived, not recorded

An external hub is addressed by its **remote** (`hub_repo`), never by a recorded
path (ADR-0043). Its local location is **derived**: one deterministic place per
remote, at `~/.mage/hubs/<host>/<owner>/<repo>` (`$MAGE_HOME/hubs` when set) —
the same path on every machine, from every worktree, from every harness. `mage`
canonicalizes whatever form the remote was written in (`git@host:owner/repo.git`,
`https://host/owner/repo`, `ssh://git@host/owner/repo.git`, …) to that one
location; see `src/hub-url.ts`
for the exact rules (they follow `git help clone`'s GIT URLS grammar, not an
inferred pattern).

`hub_path` — an absolute, machine-specific path that used to be the only address
— is now a **deprecated fallback**, read only when `hub_repo` is absent or
doesn't resolve. `mage link` still writes both fields during the transition
window; new code should never need to read `hub_path` directly.

**Verify on arrival, not a cleverer hash.** A derived path is deterministic, but
a genuinely case-sensitive host (or a rename) could in principle put two
different repos at one derived path. So mage never trusts the clone it finds
there on sight: it canonicalizes that clone's `origin` and requires it to match
`hub_repo`. A mismatch is a **hard, named error** — both remotes named,
credentials redacted — and mage never reuses or clobbers what it finds. A
clone already sitting somewhere ELSE with a matching origin is detected (a
scan under the hubs root, sorted and deterministic) and mage prints the exact
`mv` to relocate it — it never performs the move itself. When nothing is found
at all, `mage connect` offers to clone `hub_repo` there on the spot.

## When the hub is unreachable — reasons and what you see

An `external`-mode repo's knowledge base is somewhere else. When mage cannot get
to it, it **stops** — it never quietly writes into the code repo's own `mage/`,
because that would mint a second, divergent knowledge base and silently misfile
everything you learned into it.

Every interactive command reports the reason and **the command that obtains the hub** (ADR-0044
§4) — never `mage init`, which is the one command that would make it worse. Run
`mage doctor` and read the `external hub` line:

| Reason | What happened | The fix |
| --- | --- | --- |
| `hub-absent` | The address resolves, but nothing is cloned at the derived path yet — the normal state on a fresh clone of the code repo. | `mage connect` (it offers to clone it) |
| `hub-corrupted` | Something *is* at that path, but it is not a mage hub (no `projects/` + `metadata.json`). | Move or remove it, then `mage connect` |
| `hub-mismatch` | A mage hub exists at that path, but its origin remote does not match `hub_repo`. | Fix the clone's remote, or re-run `mage link <address>` |
| `hub-origin-unreadable` | A mage hub exists at that path, but its origin remote could not be read from `.git/config`. | Check `.git` permissions and configuration |
| `no-hub-target` | `mage/metadata.json` is `mode: external` but records no usable `hub_repo`/`hub_path`. | `mage link <address>`, then `mage connect` |
| `malformed-config` | `mode: external` with no `project` name, so there is no `projects/<name>/` to resolve to. | `mage link <address>` |
| `unknown-failure` | An unexpected failure occurred while resolving the external hub. | Check permissions, or re-register with `mage link <address>` |

Worked transcript, one repo per reason (paths shortened):

```console
$ cd ~/code/my-service   # hub_repo = https://github.com/acme/my-hub.git, nothing cloned yet
$ mage doctor
✗ external hub        : unreachable (hub-absent) — This repo is in external mode, so its knowledge base lives in a hub — but the hub is unreachable: no hub at ~/.mage/hubs/github.com/acme/my-hub (address https://github.com/acme/my-hub.git). Run `mage connect` to clone it there (or `mage init --local <name>` for a local-only hub). Do NOT run `mage init` here: it would mint a SECOND knowledge base.
✓ KB access grant     : no mage hub at ~/.mage/hubs/github.com/acme/my-hub on this machine yet — nothing to grant yet

$ cd ~/code/svc-corrupt   # hub_path points at a directory that is not a hub
$ mage doctor
✗ external hub        : unreachable (hub-corrupted) — … something exists at ~/hubs/decoy but is not a mage hub (no projects/ + metadata.json). Move or remove it, then run `mage connect`. Do NOT run `mage init` here: it would mint a SECOND knowledge base.

$ cd ~/code/svc-mismatch  # hub exists at derived path but origin remote points to a different repo
$ mage doctor
✗ external hub        : unreachable (hub-mismatch) — This repo is in external mode, so its knowledge base lives in a hub — but the hub is unreachable: hub_repo https://github.com/acme/expected.git does not match the clone's origin https://github.com/acme/other.git found at ~/.mage/hubs/github.com/acme/expected — never reused, never clobbered. Do NOT run `mage init` here: it would mint a SECOND knowledge base.

$ cd ~/code/svc-notarget   # mode: external, but hub_repo and hub_path are both null
$ mage doctor
✗ external hub        : unreachable (no-hub-target) — … mage/metadata.json records no usable hub address. Run `mage link <address>` to record one, then `mage connect`. Do NOT run `mage init` here: it would mint a SECOND knowledge base.

$ cd ~/code/svc-malformed   # mode: external, but no project name
$ mage doctor
✗ external hub        : unreachable (malformed-config) — … mage/metadata.json is mode=external but names no project. Run `mage link <address>` to re-register this repo. Do NOT run `mage init` here: it would mint a SECOND knowledge base.
```

Once the hub is reachable, the same check passes and names where the notes
actually live:

```console
$ mage connect          # clones the hub to its derived path, then grants access
$ mage doctor
✓ external hub        : hub reachable — this repo's notes live at ~/.mage/hubs/github.com/acme/my-hub/projects/my-service
✓ KB access grant     : granted: ~/.mage/hubs/github.com/acme/my-hub
```

The other interactive commands say the same thing in their own voice — `mage
skills` and `mage dashboard` refuse with that message rather than the generic
"no knowledge base found", `mage connect` says why it skipped the commandeer
tier, and `mage adopt` reports such an origin as `origin-hub-unreachable`
rather than `origin-has-no-kb`.

**The capture path stays silent on purpose.** The session-start nudge, the
PostToolUse observer, the memory hook, and the Gate-2 staged-secret scan all
**fail open** on an unreachable hub: they capture nothing and return normally, so
a machine without the hub still starts sessions, runs tools, and commits. Silence
there is the mechanism; the message belongs on the commands you actually invoke.

## Reaching a hub from the code repo

Finding the knowledge base and being *allowed to read it* are two different things. In `external` and `hybrid` modes the docs root sits outside the repo your agent was launched in, and agent harnesses confine file access to the project root. So `mage connect` also grants access to the hub — for Claude Code, by adding it to `permissions.additionalDirectories` in the repo's local settings.

Three consequences worth knowing:

- **`mage connect` is not optional for hub modes.** Without the grant the agent resolves the KB correctly and then cannot open it.
- **A hub absent on this machine is a recoverable state, not an error.** A fresh clone of the code repo has no hub cloned yet; mage skips the grant rather than recording one for a path that doesn't exist, and `mage connect` offers to clone it (or move a displaced clone) on the spot. `mage doctor` reports the state either way.
- **The grant is bounded by hub *shape and origin*, not by trust.** `hub_repo`/`hub_path` are git-tracked, so they're untrusted input — a bad value could otherwise widen harness access to any directory (`~/.ssh`, `/`). mage writes the grant only when the target is already **hub-shaped** (a `projects/` directory plus a hub `metadata.json`) AND — for a derived target — its origin matches `hub_repo`. That second check is what a `hub_path`-only grant deliberately lacked (ADR-0042 §7); it caps grant-widening at directories that are already mage hubs *and confirmed to be the right one*, closing the gap ADR-0042 left open. A target that fails either check is treated exactly like a hub that isn't cloned here: warn, grant nothing, record nothing.

An `in-repo` KB needs none of this — its docs already live under the project root.

## Where to next

- [Set up a hub and external mode](../guides/hub-and-external-mode.md) — the four commands, in order, with the directory each one runs in.
- [Install and Quickstart](../start/quickstart.md) — run `mage init` and capture your first note.
- [Notes](./notes.md) and [The graph: wings and rooms](./graph.md) — what lives inside whichever shape you choose.
- [Reference: commands](../reference/commands.mdx) — every flag on `init`, `link`, `unlink`, and the rest.
