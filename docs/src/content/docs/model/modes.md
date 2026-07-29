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
   - If its mode is `external`, mage follows the `hub_path` in the metadata to the hub's `projects/<name>/` — so captures and grooming land in the hub, where the notes actually are, not in the code repo.
2. Otherwise, look upward for a **hub root** (a directory with a `projects/` registry and a top-level `metadata.json`). Inside a `projects/<name>/` directory it resolves to that project's flat docs root; anywhere else under the hub it resolves to the hub root itself.

This is why you can run `mage` commands from anywhere inside a repo or hub and they find the right knowledge base. It is also why an `external`-mode code repo's captures end up in the hub even though you were working in the code repo — the metadata pointer redirects them.

The on-disk schema is stamped as `mage.v2`. Older `mage.v1` metadata is read leniently and upgraded in memory; `mage migrate` rewrites it to the current schema (and, like `init`, never commits).

## Reaching a hub from the code repo

Finding the knowledge base and being *allowed to read it* are two different things. In `external` and `hybrid` modes the docs root sits outside the repo your agent was launched in, and agent harnesses confine file access to the project root. So `mage connect` also grants access to the hub — for Claude Code, by adding it to `permissions.additionalDirectories` in the repo's local settings.

Three consequences worth knowing:

- **`mage connect` is not optional for hub modes.** Without the grant the agent resolves the KB correctly and then cannot open it.
- **`hub_path` is machine-specific.** It is an absolute path in a git-tracked file, so a clone on another machine may point at a hub that isn't there. mage skips the grant in that case rather than recording one for a path that doesn't exist; clone the hub and re-run `mage connect`. `mage doctor` reports the state either way.
- **The grant is bounded by hub *shape*, not by trust.** Because `hub_path` lives in a git-tracked file, it is untrusted input — a bad value could otherwise widen harness access to any directory (`~/.ssh`, `/`). So mage writes the grant only when the target is already **hub-shaped**: a `projects/` directory plus a hub `metadata.json`. Be clear about what that does and does not buy you (ADR-0042 §7). It is a **structural check**, not an identity check: it caps grant-widening at directories that are already mage hubs, and it does **not** verify that the hub is *the* hub you meant, or that its origin is trusted. The residual exposure — a legitimate hub whose contents someone else controls — is the same trust boundary as your notes themselves, not a new one. A path that fails the shape check is treated exactly like a hub that isn't cloned here: warn, grant nothing, record nothing.

:::note[Changing in 0.0.18 — hubs move to derived locations]
ADR-0043 settles the direction: an external hub stops being addressed by a
recorded path and becomes addressed by its **remote** (`hub_repo`), with its
local location *derived* — one deterministic place per remote, at
`~/.mage/hubs/<host>/<owner>/<repo>` — and cloned on demand if it isn't there
yet. `hub_path` is deprecated at that point, and with it the machine-specificity
caveat above: a derived path is the same on every machine, so a clone elsewhere
no longer points at a hub that isn't there.

It also adds the identity check the shape check above deliberately is not:
**verify on arrival** — mage canonicalizes the `origin` of the clone it finds at
the derived path and requires it to match `hub_repo`, erroring loudly on a
mismatch. Derive the address, verify the arrival.
:::

An `in-repo` KB needs none of this — its docs already live under the project root.

## Where to next

- [Set up a hub and external mode](../guides/hub-and-external-mode.md) — the four commands, in order, with the directory each one runs in.
- [Install and Quickstart](../start/quickstart.md) — run `mage init` and capture your first note.
- [Notes](./notes.md) and [The graph: wings and rooms](./graph.md) — what lives inside whichever shape you choose.
- [Reference: commands](../reference/commands.mdx) — every flag on `init`, `link`, `unlink`, and the rest.
