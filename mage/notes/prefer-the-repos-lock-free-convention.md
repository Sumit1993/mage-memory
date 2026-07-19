---
type: gotcha
tags: [mage/build]
created: "2026-07-19"
last_reviewed: "2026-07-19"
status: active
sources:
  - decisions/0039-context-footprint-measure-and-bound.md
  - src/metrics/rollup.ts
  - src/grooming/tally.ts
  - src/metrics/footprint-trend.ts
provenance:
  repo: mage-memory
  work: adr-0039-context-footprint
keywords:
  - concurrency
  - lockfile
  - read-modify-write
  - append-only
  - jsonl
  - fold-on-read
  - toctou
  - hook-path
  - existing-convention
---
# Gotcha — a lock on a hook path is the wrong mechanism; mage already folds append-only JSONL

Reaching for a lockfile to protect a read-modify-write took **four review rounds** and never
fully converged. The codebase already had the right answer in two files.

**The saga (2026-07-19, ADR-0039).** The footprint trend was written as a JSON document mutated
in place on every SessionStart. Each fix exposed the next layer:

1. **Read-modify-write race** — concurrent sessions dropped each other's samples.
2. **Ownership bug** — stale-lock recovery did `stat` → judge stale → `rm`, so a process could
   delete a *successor's* live lock. The release path had the same defect.
3. **Unbounded retry** — the stale-eviction branch `continue`d without incrementing the attempt
   counter, so the loop could spin. On a SessionStart hook this is worse than the data loss it
   prevented: a lock that blocks beats no lock only if it never blocks.
4. **Takeover race that survived all of the above** — `rename` is atomic but does not verify
   *which* file it moved, so an evicting process could rename away a lock created after its own
   check.

**The actual lesson: the mechanism was wrong, not the implementation.** mage already stores
concurrent-writer data as **append-only JSONL folded on read** —
[`src/metrics/rollup.ts`](../../src/metrics/rollup.ts) folds `.mage/learnings/*.skills.jsonl`
sidecars, and [`src/grooming/tally.ts`](../../src/grooming/tally.ts) reads session streams the
same way. A single small append has no read-modify-write step, so there is no lock and none of
that race class.

**How to apply:**

- On any path that multiple sessions can hit — especially **hook paths that must never block or
  throw** — write **one appended line**, and do the merging, deduping and pruning at **fold
  time** on read.
- Parse each line in its **own** try/catch so a torn or half-written line is skipped, never
  fatal. That per-line tolerance is what makes append-only safe without a lock.
- Do bounding and compaction on the **read** path (a user-invoked command may do real work), not
  the write path.
- **Before designing concurrency control, grep for how this repo already does it.** Both prior
  examples were in files read during the survey for this very change.
- Concurrency review converges one layer per round. If a small function is on its third fix,
  stop patching and question the mechanism.

Relates to [unreachable-constant-reports-a-false-state](unreachable-constant-reports-a-false-state.md).
