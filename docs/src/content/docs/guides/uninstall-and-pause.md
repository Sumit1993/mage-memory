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
`.claude/settings.local.json`, leaving any host hooks of your own intact:

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

## Uninstall the CLI

The `mage` command is a global npm package:

```bash
npm rm -g mage-memory
```

## What stays behind

- **Your notes.** Everything under `mage/` — notes, `INDEX.md`, `decisions/` — is
  committed markdown. Uninstalling removes none of it; it is yours, portable, and
  readable without mage installed at all.
- **The capture scratch is throwaway.** The git-ignored sinks
  (`.mage/learnings/`, `.mage/staging/`, `.mage/metrics/`) are disposable by
  design — delete the `.mage/` directory if you want a clean slate.

If you only wanted to *quiet* mage rather than remove it, prefer
`mage disconnect` over uninstalling — it stops the capture machinery while
keeping the CLI and your notes ready to pick back up. See
[Commands](../reference/commands.mdx#wiring-up-capture) for the full
connect/disconnect surface.
