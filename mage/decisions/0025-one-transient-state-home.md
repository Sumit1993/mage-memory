---
type: decision
tags: [mage/decisions]
created: "2026-06-16"
updated: "2026-06-18"
last_reviewed: "2026-06-18"
status: active
provenance:
  repo: mage-memory
  work: 0.0.12-state-fold
sources:
  - src/paths.ts
  - src/scan.ts
  - src/commands/connect.ts
  - src/commands/init.ts
  - src/staged-scan.ts
  - src/commands/migrate.ts
  - mage/decisions/0011-recursive-scan-hub-projects.md
  - mage/decisions/0014-two-gate-redaction.md
  - mage/decisions/0018-mage-distill-observed-scratch-reader.md
  - mage/decisions/0021-offline-no-telemetry-local-signal.md
---

# 0025 — One transient-state home (`.mage/`) + redact config in `metadata.json`

**Status: active — implemented (decided 2026-06-16; implemented by the final 0.0.12 "state fold" PR, 2026-06-18). One `.mage/` dir holds all transient state; the redact allowlist now lives in `metadata.json`.**

## Context — artifact sprawl at the docs root

mage writes a growing set of files/dirs at every docs root. Each feature added its own,
independently, so the root accumulated a scatter of dot-dirs and config files:

| Artifact | Kind | Git | Added |
| --- | --- | --- | --- |
| `metadata.json` | config | committed | 0.0.x |
| `.redactignore` | config (on-demand) | committed | 0.0.12 |
| `.learnings/` | raw observed scratch (+ `.archive/`, `.last-purge`) | ignored | 0.0.5 |
| `.metrics/` | rollups + watermarks + ledgers (7 JSON files) | ignored | 0.0.6 |
| `.staging/` | judged-but-uncommitted lesson drafts | ignored | 0.0.12 |
| `INDEX.md` `_index.*.md` `IDENTITY.md` `Dashboard.md` | generated | committed | — |
| `notes/` `decisions/` `work/` (+ `projects/` `artifacts/` `archive/`) | content | committed | — |

The generated `.md` files and content dirs are intentional (the Obsidian-visible surface). The
**sprawl worry is the git-ignored transient dirs + the loose config files** — and it is
*open-ended*: `nudge-throttle.json` was just the latest state file dropped in, and nothing stops
the next feature adding another top-level dot-dir. There is no governing principle for "where
mage's machine state lives," so each addition is re-litigated and the root keeps growing.

## Decision

1. **All machine-written transient state lives under ONE git-ignored `.mage/` directory**, with
   subdirs that preserve the existing epistemic split:
   - `.mage/learnings/` (was `.learnings/`) — raw scratch, auto-pruned (ADR-0018).
   - `.mage/metrics/` (was `.metrics/`) — rollups, watermarks, reject ledgers.
   - `.mage/staging/` (was `.staging/`) — judged-but-uncommitted drafts (ADR-0024).
2. **The redaction allowlist moves out of a `.redactignore` file into `metadata.json`**, as a
   `redact` field: `{ "redact": { "ignore": ["<glob>"], "allow": ["<literal>"] } }`. The
   `.redactignore` file is removed.

**Principle (the point of this ADR):** *the docs root shows only committed config
(`metadata.json`), generated `.md` (the Obsidian surface), and content dirs (`notes/`,
`decisions/`, `work/`, …). EVERY transient, machine-written, git-ignored artifact lives under
`.mage/`.* New runtime state has exactly one home; it is never a new top-level entry.

```
<docs-root>/                 (= <repo>/mage in-repo, or the hub root)
  metadata.json              config (committed) — now carries `redact`
  INDEX.md  Dashboard.md  …  generated (committed, Obsidian-visible)
  notes/ decisions/ work/    content (committed)
  .mage/                     ALL machine state — ONE gitignore line, ONE scan-skip, ONE doctor probe
    learnings/
    metrics/
    staging/
```

## Why this layout (rationale)

