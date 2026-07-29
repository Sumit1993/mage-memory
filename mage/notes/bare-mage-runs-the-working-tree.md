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
  work: adr-0041-wave-b-soak-measurement
sources:
  - notes/npx-mage-runs-the-published-release.md
  - notes/soak-targets.md
  - decisions/0041-genre-decides-the-recall-rung.md
  - work/plan-adr-0041-waves.md
  - cc-session:cc52271f-c247-4662-ac8c-94699ee8bb4d
keywords:
  - npm-link
  - global-install
  - working-tree
  - soak
  - release-gating
  - dogfood
  - version-lies
  - stale-index
  - symlink
  - verification
modified: 2026-07-29T11:49:33.454Z
---

# Gotcha — bare `mage` runs your WORKING TREE, so the soaks never exercise a release

The mirror image of [[npx-mage-runs-the-published-release]], and the two together are the
whole trap: **`npx mage` runs the published package; bare `mage` runs your working tree.**

The global binary is an `npm link`:

```text
$ readlink -f "$(which mage)"
/home/sumit/mage-memory/dist/cli.js

$ npm ls -g --depth=0 | grep mage
├── mage-memory@0.0.15 -> ./../../../../../mage-memory
```

Every `mage` hook the soaks register invokes **bare `mage`**, never `npx`. Verified
2026-07-29 by parsing each soak's `.claude/settings.local.json` — five distinct commands
across nine hook events:

| command | events |
|---|---|
| `mage observe` | SessionStart · UserPromptSubmit · PostToolUse · PostToolUseFailure · PreCompact · SessionEnd · Stop · SubagentStop |
| `mage memory-hook` | PreToolUse · PostToolUse |
| `mage nudge` | SessionStart |
| `mage skills --metrics --quiet` | Stop |
| `mage flatten --quiet` | Stop (absent in prismalens-docs-hub) |

So the soaks track the working-tree build continuously.

Note the inventory is **not derivable from this repo** — `settings.local.json` is gitignored
and lives in the soak repos. Anything reasoning only over `mage/` will under-count it.

## What it cost

Three compounding errors on 2026-07-28/29, all from believing the soaks ran a release:

- **A release was treated as the gate.** The ADR-0041 wave plan was built on "each wave ends
  in a release, because soaks only exercise a published release." That premise is true for a
  real external user and **inert for the home soaks**. Release-gating bought nothing there.
- **`mage --version` lied convincingly.** It reported `0.0.15`, which was read as "the soaks
  are on published 0.0.15." It was actually reporting the *working tree's* `package.json`. The
  number was real; the inference was wrong. After the tree moved to 0.0.16 the same command
  reported 0.0.16 with nothing installed.
- **An "A-only observation window" was not A-only.** The linked `dist/` had carried Wave B
  since 07-27 11:20Z, hours before the window was declared. It held only by accident — see
  below.

## The second, separate cause of stale soak recall

`mage index` is **not among those registered hooks** — by design, not by omission: the repo's
commit and grooming guidance expects a manual refresh (`mage index` after capture, before the
commit). The consequence is still real. Nothing in the automatic path regenerates
`INDEX.md`/`MEMORY.md`, so those files sit at whatever build last wrote them — sreforge's was
from 07-20, nine hours before Wave B even merged. A migration that lands on disk does not
reach recall until someone runs the refresh.

That, not the installed version, is why soak recall goes stale. The two causes look identical
from the outside and have opposite fixes: one is *which binary*, the other is *nothing ran it*.

## How to apply

Before attributing any soak observation to a released version, resolve the binary and ask when
the artifact was last written:

```bash
readlink -f "$(which mage)"          # link target — tree or a real install?
npm ls -g --depth=0 | grep mage      # "-> ./../..." means npm link
date -r <kb>/MEMORY.md               # when was the artifact last generated?
```

A version number proves nothing on its own: with a link, `mage --version` is a property of your
checkout, not of what is installed.

**Do not `npm install -g mage-memory` to "update" it** — that severs the link the soaks dogfood
through and silently changes what every soak executes.

Related: [[soak-targets]] · [[dogfood-before-release]] — and note the pair rule at the top:
`npx` → published, bare → working tree.
