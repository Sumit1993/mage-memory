---
type: plan
tags: [mage/cli, mage/coherence]
created: "2026-06-10"
updated: "2026-06-13"
last_reviewed: "2026-06-13"
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

## Grilled — decisions (2026-06-13)

A grill walked the decision tree top-down. These supersede/­correct the
Consolidations below where they differ.

1. **Hub model (settles friction F + the vocabulary core).** A **hub is one
   repo** that is *both* a KB (its own top-level `notes/`/`decisions/`) *and* a
   registry of project-KBs under `projects/<name>/`. Two metadata modes
   (`in-repo`, `external`); three *shapes*: in-repo, hybrid (`in-repo` +
   `hub_refs[]`), external (notes live in the hub at `projects/<name>/`).
   - **Capture binds to the agent session's cwd** → `resolveDocsRoot` walks *up*
     to exactly one KB (in-repo `mage/`, the hub project folder, or the hub's own
     notes). Never split, never guessed. Single-root harnesses make this a
     feature: one session ⇒ one KB, deterministically.
   - **Aggregation ≠ capture.** `groom`/`promote` at a hub = the hub's own
     `.learnings` **+ fan out to every registered project** (`--root-only` to
     scope down). This is the soak-digest workaround promoted into the tool.
   - **Bare parent dir** (sits *above* N connected repos, itself neither a repo
     nor a hub) resolves to `null` and **silently drops** today (friction B).
     0.0.10: keep `null` (no down-scan magic — the upward walk stays predictable)
     but make `doctor`/`status` say so **loudly**. A "workspace" (VS Code
     multi-root sense) is **not** a 4th KB flavor — its cross-cutting knowledge
     *is* the hub's own notes; to capture at a parent you `mage link` it
     explicitly (a 0.1.0 escape hatch).

2. **Command tiers — implement the doc that already exists.** CONVENTIONS §10
   already declares `observe`/`distill`/`promote`/`redact`/`ingest`/`verify`/
   `index` as plumbing "users never type" — but `cli.ts` enforces nothing (every
   command is flat in `--help`). 0.0.10: set `hidden:true` on the plumbing tier
   **and reconcile the canonical human-verb list** (§10 vs `context.md` §119
   disagree on `index`). `dream`/`skills` are **dual-tier** (visible human face +
   unadvertised plumbing flags) → stay visible.

