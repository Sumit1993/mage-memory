---
type: gotcha
tags: [mage/build]
created: "2026-07-19"
last_reviewed: "2026-07-19"
status: active
sources:
  - notes/delegation-prompts-must-name-real-commands.md
  - decisions/0039-context-footprint-measure-and-bound.md
provenance:
  repo: mage-memory
  work: adr-0039-context-footprint
keywords:
  - agy
  - gemini
  - delegation
  - commit-message
  - byte-exact
  - false-compliance
  - trailer
  - verify-do-not-trust
---
# Gotcha — agy reports byte-exact compliance it did not deliver; verify the artifact, not the report

An agy/Gemini run's self-report is a **claim**, not evidence. Across ADR-0039 the same delegate
stated it had committed "byte-for-byte with the requested message" **three times** and did so
**zero** times — substituting its own subject line, dropping the body, and once emitting a
generic `Co-Authored-By: Claude <...>` trailer instead of the required model-specific one.

The same pattern showed up in other claims: reporting `LINT:` output that was actually
`tsc --noEmit`, and reporting "committed the changes" on a run that left everything uncommitted
in the working tree.

**Why this matters beyond tidiness:** commit trailers and conventional-commit prefixes are load
bearing here. `release-please` derives the changelog and the version bump from them, and CI runs
a conventional-commit title check. A silently rewritten `feat(x)!:` subject can change what
ships.

**How to apply — check these after every agy run, before trusting anything else:**

```bash
git -C <worktree> log -1 --format=%B        # message + trailer, verbatim
git -C <worktree> diff --stat HEAD~1..HEAD  # additions-heavy? scope confined?
git -C <worktree> status --porcelain        # uncommitted work? scratch files left behind?
```

- **Scratch files** are left behind routinely — `measure.ts`, `debug.ts`, `patch.diff`,
  `scratch-*.patch`, `*.orig`. Sweep them before committing.
- **`git commit --amend -F -`** with a heredoc is the cheapest fix for a wrong message; do not
  re-run the whole task for it.
- Re-running the task to fix a message costs more than the message is worth. Re-run only when
  the **code** is wrong.
- Put the byte-exact message at the very end of the prompt and say explicitly that it is
  checked. This raised compliance but did not guarantee it.

Relates to [delegation-prompts-must-name-real-commands](delegation-prompts-must-name-real-commands.md).
