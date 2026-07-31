---
title: Set up a hub and put a repo in external mode
description: End-to-end walkthrough — create a hub, link a code repo as hub-owned, run mage connect in the code repo, and verify recall with mage doctor.
---

**External mode** is the shape where a code repo's notes do not live in the code
repo at all. They live in a shared **hub**, at `projects/<name>/`, and the repo
carries only a pointer. It is the right shape when one hub should hold the
knowledge of several repos — see [Modes and storage](../model/modes.md) for how
it compares to in-repo and hybrid.

This page is the whole setup, in order. Four commands, two of which run in
different directories — which is the part that trips people up.

## 1. Create the hub

A hub is its own git repo, not nested inside any code repo. Run this **outside**
your code repos, wherever you keep the hub:

```bash
mage init my-hub
```

A bare name creates `./my-hub`, like `git init`. `mage init` is detection-first,
so a bare `mage init` inside a git repo would scaffold an in-repo KB instead —
pass a name (or `--hub`) when you mean a hub. If you want mage to create the
GitHub repo too, add `--private` or `--public` (both need `gh`); `--local`
skips GitHub entirely.

You get a knowledge base with its own `notes/`, `decisions/`, `work/`, and its
own `INDEX.md` — plus an empty `projects/` registry waiting for repos.

> mage never runs git for you. `init` prints the exact commit command and stops.

## 2. Link the code repo, hub-owned

Now switch to **the code repo**. `mage link` registers it with the hub and takes
the hub path as its argument:

```bash
cd ~/code/my-service
mage link ../my-hub --storage hub-owned
```

`--storage hub-owned` is what makes this external mode: the notes live in the
hub at `projects/my-service/`, and the code repo's metadata mode becomes
`external`. Without the flag, `mage link` auto-detects from whether the repo
already has `mage/` content — pass it explicitly when you want the hub to own
the docs regardless. The project name defaults to the repo's directory name;
`--project <name>` overrides it.

Under the hood, `link` reads the hub's git `origin` remote and records it as
`hub_repo` — that remote, not the path you passed on the command line, becomes
the authoritative address for the hub. Every later lookup derives the hub's
local home from that address: `~/.mage/hubs/<host>/<owner>/<repo>`
(`$MAGE_HOME/hubs` when set), never a recorded path.

`mage unlink` undoes the link, from both sides' metadata.

## 3. Run `mage connect` — in the code repo

```bash
# still in ~/code/my-service
mage connect
```

**This runs in the code repo, not in the hub**, and that is not a detail. What
`connect` wires is *that repo's agent harness*, and all three things it wires are
per-repo:

- **Capture hooks** — the hooks that redirect your agent's memory writes onto
  mage's lesson path fire in the repo you actually work in. See
  [Capture](../loop/capture.md).
- **`autoMemoryDirectory`** — Claude Code's auto-load is pointed at the resolved
  docs root, which in external mode is `<hub>/projects/my-service/`. That is the
  directory whose `MEMORY.md` gets pushed into every session.
- **The reach grant (ADR-0042)** — agent harnesses confine file access to the
  project root, and in external mode the KB is *outside* it. `connect` adds the
  hub to `permissions.additionalDirectories` in the repo's local settings.
  Without it the agent resolves the knowledge base correctly and then cannot
  open it. On a hub-absent machine, that same `connect` run offers to clone the
  hub to its derived location first, rather than merely skipping the grant.

Because those settings are local and gitignored, a fresh clone or a new worktree
of the same repo starts without them — run `mage connect` again there.

If you already have several repos registered, `mage connect --all-projects` run
from the hub wires each registered project's code repo in turn (still repo-local
each).

## 4. Verify with `mage doctor`

```bash
mage doctor
```

The check to look for is **KB access grant**, in the readiness group. It has
four outcomes:

- **granted** — the hub is present and reachable. This is what you want.
- **failing (ungranted)** — the hub is on this machine but ungranted: "the agent
  cannot read it; run `mage connect`". Re-run `connect` in the code repo.
- **skipped** — no hub on this machine at all, so there is nothing to grant yet.
  Re-run `mage connect` in the code repo — it offers to clone the hub to its
  derived location on the spot (or clones it non-interactively with `--yes`),
  or prints the exact command to do it yourself.
- **failing (mismatch)** — a clone exists at the derived location, but its
  `origin` doesn't match `hub_repo`. A hard error naming both remotes — never
  reused, never clobbered.

`doctor` also reports index freshness against the right root for external mode,
so a stale index shows up here rather than as mysteriously missing recall.

## What lands where

After the four steps, the split is:

```text
my-hub/
  metadata.json           the registry — now lists my-service
  INDEX.md  MEMORY.md     the hub's OWN recall surfaces (cross-cutting notes)
  notes/  decisions/  work/
  projects/
    my-service/
      notes/  decisions/  work/    my-service's notes — the hub owns them
      INDEX.md  MEMORY.md          my-service's OWN recall surfaces

my-service/
  src/
  mage/metadata.json      only a pointer to the hub (mode: external)
```

The code repo holds no notes — just `mage/metadata.json` naming the hub and the
project. Every capture you make while working in `my-service` is redirected into
`my-hub/projects/my-service/`.

Since **0.0.17**, a project directory gets its own generated `INDEX.md` and
`MEMORY.md`, not only the hub root. This exists precisely because of step 3:
`autoMemoryDirectory` points at `projects/my-service/`, so that is where the
session-launch recall has to be. Running `mage index` at the hub root
regenerates the hub's own pair **and** fans out over every registered project,
regenerating each one's pair in place (a project whose directory is not on disk
— a repo-owned one, say — is simply skipped):

```bash
cd ~/code/my-hub
mage index
```

Each project's surfaces are scoped to that project's notes — `my-service`'s
`MEMORY.md` does not carry another project's entries, while the hub's own
`MEMORY.md` spans the fleet. For what those two files are and why there are two,
see [The two recall surfaces](../model/graph.md#the-two-recall-surfaces).

## Where to next

- [Modes and storage](../model/modes.md) — the four shapes side by side, and how
  mage resolves the docs root.
- [The graph: wings and rooms](../model/graph.md) — the recall surfaces in
  detail.
- [Commands](../reference/commands.mdx) — every flag on `init`, `link`,
  `connect`, and `doctor`.
- [Pause, disconnect, or uninstall](./uninstall-and-pause.md) — undoing any of
  the above.
