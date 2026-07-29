---
type: gotcha
tags:
  - mage/build
created: "2026-07-29"
updated: 2026-07-29
last_reviewed: 2026-07-29
status: active
provenance:
  repo: mage-memory
  work: issue-96-plugin-cache
sources:
  - notes/bare-mage-runs-the-working-tree.md
  - notes/npx-mage-runs-the-published-release.md
  - https://github.com/Sumit1993/mage-memory/issues/96
  - docs/src/content/docs/guides/uninstall-and-pause.md
keywords:
  - plugin-cache
  - marketplace
  - directory-source
  - github-source
  - untracked
  - node-modules
  - snapshot
  - stale-plugin
  - dogfood
  - disk-bloat
---

# Gotcha — a directory-source plugin marketplace copies your UNTRACKED tree, then serves it stale

Registering the marketplace from a local path (`/plugin marketplace add ./mage-memory`)
does not install "the repo." Claude Code copies the **whole working tree at that path**
into `~/.claude/plugins/cache/` — untracked files included — and then keeps serving that
copy.

Both halves hurt, and they are independent:

- **Size.** The observed cache was **556 MB**, almost all of it `node_modules/` plus
  `docs/node_modules/`. Tracked content is 3.4 MB; the plugin itself needs ~52 KB. Nothing
  in the copy step consults `.gitignore` or the npm `files` list.
- **Freshness.** It is a **snapshot**, not a link. The cached plugin sat at **v0.0.11 for
  27 days** while the operator believed it was dogfooding the working tree — a plugin
  version and a tree version that had nothing to do with each other.

The tempting reading is "directory source = local and current, GitHub source = remote and
lagging." It is the reverse on both counts: the directory source gives you neither slimness
nor freshness.

Note this is a *different* trap from the binary pair in
[bare `mage` runs the working tree](bare-mage-runs-the-working-tree.md) — that one is about
which `dist/cli.js` a command resolves to. This one is about the **skills plugin**, cached
separately. A session can run tree-fresh CLI code and 27-day-old skills at the same time,
which is exactly what happened.

## How to apply

Register the marketplace by its **GitHub source** — the form the README already teaches,
and the one a real user installs, so what you run matches what you ship:

```bash
rm -rf ~/.claude/plugins/cache/mage      # drop the stale snapshot first
```

```text
/plugin marketplace add Sumit1993/mage-memory
/plugin install mage@mage
```

Before crediting any skill behaviour to your current work, check what is actually cached.
The cache is laid out `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, so the
directory name *is* the served version:

```bash
du -sh ~/.claude/plugins/cache/*     # hundreds of MB means a directory source copied node_modules
ls ~/.claude/plugins/cache/mage/mage # the version directory — compare it to your tree
```

Observed 2026-07-29: `556M` and a single `0.0.11/` directory containing `node_modules/`,
`docs/node_modules/`, `coverage/`, and `.obsidian/` — none of them tracked, none needed.

**Considered and rejected:** restructuring the repo so the plugin could be a git subdirectory
source (3.4 MB tracked → 52 KB served). It buys a smaller cache for a layout change across the
whole repo, and the GitHub source already fixes both the size and the staleness. Not worth it.

## Relations

- sibling of [bare `mage` runs the working tree](bare-mage-runs-the-working-tree.md) — the CLI half of "what am I actually running?"
- refines [`npx mage` runs the published release](npx-mage-runs-the-published-release.md)
- realizes [dogfood before release](dogfood-before-release.md)
