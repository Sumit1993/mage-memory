---
type: note
tags: [mage/build]
created: "2026-06-27"
sources:
  - cc-session:0c762176-4434-4798-8bb2-abd402eed957
provenance:
  repo: mage-memory
  commit: 295298e
---
# Mage main branch protected

mage-memory main is now strict-PR protected — never direct-push; branch → PR → CI gate green → squash-merge


As of 2026-06-09, the `mage-memory` GitHub repo enforces a "main protection"
ruleset (id 17441632, no bypass actors — applies to the maintainer too):
`pull_request` required (0 approvals, so solo self-merge works), required
status check **`CI gate`**, plus force-push and deletion blocked.

**Why:** user chose "strict PR for everyone" when setting up OSS practices —
cleanest, most auditable history; CI must be green before anything lands.

**How to apply:** in this repo, do NOT `git push origin main` directly — it will
be rejected. Always: branch off main → commit → `git push -u origin <branch>` →
`gh pr create` → wait for the **CI gate** check (build & test on Node 22/24 +
tarball smoke on Node 18/20) → `gh pr merge --squash --delete-branch`. Releases
still go: merge to main → tag `vX.Y.Z` → GitHub release → user runs `npm publish`.

CI lives at `.github/workflows/ci.yml`; the `CI gate` job aggregates the matrix
so it's the single stable required context. Related: [mage-008-staged-build](mage-008-staged-build.md),
[no-emojis-in-releases](no-emojis-in-releases.md), [dogfood-before-release](dogfood-before-release.md).
