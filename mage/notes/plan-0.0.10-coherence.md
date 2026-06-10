---
type: plan
tags: [mage/cli, mage/coherence]
created: "2026-06-10"
updated: "2026-06-10"
last_reviewed: "2026-06-10"
status: active
provenance:
  repo: mage-memory
  work: 0.0.10-coherence-planning
sources:
  - src/cli.ts
  - src/paths.ts
  - src/commands/connect.ts
  - src/commands/link.ts
  - src/commands/doctor.ts
  - src/doctor/link-checks.ts
  - src/commands/promote-cmd.ts
  - src/commands/distill-cmd.ts
  - src/dream.ts
keywords: [consolidation, commands, coherence, friction, external-kb, hub, link, connect, distill, promote, dream, doctor, capture-health, vocabulary, every-flavor-is-a-kb]
---

# Plan — 0.0.10 "coherence": shrink the command surface, close the external-KB friction

Wiring the 0.0.9 soak into two pre-existing hub KBs (prismalens-docs-hub,
sreforge-memory) surfaced a cluster of friction. The capture-routing bug
([resolveDocsRoot follows hub_path](plan-release-sequence.md), shipped in 0.0.9)
and the [connect-doesnt-ensure-ignores](connect-doesnt-ensure-ignores.md) gotcha
are fixed; what remains is **coherence** — fewer commands, fewer silent traps.
This note is the 0.0.10 scope; it stacks on the already-decided 0.0.10 items
(remove the SDD skills; grill hub flat-vs-nested → ADR; the "every flavor is a
KB" vocabulary).

## Insight — the surface has two real problems, not "too many commands"

The friction is **(1) plumbing mixed with user verbs**, and **(2) one job spread
across several verbs** (setup, grooming). Fix those two and the count stops
mattering.

## Consolidations (recommended)

1. **Hide the plumbing.** `observe`, `promote`, `distill`, `redact`, `index` are
   *plumbing behind skills* (the CLI help even says so) yet sit flat next to user
   verbs — so `mage --help` reads as ~18 commands when ~6 are for humans. Mark
   them hidden / group under `mage internal`. Biggest "I don't remember the
   commands" win, nearly free. *(The author hitting this is the signal.)*

2. **Collapse setup; make `doctor --fix` the universal repair.**
   - `mage init` (in-repo) and `mage link` (external) should auto-`connect`
     unless `--no-connect`. Today setup is always two steps (init/link **then**
     connect) — that is the felt friction.
   - `mage doctor --fix` becomes the one repair: gitignore (0.0.9) + **stale link
     paths** (0.0.9, [link-checks.ts](../../src/doctor/link-checks.ts)) + drifted
     hooks. "My setup broke" → one command, not "which of link/connect/doctor
     owns this half".

3. **Collapse grooming.** `distill` + `promote` + `dream` are phases of one
   pipeline (surface candidates → tally recurrence → apply proposals). Fold to one
   `mage groom` (read-only default, `--apply` to act) with the others as internal
   phases, and one `mage:groom` skill instead of `mage:distill`/`promote`/
   `graduate`. Largest change → later in 0.0.10 / early 0.1.0.

4. **"Every flavor is a KB" vocabulary** (already scoped) unifies the
   in-repo / external / hub language that drives the proliferation.

## Friction inventory (other things the external-KB work exposed)

- **A. Declared-but-unimplemented mode.** `mode:"external"` lived in the metadata
  schema while `resolveDocsRoot` never honored it — captures silently mis-routed
  for a year of the design's life. *Lesson: a mode with no resolver is a trap.*
  (Fixed 0.0.9.) Audit for other schema fields with no behavior.

- **B. Silent capture (no liveness signal).** The whole pipeline fails-open, so a
  broken setup yields **zero captures and zero errors** — the bug was invisible
  for a day. Need a capture-liveness signal: `mage doctor` (or `mage status`)
  reporting, per KB/hub, "N projects · M connected · K have ever captured · last
  event <when>". Turn silence into a visible health line. *(0.0.9 down-payment:
  `mage doctor` now reports DISCONNECTED — capture history but no hooks — vs a
  fresh never-connected KB. The fuller per-project liveness rollup is the 0.0.10
  piece.)*

- **C. `connect`-in-hub is a false "done".** Connecting a *hub* wires the hub dir
  (where little real work happens), **not** the member code repos (where it does).
  The user connected both hubs and got nothing. `connect`/`doctor` should be
  hub-aware: when run in a hub, list registered projects and their connect state,
  and offer `mage connect --all-projects` to wire each `code_repo_path` in one go.

- **D. Stale link paths after a move** — forward `hub_path` and back
  `code_repo_path` drift independently; `connect` never repaired them. (0.0.9:
  doctor detects both, `--fix` heals the back-reference; a moved *hub* is detected
  but needs an explicit `mage link <new-hub>`.) Remaining: a true reconcile that
  can re-home a moved hub.

- **E. Project-name divergence.** `mage link` defaults `project` to the code
  repo's basename, which silently mismatches the hub's registered name
  (`prismalens-agents` vs registered `prismalens-engine`). `link` should validate
  the basename against the hub registry and suggest `--project <registered>`.

- **F. Hub-root-vs-projects ambiguity.** A hub root is itself a capturable KB AND
  a registry of projects. `mage promote` at the hub root folds only
  `<hub>/.learnings` and **misses every project** — which silently broke the soak
  digest (it had to be rewritten to run promote per project's code repo). Decide:
  is the hub root a KB? (ties directly to "every flavor is a KB").

- **G. Cross-repo side effects, unannounced.** `mage connect` in a *member* repo
  writes a `.gitignore` into the **hub** repo (correct — the sinks live there) but
  it is surprising. Say so in the output ("ignored sinks in <hub>").

- **H. Dual bookkeeping.** Two metadata files (code-repo forward + hub back) with
  no single source of truth and no reconcile command; they drift on any move.
  A `mage link --reconcile` / doctor pass that makes them agree would close it.

## Relations

- found_during [release sequence — 0.0.9](plan-release-sequence.md)
- see_also [Gotcha — connect does not ensure sink ignores](connect-doesnt-ensure-ignores.md)
- refines [roadmap](roadmap.md)
- governed_by [ADR-0017 — mage connect: the host hook adapter](../decisions/0017-mage-connect-host-hook-adapter.md)
