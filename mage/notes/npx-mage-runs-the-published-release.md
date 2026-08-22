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
- **`npx mage` runs the PUBLISHED package** (resolving to globally installed package, e.g. `~/.nvm/.../bin/mage`, **not** local source or `dist/`).
- **Bare `mage` runs your WORKING TREE** (because the global `mage` binary is an `npm link` pointing to your checkout's `dist/cli.js`).

Neither command emits warnings or version mismatch notices, and output looks entirely normal. Knowing only half of this binary-resolution trap causes severe misdiagnoses during development, dogfooding, and soak monitoring.

## Insight

- **Dogfooding trap (`npx mage`)**: Dogfooding mage on mage via `npx` silently exercises the published release rather than local changes. Running `npx mage index` or `npx mage dream` tests or regenerates artifacts against the older published binary, which can hide newly merged features, report false positives/negatives, or silently revert generated files (such as `MEMORY.md`).
- **Soak monitoring trap (bare `mage`)**: Every hook registered by the soaks (`observe`, `memory-hook`, `nudge`, `skills --metrics`, `flatten`) invokes bare `mage`, not `npx`. Because the global binary is an `npm link`, soaks continuously execute the working-tree `dist/cli.js`, not a published release. Treating a release as a soak gate or assuming soaks run a release is false.
- **`mage --version` with `npm link`**: With an `npm link`, `mage --version` reports the working tree's `package.json`, not what is published or globally installed elsewhere.
- **Stale recall vs stale binary**: Automated hooks do not run `mage index`. Knowledge base recall artifacts (`INDEX.md`, `MEMORY.md`) remain at whatever build last generated them until manually refreshed.

## Procedure

1. **Never verify local changes or regenerate indexes with `npx mage`**:
   Always build and invoke the local binary directly:
   ```bash
   pnpm build && node dist/cli.js index
   ```
   Confirm `dist/cli.js`'s mtime is newer than modified source files.

2. **Verify binary resolution and artifact mtime**:
   ```bash
   readlink -f "$(which mage)"          # link target: working tree dist/ or global install
   npm ls -g --depth=0 | grep mage      # check if npm link is active ("-> ...")
   date -r mage/MEMORY.md               # check when the recall artifact was generated
   ```

3. **Do not run `npm install -g mage-memory` to update**:
   Overwriting the global binary severs the `npm link` and disconnects soak dogfooding from the local working tree.

4. **Be aware of Gate-2 pre-commit hook resolution**:
   The `mage redact --check --staged` pre-commit hook runs through the environment's `mage` binary resolution.

## Relations

- realizes [dogfood before release](dogfood-before-release.md) — dogfooding only tells you about the build you actually ran.
- sibling_of [soak targets](soak-targets.md) — layout and cadence of the soak monitor targets.
- sibling_of [a directory-source marketplace copies your untracked tree](plugin-directory-source-copies-untracked-tree.md) — same question ("what am I actually running?"), asked of the plugin cache.
