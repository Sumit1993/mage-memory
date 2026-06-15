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
- `README.md` status badge — `extra-files` **generic** updater; the badge line carries an
  inline `<!-- x-release-please-version -->` annotation so it gets rewritten in place.
- `CHANGELOG.md` — generated from the commits since the last tag (inline-link form
  `## [x](compare-url) (date)`, not the legacy `## [x] - date`).

0.0.x cadence is held by `bump-minor-pre-major` + `bump-patch-for-minor-pre-major` in
`release-please-config.json` (a `feat` bumps **patch**, not minor, while < 1.0.0). The
manifest (`.release-please-manifest.json`) pins the current version; it was seeded at `0.0.10`
so 0.0.11 is the first managed release.

**Still MANUAL (editorial, not mechanical):** the README `## Status` prose line and its
"Recent releases" highlight list — release-please does not touch prose. Curate them by hand
when you write a release's highlights. **npm publish is also manual** — we dogfood the built
artifact locally first, so the workflow tags + cuts the GitHub release but never publishes.

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
