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

The notes travel with the code, in the same history, behind the same branch protection. This is the right default when one repo's knowledge belongs to that one repo.

### A standalone hub

A **hub** is a knowledge base that is its own repo, not nested in any one code repo. It is two things at once:

- a knowledge base in its own right — with its own top-level `notes/`, `decisions/`, `work/`, and `INDEX.md` for **cross-cutting** knowledge that spans the whole system, and
- a registry of *projects* under `projects/<name>/`, each a wing for one code repo.

```
my-hub/
  metadata.json        # the registry of projects
  INDEX.md             # the hub's OWN index
  notes/  decisions/  work/   # the hub's own cross-cutting knowledge
  projects/
    engine/            # one project's flat docs root — its notes live here
    web/               # another
```

Notice the layout is **flat**: a project's notes live at `projects/<name>/notes/`, not `projects/<name>/mage/notes/`. There is no second `mage/` nested inside the hub, because the hub root already *is* a mage knowledge base. A project looks like the hub it lives in, not like a code-repo `mage/` (this was settled in ADR-0011 and ratified in ADR-0023).

The hub having its own `notes/` *and* `projects/<name>/` is intentional scope separation, not duplication: the hub's own notes hold what spans the whole fleet (the shared architecture, the conventions every project obeys); each project's notes hold what is scoped to that one code repo.

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

## Where to next

- [Install and Quickstart](../start/quickstart.md) — run `mage init` and capture your first note.
- [Notes](./notes.md) and [The graph: wings and rooms](./graph.md) — what lives inside whichever shape you choose.
- [Reference: commands](../reference/commands.mdx) — every flag on `init`, `link`, `unlink`, and the rest.
