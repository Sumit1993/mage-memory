---
title: Pause capture, disconnect, or uninstall
description: How to pause mage's capture, remove its hooks, or uninstall it entirely — your notes are plain files in git and stay exactly where they are.
---

mage is three separable things: a **CLI**, a set of **capture hooks** it wires
into your coding host, and your **notes** — plain markdown files in your git
repo. Removing the machinery never touches the knowledge. Whatever you do below,
your `mage/` notes, `INDEX.md`, and decisions are committed files that stay put.

## Pause or stop capture

Capture is just hooks, so turning it off is one command. `mage disconnect`
removes exactly the hooks `mage connect` added from this repo's
`.claude/settings.local.json`, leaving any host hooks of your own intact. In
hub and hybrid modes it also removes only the `permissions.additionalDirectories`
reach-grant entries mage itself added (ADR-0042) — any entry you added yourself
is left in place:

```bash
# Remove mage's capture hooks from this repo
mage disconnect

# ...from your personal settings instead (if you wired them with `mage connect --user`)
mage disconnect --user
```

This is fully reversible — run [`mage connect`](../reference/commands.mdx) again
to resume capture. So "pause" and "disconnect" are the same move; you reconnect
when you want it back.

By default `mage disconnect` also removes the Gate-2 redaction pre-commit hook.
To keep that safety net in place while turning capture off, pass `--no-git-hook`:

```bash
mage disconnect --no-git-hook    # stop capture but keep the redaction pre-commit gate
```

## Uninstall the skills plugin

The `mage:*` skills are a Claude Code plugin. Remove it from inside Claude Code:
open `/plugin` and uninstall **mage**, or run `/plugin uninstall mage@mage`. This
only removes the namespaced skills; it does not touch your notes or the CLI.

### Plugin cache

Claude Code caches an installed plugin under `~/.claude/plugins/cache/`. How it got
there decides how much it costs you.

If you registered the marketplace by a **local directory** (`/plugin marketplace add
./some/path`), Claude Code copies **the entire working tree at that path** — including
everything untracked. On this repo that meant a 556 MB cache: `node_modules/` plus
`docs/node_modules/`, none of which the plugin needs. Worse, that copy is a **snapshot**,
so the installed plugin can quietly sit at an old version while you assume it tracks
your tree.

Register it by its **GitHub source** instead — the form the README and
[Quickstart](../start/quickstart.md) already teach — and clear the stale copy:

```bash
# 1. drop the stale cached snapshot
rm -rf ~/.claude/plugins/cache/mage
```

Then, inside Claude Code, re-add and reinstall:

```text
/plugin marketplace add Sumit1993/mage-memory
/plugin install mage@mage
```

That is also what an actual user installs, so what you run matches what you ship.

## Uninstall the CLI

The `mage` command is a global npm package:

```bash
npm rm -g mage-memory
```

## Upgrading from 0.0.x

A knowledge base connected before 0.0.19 carries state whose writers retired, hook
groups from an older release, and an `AGENTS.md` block from before hash stamps. Run
`mage migrate` once in the code repo (or at the hub root). It is safe to re-run.

Here it is on a 0.0.17 knowledge base, then a second time:

```console
$ mage migrate
✓ Removed promote-tally at /repo/mage (its writer retired in #208)
✓ Removed nudge-throttle at /repo/mage (its writer retired in #208)
  Already current: /repo/mage/metadata.json
staging: 1 draft(s) pending at /repo/mage — run `mage groom`
⚠ work/ is retired (ADR-0050): 1 file(s) left in place at /repo/mage; links in notes and decisions are not rewritten
  hooks: written (/repo/.claude/settings.local.json); observe arm: added
⚠ /repo/AGENTS.md: the mage block between <!-- BEGIN mage --> and <!-- END mage --> predates hash stamps and was left as is. …
    mage migrate never overwrites it. To take the current block, move any text of your own below <!-- END mage -->, delete the block, and run mage migrate again.

Review the diff and commit yourself (mage never commits):
    git add AGENTS.md CLAUDE.md metadata.json mage/metadata.json 2>/dev/null; git commit -m "chore: migrate mage state"
$ mage migrate
✓ Already current (mage.v2, .mage/ layout); nothing to migrate.
staging: 1 draft(s) pending at /repo/mage — run `mage groom`
⚠ work/ is retired (ADR-0050): 1 file(s) left in place at /repo/mage; links in notes and decisions are not rewritten
  hooks: unchanged (/repo/.claude/settings.local.json); observe arm: present
⚠ /repo/AGENTS.md: the mage block between <!-- BEGIN mage --> and <!-- END mage --> predates hash stamps and was left as is. …
    mage migrate never overwrites it. To take the current block, move any text of your own below <!-- END mage -->, delete the block, and run mage migrate again.
```

What each line means:

- **Removed …**: a file under `.mage/metrics/` whose only writer retired. Staged
  drafts are never deleted; `mage groom` is how you clear them.
- **hooks**: the hook groups in this repo's `.claude/settings.local.json` are
  rewritten to the current set, at the tier they already had. The PreToolUse observe
  arm is added, the memory hook now runs the ladder check, and `autoMemoryDirectory`
  is left alone. A repo that was never connected is left unconnected: run
  `mage connect` for that. Your personal `~/.claude/settings.json` is never touched.
- **AGENTS.md**: the block is refreshed only when it is exactly what mage wrote. A
  block with hand edits, or from before hash stamps, is left as is with a warning.
  To take the current block, move your own text below `<!-- END mage -->`, delete
  the block, and run `mage migrate` again.
- At a hub root, each registered project gets a line telling you to run
  `mage migrate` in its code repo, because the hook groups live there.

These strings are the ones `test/integration/migrate.integration.test.ts` asserts.
If you change what `mage migrate` prints, update this transcript with it.

## What stays behind

- **Your notes.** Everything under `mage/` — notes, `INDEX.md`, `decisions/` — is
  committed markdown. Uninstalling removes none of it; it is yours, portable, and
  readable without mage installed at all.
- **The capture scratch is throwaway.** The git-ignored sinks
  (`.mage/learnings/`, `.mage/staging/`, `.mage/metrics/`) are disposable by
  design — delete the `.mage/` directory if you want a clean slate.
- **Hub clones `connect` may have made.** External and hybrid mode derive a
  hub's local clone at `~/.mage/hubs/<host>/<owner>/<repo>`, outside any repo
  (`$MAGE_HOME/hubs` when set, else `~/.mage/hubs`). It's an ordinary git
  clone, not disposable scratch — push or otherwise back up anything
  uncommitted or unpushed in it first. Uninstalling the CLI doesn't touch it;
  once you've done that, `rm -rf ~/.mage/hubs` (or `$MAGE_HOME/hubs`) clears it.

If you only wanted to *quiet* mage rather than remove it, prefer
`mage disconnect` over uninstalling — it stops the capture machinery while
keeping the CLI and your notes ready to pick back up. See
[Commands](../reference/commands.mdx#wiring-up-capture) for the full
connect/disconnect surface.
