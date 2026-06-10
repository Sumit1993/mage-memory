---
type: gotcha
tags: [mage/capture]
created: "2026-06-09"
updated: "2026-06-09"
last_reviewed: "2026-06-09"
status: active
provenance:
  repo: mage-memory
  work: 0.0.9-soak-wiring
sources:
  - src/commands/connect.ts
  - src/gitignore.ts
  - src/commands/doctor.ts
  - src/commands/init.ts
keywords: [connect, gitignore, capture-sink, learnings, metrics, drift, migration, doctor, safe-by-default, leak, version-bump, hook-block]
---

# Gotcha — `mage connect` turns on capture but does not ensure the sink is gitignored

Wiring the 0.0.9 soak into two pre-existing external KBs surfaced a real gap.
`mage connect` happily wired capture into repos whose `.gitignore` did **not**
cover the capture sinks: **prismalens-docs-hub** (a *public* repo) had an
**empty** `.gitignore`, and **sreforge-memory** was missing `.metrics/`. One
`git add -A` away from committing redacted-but-still-sensitive `.learnings/` /
`.metrics/` into a public repo — a direct contradiction of mage's own
"*redact before write*" and "*metrics never enter git*" principles
([ADR-0014](../decisions/0014-two-gate-redaction.md)).

**Root cause — a missing-feature gap, not a crash bug.** `connect`'s job is
wiring hooks; it **never touches `.gitignore`** (it only prints the word
"gitignored" in a log line). The ignore rules are written by **`init`**, once, at
KB creation, via the already-existing idempotent helper
`ensureGitignored(repoPath, patterns)` in `src/gitignore.ts`. So:

1. **`connect` is the exact moment capture turns on**, yet it does not verify the
   sink it is about to fill is ignored. Safety-critical seam, unguarded.
2. **No migration retrofits an old KB.** `.metrics/` was added in 0.0.6; KBs
   `init`'d before that (sreforge) never got the rule, and `init` is create-once.
   When mage's conventions evolve, existing KBs silently fall behind.

**Sibling gap — stale hook block after a version bump.** Same root cause: a KB
connected by an older mage keeps its old hook block. mage-memory had only **6 of
8** observe events until re-`connect`ed for the 0.0.8 `Stop`/`assistant_msg`
hook — and nothing nudged that the connection had drifted.

**Fix (the 0.0.9 "setup-integrity" bucket).**

- **`connect` self-heals:** call `ensureGitignored(root, [".learnings/", ".metrics/"])`
  for the layout (hub-root vs `mage/`), and report what it added. Safe-by-default.
- **`doctor` grows from env-only to KB + connection health:** `git check-ignore`
  the capture sinks (with **`mage doctor --fix`** calling `ensureGitignored`);
  detect a hook block that does not match the current mage's expected block and
  nudge `mage connect` to refresh; sanity-check KB structure + INDEX freshness.

**Workaround until shipped.** After `mage connect` on any pre-existing KB, run
`git check-ignore .learnings/x .metrics/x` (use a file path, not a bare dir — a
`dir/` pattern won't match a non-existent dir queried without the slash) and add
the rules if missing. Re-run `mage connect` after upgrading mage to refresh the
hook block.

**General lesson.** A tool that begins writing to a sink should guarantee the sink
is safe *at the moment it starts writing*, not assume a one-time `init` covered
it — especially when the writes are sensitive and the repo may be public.

## Relations

- guards [ADR-0014 — two-gate redaction](../decisions/0014-two-gate-redaction.md)
- found_during [release sequence — 0.0.9](plan-release-sequence.md)
- adapter [ADR-0017 — mage connect: the host hook adapter](../decisions/0017-mage-connect-host-hook-adapter.md)
- see_also [Gotcha — scope Gate-2 to the knowledge base](gate2-blocks-own-redaction-fixtures.md)