3. **Engine vs skill — there is no `mage groom` command.** mage has **no model**
   (ADR-0009); the CLI is a deterministic **engine** (counts, reports, moves
   watermarks — never judges). Grooming is **judgment**, borrowed from the host
   agent via a **skill**. So the engines stay `distill`/`promote` (hidden
   plumbing); the human-facing grooming is the **`mage:groom` skill**. A `mage
   groom` *command* would be a lie (a command can't judge). When a user runs a
   hidden engine directly, it still prints its read-only report **plus a footer**
   pointing at the skill (decision (i)).

4. **Skills merge — the no-pattern-loss form.** `mage:groom` (skill) = **distill
   + promote** as two phases (first-sight gate → recurrence gate); they already
   share source (`.learnings`), the `mage:learn` capture pipeline, and `--seen`
   discipline, so zero pattern loss. **`graduate` stays its own skill** —
   notes→skills is a different, higher-consequence transform (mints auto-loaded
   skills; deserves its own confirm; paired with `optimize`/demote). Net:
   distill+promote+graduate → **groom + graduate**. *(Recorded per the "no major
   pattern loss" guardrail; revisit if full 3→1 is wanted.)*

5. **Setup: `init`/`link` auto-connect (default-on).** Today `init` makes an
   *inert* KB (no capture until a separate `connect`); `link` doesn't even ignore
   the sinks. 0.0.10: `init`/`link` auto-`connect` as a final step — a **visible
   confirm** in interactive mode ("wire capture hooks + the redact pre-commit
   hook?"), automatic under `--yes`, `--no-connect` to skip (portable / non-Claude
   KBs). `link` **announces the cross-repo write** ("ignored capture sinks in
   `<hub>`" — closes friction G). `init --hub` auto-connects the hub *and* says
   members are wired separately (`mage link` auto-connects each, or `connect
   --all-projects`), so a fresh hub isn't a false "done" (friction C).

6. **No global registry in 0.0.10 (files-are-truth holds).** A
   `~/.mage/metadata.json` treated as *authoritative* would be a **third** source
   of truth — non-portable, machine-global, a cache that can lie. Rejected.
   Capture/link stay the per-cwd upward walk. A machine-local, **verified-on-read,
   rebuildable `~/.mage/registry.json`** (discovery + system-wide `status --all` +
   moved-hub re-home hints; never on the hot path, never authoritative) is
   **scoped to a 0.1.0 ADR**, not built now. `doctor` detects a moved hub and
   instructs (`mage link <new>`); no auto-re-home in 0.0.10.

7. **`doctor --fix` = "repair drift, never connect-from-scratch."** Adds a third
   repair: **refresh a present-but-drifted capture hook block** (re-`upsertMageHooks`
   in the settings file the drift was found in — the detection already exists in
   `kb-checks.ts`). It does **not** wire a never-connected / `disconnect`'d repo
   (that's the user's on/off choice → nudge `connect`); a missing redact
   pre-commit hook on a connected repo is **detect+nudge**, not auto-install.
   **Free fix:** `doctor.ts` still hard-codes `REQUIRED_NODE_MAJOR = 18`, but #11
   raised `engines` to `>=20` → bump to 20. Schema drift folds in here too (Dec 9).

8. **Flat-vs-nested ADR — ratify, don't change (settled by Decision 1).** A hub
   keeps its **own top-level `notes/`** *and* flat `projects/<name>/` notes — NOT
   "everything under `projects/`". The ADR ratifies the current layout and
   reframes the "looks like duplication" worry as **scope-separation** (hub =
   cross-cutting, project = project-scoped). Residual cleanups: align `link.ts`
   vs `init --hub` member scaffolding; `dashboard`/`INDEX` **label** hub-own vs
   project notes so it stops *reading* as duplication.

9. **Vocabulary reconcile (full, internal) + mage's first metadata migration.**
   Canonical lexicon: **KB** = umbrella (every shape is one — fix README §156);
   **hub** = one meaning (a KB that federates project-KBs); **ban "vault"** as a
   product noun; three shapes **in-repo · hybrid · external** everywhere; **drop
   the dead `--external` flag** (it inverts `mode:external`). Reconcile the
   colliding enums: `mode` → `in-repo|hybrid|external` (hybrid first-class), hub
   `storage` → `hub-owned|repo-owned`, runtime `kind` → `repo|hub`. **Migration:**
   schema `mage.v1`→`mage.v2`; `readMetadata` becomes **lenient** (reads v1,
   normalizes in memory, **never throws** — replaces today's "delete & recreate"),
   the next write emits v2, `doctor --fix` / `mage migrate` rewrites eagerly.
   Touches **only `metadata.json`** (soak `.learnings`/notes untouched);
   forward-incompat (an old binary can't read v2) accepted, git-recoverable.

10. **SDD skills removed.** Delete all 7 (`specify/clarify/plan/tasks/implement/
    analyze/constitution`, ~1085 lines) + clean the **5 advertising sites**
    (`marketplace.json` ×2, `plugin.json`, `README` 90–91 & 399). The
    never-shipped `ATTRIBUTION.md` gap self-resolves (only the deleted skills
    reference it). Record completion as a short ADR (the prune ADR-0001/0002
    deferred). Kept skills: **learn · groom · graduate · optimize · guide**.

11. **Small friction closers (all 0.0.10).** **(B+C)** Hub-aware `doctor`/`status`
    — per-project liveness rollup ("N projects · M connected · K ever captured ·
    last event <when>"); **`mage connect --all-projects`** bulk-wires members (an
    *explicit* on-switch → lives on `connect`, not `doctor --fix`). **(E)** `link`
    name guardrail — warn + suggest `--project <registered>` when `basename(repo)`
    mismatches the hub registry. **(A)** Schema-field audit — one sweep for other
    declared-but-unenforced fields (the `mode:external`-with-no-resolver trap that
    started this).

### Friction inventory → disposition

| | Friction | Lands as |
|---|---|---|
| **A** | declared-but-unimplemented mode | fixed 0.0.9 + audit (Dec 11) |
| **B** | silent capture (no liveness) | per-KB DISCONNECTED (0.0.9) + hub rollup (Dec 11); system-wide → registry (0.1.0, Dec 6) |
| **C** | connect-in-hub false "done" | hub-aware doctor + `connect --all-projects` (Dec 11) + `init --hub` messaging (Dec 5) |
| **D** | stale link paths after a move | `doctor --fix` back-ref (0.0.9); moved-hub detect+instruct (Dec 6/7); reconcile (0.1.0) |
| **E** | project-name divergence | `link` guardrail (Dec 11) |
| **F** | hub-root-vs-projects ambiguity | **resolved** (Dec 1: a hub is a KB that aggregates its projects) |
| **G** | cross-repo side effects unannounced | announced by `link`/`connect` (Dec 5) |
| **H** | dual bookkeeping, no reconcile | doctor heals back-ref (0.0.9); full reconcile + registry (0.1.0, Dec 6) |

### Suggested build order (dependencies)

1. **Vocabulary + migration (Dec 9)** — foundational; `mode`/`storage`/`kind` +
   lenient `readMetadata` underlie everything else. Land first.
2. **Tiers + engine/skill (Dec 2–3)** and **SDD removal (Dec 10)** — independent,
   parallelizable; cheap.
3. **Skills merge → `mage:groom` (Dec 4)** — after tiers.
4. **Setup auto-connect (Dec 5)** + **`doctor --fix` repair-drift (Dec 7)** +
   **hub-aware doctor / `connect --all-projects` / `link` guardrail (Dec 11)** —
   the connection cluster; after migration (they read the reconciled metadata).
5. **ADRs:** flat-vs-nested (Dec 8), vocabulary (Dec 9), SDD-prune (Dec 10),
   + the deferred-to-0.1.0 `registry.json` ADR (Dec 6).

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

3. **Collapse grooming → the `mage:groom` skill (NOT a command).** Corrected in
   the 2026-06-13 grill (see Decisions 3–4): `distill` + `promote` are one intake
   pipeline (events → note candidates); `dream` is **not** in it — it lints the
   notes graph, not the event stream, so it stays standalone (a 0.1.0 candidate to
   fold into `doctor`'s health umbrella). There is **no `mage groom` command** (a
   command is a deterministic engine; grooming is judgment — ADR-0009). The
   human-facing grooming is the **`mage:groom` skill** = distill + promote as two
   phases (first-sight, then recurrence). **`graduate` stays its own skill**
   (notes→skills, higher-consequence, paired with `optimize`/demote). Net skills:
   distill+promote+graduate → groom+graduate.

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
