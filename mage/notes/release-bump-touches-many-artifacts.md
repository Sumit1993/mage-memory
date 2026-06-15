---
type: gotcha
tags: [mage/release]
created: "2026-06-15"
last_reviewed: "2026-06-15"
status: active
provenance:
  repo: mage-memory
  work: 0.0.11-release
sources:
  - release-please-config.json
  - .release-please-manifest.json
  - .github/workflows/release-please.yml
  - package.json
  - .claude-plugin/plugin.json
  - .claude-plugin/marketplace.json
  - README.md
  - CHANGELOG.md
  - src/release-consistency.test.ts
keywords: [release, release-please, version, bump, changelog, readme, badge, plugin, marketplace, consistency, hygiene, pat]
---

# A release bump touches MORE than package.json — release-please now owns it

Every mage release must bump **all** version-carrying artifacts, not just `package.json`.
Missed twice in the manual era: the README status badge sat at `0.0.9` through the 0.0.10
release, and both 0.0.10 and 0.0.11 shipped with **no CHANGELOG entry** (0.0.10's changes
were stranded under `[Unreleased]`). As of 0.0.11 the bump is automated.

## release-please owns the mechanical surface (from 0.0.11)

[release-please](https://github.com/googleapis/release-please) maintains a rolling **release
PR** off conventional commits. Merging it rewrites every version carrier from one source —
no hand bump to forget:

- `package.json` `version` — the `node` release-type updater.
- `.claude-plugin/plugin.json` `$.version` — `extra-files` JSON updater.
- `.claude-plugin/marketplace.json` `$.plugins[0].version` — `extra-files` JSON updater.
- `CHANGELOG.md` — generated from the commits since the last tag (inline-link form
  `## [x](compare-url) (date)`, not the legacy `## [x] - date`).

0.0.x cadence is held by `bump-minor-pre-major` + `bump-patch-for-minor-pre-major` in
`release-please-config.json` (a `feat` bumps **patch**, not minor, while < 1.0.0). The
manifest (`.release-please-manifest.json`) pins the current version; it was seeded at `0.0.10`
so 0.0.11 is the first managed release. **`include-component-in-tag: false`** keeps tags as
`v<version>` (matching the existing `v0.0.x` history) — without it release-please prefixes the
package name (`mage-memory-v0.0.11`), fails to recognize the existing `v0.0.10` tag, and the
changelog reaches back into already-released work.

**The README does NOT carry a hand-version** (learned the hard way): a shields **3-segment**
badge `status-<ver>-<color>` can't be auto-bumped — release-please's generic updater reads
`0.0.10-orange` as a semver with a `-orange` prerelease and replaces the whole thing, dropping
the color (and the 2-segment `status-<ver>?color=` form 404s on shields). So the status badge
is a **static `pre-1.0`** mark, the live version shows via the **`npm/v` badge**, and README is
NOT in `extra-files`.

**Still MANUAL (editorial):** the README `## Status` prose line + "Recent releases" highlight
list — release-please does not touch prose; curate by hand. **npm publish is also manual** — we
dogfood the built artifact locally first, so the workflow tags + cuts the GitHub release but
never publishes.

## Setup the automation depends on (one-time)

- A **PAT** stored as the `RELEASE_PLEASE_TOKEN` secret. The default `GITHUB_TOKEN` cannot be
  used: main is branch-protected with required CI checks, and PRs opened by `GITHUB_TOKEN` do
  **not** trigger workflows — so the release PR could never satisfy its checks. A fine-grained
  PAT (contents: write + pull-requests: write on this repo) makes release-please's commits
  trigger `ci.yml`.

## The CI backstop (kept)

`src/release-consistency.test.ts` still asserts the three manifests + the README badge agree
with `package.json`, and that `CHANGELOG.md` has a dated heading for the current version (now
matching **both** the legacy and release-please heading forms). It is defense in depth — if an
`extra-files` path is ever dropped from the config, a release PR goes out half-bumped and this
fails CI.

The old "known gap" (a consistency test can't catch "forgot to bump *everything*") is **closed
by release-please**: the next version is computed from commits, so there is no manual bump to
forget — the `mage doctor --release` preflight is no longer needed for that failure mode.

Relates: [release sequence](plan-release-sequence.md) · the release-please decision is recorded
in [the 0.0.12 spec](plan-0.0.12-organic-grooming-loop.md) (becomes ADR-0024).
