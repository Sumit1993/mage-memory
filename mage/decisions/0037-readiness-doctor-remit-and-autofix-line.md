---
type: decision
tags:
  - mage/decisions
created: "2026-07-02"
updated: 2026-07-02
last_reviewed: 2026-07-02
status: accepted
provenance:
  repo: mage-memory
  work: adr-0037-readiness-doctor
sources:
  - notes/plan-readiness-doctor.md
  - decisions/0009-no-runtime-automation-rides-host-hooks.md
  - decisions/0030-agent-autonomy-ladder.md
  - src/commands/doctor.ts
  - src/doctor/kb-checks.ts
  - cc-session:3c5c8534-8611-4d9d-9087-9975da48dd44
keywords:
  - doctor
  - readiness
  - remit
  - recall
  - skills
  - auto-fix-line
  - host-config
  - read-only
  - fail-open
  - no-runtime
  - version-stamp
  - detect-and-instruct
---

# 0037 — doctor's remit extends to recall + skills readiness, on a bounded auto-fix line

> **Status: accepted (ratified 2026-07-02).** Output of a 2026-07-02 light grill of
> [plan-readiness-doctor](../notes/plan-readiness-doctor.md), promoted after the first slice
> shipped (PR #54). Resolves that plan's three open questions.

## Context

`mage doctor` verified the capture **plumbing** — hooks, gitignore sinks, redact hook,
metadata schema — and every check passed in the live soak. Yet the agent still misbehaved,
because the failures sat one layer up: the mage plugin was uninstalled (so `mage:learn`
did not exist), a stale `/mage-learn` awareness block steered it at a retired command, and a
**9-line index for 62 notes** gave it almost no map. All three were invisible to doctor.
Fixing the class means doctor must audit whether the agent can **find** and **act on** the
knowledge, not just whether capture is wired — which raises three questions the first slice
deferred to a grill.

## Decision

**1. doctor's remit is three layers, not one.** An agent "works the way mage wants" only if
**capture** (new knowledge lands — the existing checks), **recall** (it can find what's known
— index fresh, `AGENTS.md` block current, MEMORY twin present), and **skills** (it can act —
the plugin is reachable) all hold. doctor checks all three; setup commands (`connect`/`link`/
`init`) end by printing the recall+skills subset so drift surfaces at setup, not weeks later.

**2. doctor MAY read host config, read-only and fail-open (resolves Q1 vs [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)).**
[ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) forbids a *runtime/daemon of our
own*; it explicitly has automation **ride the host's hooks and config**. doctor already reads
the host's `settings.local.json` for hook-drift, so reading `installed_plugins.json` for skill
reachability is the same class — not a new runtime. Bounded by: **read-only** (never writes
host config), **fail-open** (absent/unreadable/format-changed → "not installed", never throws),
**pure core + thin IO** (`mageInstalledIn` is a pure, tested function), and **never a hard
failure** (skills is advisory). Honors `CLAUDE_CONFIG_DIR`.

**3. The auto-fix line: idempotent ∧ mage-owned ∧ local ∧ reversible (resolves Q2).** `mage
doctor --fix` auto-repairs drift only when it is all four — e.g. regenerating the index, or
rewriting the mage-owned `AGENTS.md` block between its `BEGIN/END mage` markers. It is
**detect-and-instruct** (print the command, change nothing) for anything global, user-owned,
foreign, or irreducibly human: installing a plugin into `~/.claude`, touching a non-mage file,
`git commit`. This is the line the codebase already drew (the redact-hook check is detect-only)
and the same principle as the [autonomy ladder](0030-agent-autonomy-ladder.md) keeping the git
commit human.

**4. Staleness is stamped, `<!-- BEGIN mage vN -->` (resolves Q3).** A single integer, bumped
only when the block's agent-facing contract changes (not every wording edit); a block missing
it reads as legacy → stale. Paired with the index's existing `> N notes` header, this makes
staleness an O(1) comparison. Low commitment — it is a comment, backward-compatible. The
first slice's retired-token heuristic (`/mage-learn`) ships as the interim; the stamp lands
in a follow-up.

## Consequences

- **Setup can no longer silently half-wire.** The readiness footer catches uninstalled skills
  and stale recall at `connect`/`link` time. Future checks get a clear home and a clear
  auto-fix rule (the four-part test), so the surface stays coherent.
- **doctor reads host internals** — a bounded coupling to Claude Code's `installed_plugins.json`
  shape. Contained by read-only + fail-open: a format change degrades to a false "not
  installed" nudge, never a crash. Revisit if a second harness appears (see [ADR-0036](0036-defer-harness-adapter-seam.md)).
- **A version-bump discipline** is owed for the `AGENTS.md` block: bump `vN` when the
  agent-facing contract changes, or the O(1) staleness check silently rots.
- **Skills stays advisory** — never fails CI or `passed`, matching "detect-and-instruct."

## Relations
- realizes [plan — the readiness doctor](../notes/plan-readiness-doctor.md)
- extends [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- ethos_from [ADR-0030 — opt-in agent autonomy ladder](0030-agent-autonomy-ladder.md)
- verifies_wiring_of [ADR-0032 — capture-redirect native memory](0032-capture-redirect-native-memory.md)
- verifies_wiring_of [ADR-0033 — recall: import the bounded index](0033-recall-import-bounded-index.md)
- revisit_with [ADR-0036 — defer the HarnessAdapter seam](0036-defer-harness-adapter-seam.md)
