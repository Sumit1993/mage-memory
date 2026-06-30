---
type: pointer
tags:
  - mage/roadmap
created: "2026-06-28"
last_reviewed: 2026-06-28
sources:
  - file:~/ai-context/mage-soak/soak-report.mjs
  - file:~/ai-context/handoff-mage-testing-strategy-2026-06-27.md
  - cc-session:1cf44183-6e81-4dcf-aa74-f14a813cc4a6
keywords:
  - soak
  - dogfood
  - prismalens
  - sreforge
  - monitor
  - lesson-path
  - digest
  - targets
  - read-only
  - external
---

# mage soak — the external dogfood targets + the read-only monitor

mage is soak-tested against real external codebases, not only self-hosted. **The two external
soak targets are `prismalens` and `sreforge`** (alongside `mage-memory` itself). This note exists
because the soak setup previously lived only in `~/ai-context/` + CC-native memory and never
surfaced in recall — a note IS a memory, see [mage is durable memory](mage-is-durable-memory.md).

## The soak units (capture targets)

- **mage-memory** — in-repo self-dogfood (`~/mage-memory`).
- **prismalens** — code repo `~/prismalens-org/prismalens`; notes in hub
  `~/prismalens-org/prismalens-docs-hub/projects/prismalens-platform`.
  (`prismalens-agents` / `prismalens-engine` was RETIRED 2026-06-18, superseded by prismalens-platform.)
- **sreforge** — code repo `~/sources/sreforge-workspace/sreforge`; notes in hub
  `~/sources/sreforge-workspace/sreforge-memory/projects/sreforge`.

A soak UNIT is one capture target, never a whole hub: an in-repo KB is its own unit; a hub fans
out one unit per registered project, driven from the project's CODE repo (ADR-0010/0012).

## The monitor (lives OUTSIDE the repo on purpose)

`~/ai-context/mage-soak/` is a **monitor + research harness, not a pass/fail test** — kept out of
the repo deliberately (testing-strategy handoff). `soak-report.mjs` is strictly READ-ONLY: it runs
`mage groom --json` / `mage promote --json` (neither mutates without `--accept`/`--reject`/`--seen`),
counts organic notes against a stamped `soak-baseline.json`, and writes a dated digest
(`YYYY-MM-DD.md`). It never accepts a draft, advances a watermark, or commits — disposition stays human.

**Signal:** staged lessons pending (lesson path) + organic notes created since baseline; recurrence
candidates are a secondary momentum line.

**Run:** `node ~/ai-context/mage-soak/soak-report.mjs` (cron-driven via `soak-digest.sh`).
