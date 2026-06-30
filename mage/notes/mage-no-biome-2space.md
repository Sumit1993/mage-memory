---
type: note
tags: [mage/build]
created: "2026-06-27"
sources:
  - cc-session:98ba2843-dcf0-4188-ad62-87a15b8eab12
provenance:
  repo: mage-memory
  commit: 295298e
---
# Mage no biome 2space

mage-memory has NO biome/prettier/editorconfig + no lint step in CI; it is 2-space by convention. Never run biome --write (tab default) — it destructively reformats whole files.


mage-memory (the mage CLI repo) has **no formatter/linter config** (no `biome.json`,
no prettier, no `.editorconfig`) and **no lint/format step in CI** — `package.json`
scripts are only `typecheck` (`tsc --noEmit`) and `test` (`vitest run`); CI runs
build + test + typecheck + the PR-title check. Source files are **2-space indented by
convention**, enforced by nobody automated.

**Gotcha (hit 2026-06-16):** running `pnpm exec biome check --write` uses biome's
DEFAULT config, which indents with **tabs** — it reformatted whole 2-space files to
tabs (a 1500-line destructive diff) and rewrapped multi-line literals. Recovery was
`git checkout -- <files>` + re-applying edits in 2-space.

**How to apply:** match the surrounding 2-space style by hand; do NOT run biome (or
any formatter) on this repo. The biome "errors/warnings" it reports are irrelevant to
CI. Verify a clean slice with `git diff --stat` (should be additions-heavy, not a
whole-file churn). Relates to [mage-main-branch-protected](mage-main-branch-protected.md).
