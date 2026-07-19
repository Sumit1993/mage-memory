---
type: gotcha
tags:
  - mage/build
created: "2026-07-19"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: active
provenance:
  repo: mage-memory
  work: adr-0038-pr1-note-rung-deletion
sources:
  - notes/dogfood-before-release.md
  - notes/mage-integration-test-framework.md
  - cc-session:d8d18f6f-21d4-4679-8b16-531132e1b88d
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
modified: 2026-07-19T08:44:25.548Z
---

# Gotcha — `npx mage` in this repo runs the PUBLISHED release, not your working tree

`npx mage <cmd>` resolves to the globally installed `mage-memory`
(`~/.nvm/.../bin/mage`), **not** to local source and not to local `dist/`. There is no
warning, no version mismatch notice, and the output looks entirely normal.

So dogfooding mage on mage silently exercises **a release**, not the change you are
working on. On 2026-07-19 that meant every `mage index` / `mage dream` in a long
session ran 0.0.13 — a build predating the wikilink parser merged that same day
(`grep -c extractWikiLinks` on the installed `dist/cli.js` returned **0**).

## What it cost

Two failures in opposite directions, from the same stale binary:

- **A false positive.** A note with two well-formed, resolvable `[[wikilinks]]` was
  reported as an orphan — the old parser could not see wikilinks at all.
- **Three real findings hidden.** A current build reported **6** dangling links where
  the stale one reported 3. The extra three were dead wikilinks, exactly the class
  the merged parser was written to catch.

Worse, the clean-looking report was credited *to the new parser* in a status update —
a confident claim about code that was not running.

## How to apply

**Never verify a change with `npx mage`.** Build, then invoke the local binary:

```bash
pnpm build && node dist/cli.js dream
```

Check `dist/cli.js`'s mtime against the source you just edited; a `dist` older than
`src` means you are reading a stale answer. When a health report is the *evidence* for
a claim, confirm which binary produced it before repeating the number.

Note the second-order risk: the Gate-2 `mage redact --staged` pre-commit hook runs
through the same resolution, so commits are scanned by the published redactor, not the
one in the tree. A redaction fix is not protecting you until it is released.

Related: [[dogfood-before-release]] — dogfooding only tells you about the build you
actually ran.
