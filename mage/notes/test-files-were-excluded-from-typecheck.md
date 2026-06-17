---
type: gotcha
tags: [mage/build]
created: "2026-06-15"
last_reviewed: "2026-06-15"
status: active
provenance:
  repo: mage-memory
  work: typecheck-test-files
sources:
  - tsconfig.json
  - .github/workflows/ci.yml
  - src/dashboard/collect.test.ts
keywords: [typecheck, tsc, tests, tsconfig, exclude, vitest, tsup, esbuild, ci, fixture]
---

# Test files were never type-checked (tsconfig excluded them)

`tsconfig.json` shipped with `"exclude": [..., "**/*.test.ts"]`, so `pnpm
typecheck` (`tsc --noEmit`) skipped every `*.test.ts`. Nothing else covered
them either: **both `tsup` (build) and `vitest` (test) run on esbuild, which
*strips* types instead of checking them.** Net effect — test files had **zero
static type coverage** for the life of the project. A type error in a test was
invisible until someone read the line.

When the exclude was dropped, `tsc` surfaced **98 latent errors across 12 test
files**. The dangerous class: **invalid string-literal fixtures that only
"passed" by accidental fall-through.** ~18 fixtures set `kind: "in-repo"` on a
`DashboardData`/threshold input whose type is `"repo" | "hub"` (`"in-repo"` is a
*mode* value, not a *kind*). Runtime code branches on `=== "hub"`, so the bogus
value silently behaved like `"repo"` — the test was green while asserting
against a value that can't exist. One (`collect.test.ts`) even asserted
`data.meta.kind === "in-repo"`, locking the bug in both directions.

## What was real vs. cosmetic

- **Real semantic bugs:** the `kind: "in-repo"` fixtures (dashboard + grooming).
  Fix = the canonical `"repo"`; update any assertion that passed the value
  straight through (`collectDashboardData` copies `kind` to `meta.kind`).
- **Intentional-but-mistyped:** `index-cmd`/`collect` hub fixtures using
  `storage: "in-repo"` *deliberately* exercise the v1→v2 legacy-alias
  normalization (`normalizeHubMetadata`, paths.ts, renames `"in-repo"` →
  `"repo-owned"` on read). Keep the value; model the raw on-disk shape with a
  `RawHubProject` type so the fixture is type-honest.
- **Cosmetic:** one under-typed helper caused 69 of the 98 — `check(checks:
  Array<{ name: string }>)` in `doctor.test.ts` should be `DoctorCheck[]`.
  Plus a few `possibly-undefined` accesses (`settings.hooks.SessionStart?.find`),
  `noUncheckedIndexedAccess` array spreads (`TARGET_AGENT_DIRS[0]!`), a readonly
  `as const` tuple vs a mutable param, and one dead local.

## The fix + the gate

Drop `"**/*.test.ts"` from `tsconfig.json`'s `exclude`. The build is untouched
(`tsup` bundles from explicit entries; `dts` follows imports from `src/index.ts`,
so unimported test files never reach the declaration output — `dist/` stays
test-free). CI already runs `pnpm typecheck`, so **this one-line change makes CI
gate test type errors from now on** — no workflow edit. Bonus: the editor (which
reads `tsconfig.json`) now flags these live, as you type.

Relates: the version-bump surface in [release artifacts](release-bump-touches-many-artifacts.md).
