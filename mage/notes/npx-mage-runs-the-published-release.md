---
type: gotcha
tags:
  - mage/build
created: "2026-07-19"
updated: 2026-08-12
last_reviewed: 2026-08-12
status: active
provenance:
  repo: mage-memory
  work: adr-0038-pr1-note-rung-deletion
sources:
  - notes/dogfood-before-release.md
  - notes/mage-integration-test-framework.md
  - notes/soak-targets.md
  - decisions/0041-genre-decides-the-recall-rung.md
  - work/plan-adr-0041-waves.md
  - cc-session:d8d18f6f-21d4-4679-8b16-531132e1b88d
  - cc-session:cc52271f-c247-4662-ac8c-94699ee8bb4d
keywords:
  - npx
  - dogfood
  - stale-binary
  - published-release
  - global-install
  - dist
  - dream
  - index
  - false-positive
  - self-hosting
  - verification
  - npm-link
  - working-tree
  - soak
  - release-gating
  - version-lies
  - stale-index
  - symlink
---

# Gotcha — which `mage` binary am I actually running? Bare runs working tree, `npx` runs published

In this repository, execution context depends critically on how `mage` is invoked:
- **`npx mage` runs the PUBLISHED package** (resolving to globally installed package e.g. `~/.nvm/.../bin/mage`, NOT local source or `dist/`).
- **Bare `mage` runs your WORKING TREE** (because the global `mage` binary is an `npm link` pointing to your checkout's `dist/cli.js`).

Neither command emits warnings or version mismatch notices, and output looks entirely normal. Knowing only half of this binary-resolution trap causes severe misdiagnoses during development, dogfooding, and soak monitoring.

## Half 1: `npx mage` runs the published release (dogfooding trap)

`npx mage <cmd>` resolves to the globally installed `mage-memory` (`~/.nvm/.../bin/mage`), **not** to local source and not to local `dist/`.

So dogfooding mage on mage via `npx` silently exercises **a release**, not the change you are working on. On 2026-07-19 that meant every `mage index` / `mage dream` in a long session ran 0.0.13 — a build predating the wikilink parser merged that same day (`grep -c extractWikiLinks` on the installed `dist/cli.js` returned **0**).

### What it cost

Two failures in opposite directions, from the same stale binary:
- **A false positive.** A note with two well-formed, resolvable `[[wikilinks]]` was reported as an orphan — the old parser could not see wikilinks at all.
- **Three real findings hidden.** A current build reported **6** dangling links where the stale one reported 3. The extra three were dead wikilinks, exactly the class the merged parser was written to catch.

Worse, the clean-looking report was credited *to the new parser* in a status update — a confident claim about code that was not running.

### Recurrence (2026-07-27) — it bit the ADR-0041 rollout itself

Hours after PR #98 merged the genre filter to main, a curation branch regenerated the index with `npx mage index` → published 0.0.15 (no filter) → `MEMORY.md` silently reverted to carrying all 41 decision lines the filter had just removed. Caught by the operator reading the PR diff, not by any check. Until the fix-carrying version is PUBLISHED, every in-repo regeneration must use the local build: `pnpm build && node dist/cli.js index`.

## Half 2: Bare `mage` runs your working tree (soak monitoring trap)

The global binary is an `npm link`:

```text
$ readlink -f "$(which mage)"
/home/sumit/mage-memory/dist/cli.js

$ npm ls -g --depth=0 | grep mage
├── mage-memory@0.0.15 -> ./../../../../../mage-memory
```

Every `mage` hook the soaks register invokes **bare `mage`**, never `npx`. Verified 2026-07-29 by parsing each soak's `.claude/settings.local.json` — five distinct commands across nine hook events:

| command | events |
|---|---|
| `mage observe` | SessionStart · UserPromptSubmit · PostToolUse · PostToolUseFailure · PreCompact · SessionEnd · Stop · SubagentStop |
| `mage memory-hook` | PreToolUse · PostToolUse |
| `mage nudge` | SessionStart |
| `mage skills --metrics --quiet` | Stop |
| `mage flatten --quiet` | Stop (absent in prismalens-docs-hub) |

So the soaks track the working-tree build continuously.

Note the inventory is **not derivable from this repo** — `settings.local.json` is gitignored and lives in the soak repos. Anything reasoning only over `mage/` will under-count it.

### What it cost

Three compounding errors on 2026-07-28/29, all from believing the soaks ran a release:
- **A release was treated as the gate.** The ADR-0041 wave plan was built on "each wave ends in a release, because soaks only exercise a published release." That premise is true for a real external user and **inert for the home soaks**. Release-gating bought nothing there.
- **`mage --version` lied convincingly.** It reported `0.0.15`, which was read as "the soaks are on published 0.0.15." It was actually reporting the *working tree's* `package.json`. The number was real; the inference was wrong. After the tree moved to 0.0.16 the same command reported 0.0.16 with nothing installed.
- **An "A-only observation window" was not A-only.** The linked `dist/` had carried Wave B since 07-27 11:20Z, hours before the window was declared. It held only by accident.

### The second, separate cause of stale soak recall

`mage index` is **not among those registered hooks** — by design, not by omission: the repo's commit and grooming guidance expects a manual refresh (`mage index` after capture, before the commit). The consequence is still real. Nothing in the automatic path regenerates `INDEX.md`/`MEMORY.md`, so those files sit at whatever build last wrote them — sreforge's was from 07-20, nine hours before Wave B even merged. A migration that lands on disk does not reach recall until someone runs the refresh.

That, not the installed version, is why soak recall goes stale. The two causes look identical from the outside and have opposite fixes: one is *which binary*, the other is *nothing ran it*.

## How to apply & verify binary resolution

Before attributing any observation or health report to a version, resolve the binary and ask when the artifact was last written:

1. **Never verify a local change with `npx mage`.** Build, then invoke the local binary:
   ```bash
   pnpm build && node dist/cli.js dream
   ```
   Check `dist/cli.js`'s mtime against the source you just edited; a `dist` older than `src` means you are reading a stale answer.

2. **Verify binary resolution and artifact mtime:**
   ```bash
   readlink -f "$(which mage)"          # link target — tree or a real install?
   npm ls -g --depth=0 | grep mage      # "-> ./../..." means npm link
   date -r <kb>/MEMORY.md               # when was the artifact last generated?
   ```

3. **A version number proves nothing on its own:** with an `npm link`, `mage --version` is a property of your checkout, not of what is installed.

4. **Do not `npm install -g mage-memory` to "update" it** — that severs the link the soaks dogfood through and silently changes what every soak executes.

5. **Gate-2 pre-commit hook risk:** the Gate-2 `mage redact --staged` pre-commit hook runs through the same resolution, so commits are scanned by the published redactor, not the one in the tree. A redaction fix is not protecting you until it is released.

## Relations

- [[dogfood-before-release]] — dogfooding only tells you about the build you actually ran.
- [[soak-targets]] — layout and cadence of the soak monitor targets.
- [a directory-source marketplace copies your untracked tree](plugin-directory-source-copies-untracked-tree.md) — same question ("what am I actually running?"), asked of the skills plugin rather than the binary.