- **Cohesion by lifecycle, not by feature.** `.learnings/`, `.metrics/`, `.staging/` are the same
  *kind* of thing — git-ignored, machine-written, regenerable-or-rebuildable working state.
  Grouping them by that shared property (not by which release added them) is the natural cut. The
  raw/rollup/draft distinction that mattered enough to keep separate survives — as subdirs.
- **One boundary instead of three.** The scan deny-list (ADR-0011 §2), the `mage connect`/`init`
  gitignore self-heal (ADR-0021), and the `doctor` sink probes each currently enumerate three
  dirs; they collapse to one `.mage/` entry. Fewer places for the "correctness boundary" to drift.
- **Config has one home.** `metadata.json` already holds KB identity, mode, hub refs, and the
  grooming sensitivity dial; the redact allowlist is KB config of the same kind.
- **Caps future sprawl.** With a stated principle, the next state file has an obvious home and
  adds nothing to the root.

## Migration

The change relocates **already-shipped** dirs (`.learnings/`, `.metrics/` exist in live KBs), so
it ships with a migration, run by `mage migrate` and offered by `mage doctor --fix`:

- if `<root>/.learnings|.metrics|.staging` exist → `rename` into `<root>/.mage/<leaf>` (move,
  never delete-then-recreate; idempotent; per-project in a hub via the existing `**` patterns).
- if `<root>/.redactignore` exists → parse it, merge into `metadata.redact`, write metadata, then
  delete the file.
- **fail-safe:** on any error, leave the old artifact in place — never lose a draft or a ledger.

**Timing:** built as the **final 0.0.12 PR, after the loop/redact PRs land on `main`** (it
rewrites symbols those PRs introduce and relocates the shipped dirs). This is *pre-publish* — the
cheapest window: no RELEASED layout ever shipped top-level `.staging`/`.redactignore`, and the two
long-shipped dirs migrate exactly once.

## Consequences

- **Positive:** one gitignore/scan-skip/doctor-probe entry; one home for all runtime state; the
  redact knob joins the rest of config; the anti-sprawl principle is now governing, not ad hoc.
- **Cost:** a large-but-mechanical PR (repoint every `LEARNINGS_DIR`/`METRICS_DIR`/`STAGING_DIR`
  join to helpers; update many test fixtures) + a one-time migration with its own tests.
- **Neutral:** the three dirs were already git-ignored (invisible in `git status`), so this is
  `ls -a` tidiness + future-proofing, not a functional fix.

## Alternatives considered

- **Keep the status quo (per-feature top-level dot-dirs).** Rejected: no principle ⇒ open-ended
  sprawl, re-litigated per feature.
- **Fold only the new 0.0.12 artifacts, leave `.learnings/`/`.metrics/`.** Rejected: avoids the
  migration but leaves the layout half-consolidated and the principle unestablished.
- **Merge the 7 `.metrics/` JSON files into fewer files.** Deferred: they already live inside one
  dir (not root sprawl); merging watermarks/ledgers is an internal micro-optimization, separable.
- **Keep `.redactignore` as a `.gitignore`-style file.** Rejected (user decision 2026-06-16): more
  hand-editable/familiar, but the goal is one-fewer-loose-file; metadata holds it fine.

## Relations

- **amends** [ADR-0011](0011-recursive-scan-hub-projects.md) — the scan deny-list / "folders are
  conventions" layout boundary; names the single transient-state dir it skips.
- **relates_to** [ADR-0014](0014-two-gate-redaction.md) — Gate-2's allowlist source moves from
  `.redactignore` to `metadata.redact`.
- **relates_to** [ADR-0018](0018-mage-distill-observed-scratch-reader.md) — `.learnings/` + the
  distill watermark, now under `.mage/`.
- **relates_to** [ADR-0021](0021-offline-no-telemetry-local-signal.md) — the local `.metrics/`
  accept/reject signal, now under `.mage/`.
- **follows** [ADR-0024](0024-organic-grooming-loop.md) — which introduced `.staging/`, the third
  transient state this ADR folds in.
