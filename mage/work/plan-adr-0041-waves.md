---
type: plan
tags:
  - mage/roadmap
created: "2026-07-28"
updated: 2026-07-31
last_reviewed: 2026-07-31
status: active
provenance:
  repo: mage-memory
  work: adr-0041-genre-recall-rungs
sources:
  - decisions/0041-genre-decides-the-recall-rung.md
  - decisions/0042-reach-tier-harness-grants.md
  - decisions/0035-decouple-harness-memory-from-notes.md
  - decisions/0039-context-footprint-measure-and-bound.md
  - notes/soak-targets.md
  - notes/npx-mage-runs-the-published-release.md
  - cc-session:ee0349da-df7e-4672-b8be-dc8cb25cb2c5
  - cc-session:fcc130b6-ad37-480e-b975-caf13add356c
  - cc-session:cc52271f-c247-4662-ac8c-94699ee8bb4d
keywords:
  - wave-plan
  - genre
  - recall-rung
  - release-gated
  - soak-evidence
  - ratification
  - wave-c
  - connect-external
  - baseline
modified: 2026-07-28T10:00:59.884Z
---

# ADR-0041 wave plan — A, B, C, and the ratification gate

> **Why this note exists.** The three-wave plan lived only in a session log until
> 2026-07-28, which made Wave C effectively invisible — the ADR names waves but
> never enumerates them. This is the durable record of what each wave is, why the
> order is load-bearing, and what evidence ratifies the ADR.

## The shape: three waves gated by releases into soak

**Not parallel tracks.** Each wave changes what the next one migrates, so the
sequencing *is* the point. Within a wave: parallel worktrees and delegation.
Between waves: a release and soak evidence.

```text
Wave 0: side-fixes + ADR drafts     (order-independent)
Wave 1: A — curation + ladder       → release → wire into soaks → observe
Wave 2: B — genre first-class       → migration → release → migrate soaks → observe
Wave 3: C — connect/external layers (needs B's fallback rooms to exist)
```

**Why each gate is real:**

- **B after A** — B's migration stamps genre on every existing note. Running it
  before A fixed `CONVENTIONS.md` §6 and drained the PM notes into `work/` means
  stamping notes that are about to move.
- **C after B** — C's fallback path *is* B's rooms. C cannot be tested until B ships.
- **Release, not merge** — for a *real external* user, a merged-but-unreleased
  wave is invisible ([[npx-mage-runs-the-published-release]]). So every wave ends
  in a release.

> **This premise does not hold for the home soaks — verified 2026-07-28.** The
> global `mage` on this machine is an `npm link` to the working tree, so it
> resolves to `mage-memory/dist/cli.js`, and every soak hook invokes bare `mage`
> (never `npx`). The soaks therefore track the working-tree build continuously and
> a release changes nothing for them. What actually makes a wave visible in a soak
> is **running `mage index` there** — no hook regenerates `INDEX.md`/`MEMORY.md`,
> so those files sit at whatever build last wrote them. Treat release-gating as
> correct for users and *inert* for these soaks.

## Wave 0 — parallel, independent

| Work | State |
|---|---|
| Plugin packaging allowlist (kills the 556MB plugin cache) | **not built** — filed as [#96](https://github.com/Sumit1993/mage-memory/issues/96) |
| `noteSizeCap`: wire or delete | **done** — wired in #94; `src/doctor/genre-tells.ts` is its first importer |
| ADR-B draft | **done** — became [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md) |
| ADR-C draft | **done 2026-07-31** — became [ADR-0044](../decisions/0044-setup-is-a-conversation-over-one-address.md) (PR #118) |

## Wave A — curation + the better-home ladder

`CONVENTIONS.md` teaches the ladder; doctor gains read-only genre-tell
annotations; the home KB is curated by hand.

- #93 — CONVENTIONS teaches the better-home ladder
- #94 — read-only genre-tell annotations; `noteSizeCap` gains its first importer
- #95 — home-KB genre curation

**Released in 0.0.15 (#97)** and wired into both soaks.

## Wave B — genre first-class

Genre becomes the thing recall filters on. `INDEX.md`/`MEMORY.md` carry
memory-genre lines only, plus a single governance line pointing at `decisions/`;
wing skills grow a Governing-decisions section.

- #98 — INDEX/MEMORY carry memory-genre lines only + governance line
- #99 — wing skills list governing decisions

Merged after a 14-agent extreme review (9 confirmed findings, 0 refuted, 2 real
blockers fixed and re-verified). **Released in 0.0.16
([#100](https://github.com/Sumit1993/mage-memory/pull/100), 2026-07-28)** after an
overnight window that was intended to be A-only. It was A-only *in effect* — the
linked `dist/` had carried Wave B since 07-27 11:20Z, but because no hook re-runs
`mage index`, sessions kept reading the pre-B recall files. Accidental, not
designed; see the premise note above.

Soak curation PRs, applied row-for-row against approved manifests:
`prismalens-docs-hub#15` and `sreforge-memory#6`.

## Wave C — connect / external layers

**Grilled 2026-07-31; ADR drafted.** Became
[ADR-0044](../decisions/0044-setup-is-a-conversation-over-one-address.md) (open as PR #118),
closing [#104](https://github.com/Sumit1993/mage-memory/issues/104).

Scope as designed: the grilled **config format + question flow** for
`connect`/external layers — the one part of ADR-0041 that is genuinely
taste-critical because users touch it directly, which is why the grill was queued
for a fresh session rather than the tail of the 2026-07-27 wave day.

**C shrank before it was drafted.** Two ADRs landed in the interval and each took
a bite: [ADR-0042](../decisions/0042-reach-tier-harness-grants.md) took the grant
question, [ADR-0043](../decisions/0043-hub-addressed-by-remote-located-by-derivation.md)
took addressing and location. What was left in the middle is the part neither
touched — **the conversation a human has with the tool**. So ADR-C is a
human-surface design doc sitting on top of two settled mechanisms, not a third
mechanism.

What it decided, in one line each:

| | Decision |
|---|---|
| §2–3 | Local-only hubs get a derived home, addressed `local://<name>` → reserved `_local/<name>` |
| §4 | `link` takes an **address**; a filesystem path becomes a deprecated shim that prints the canonical command |
| §5 | Inferred storage mode becomes **confirmed**, not merely announced |
| §6 | Three commands stay; the chaining becomes explicit and every step idempotent |

> **The grill found a live hole, verified empirically.** `link.ts:171` writes a
> *filesystem path* into `hub_repo` for a hub with no remote, which ADR-0043's
> canonicalizer rejects (`missing host:path separator`) and `deriveHubPathSafe`
> turns into `null`. It degrades to `hub_path` today, so nothing is broken — but
> 0043 calls `hub_path` "slated for removal", and on that day every local-only hub
> would become unaddressable. ADR-0044 §2–3 is what makes 0043 completable.

> [ADR-0042](../decisions/0042-reach-tier-harness-grants.md) (the reach tier) was
> **adjacent, not a substitute** — a separate grill on the same day, about harness
> grants rather than the config surface.

## The ratification gate

From [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md) — the ADR stays
`status: proposed` until this is satisfied. The Wave-B release *opens* the window;
the evidence below closes it. This gate governs **ADR-0041 only**.

**Yield:**
- After migration, `MEMORY.md` ≤ **~20%** of the host auto-memory budget, with
  **zero** document-genre lines.
- Soak recall quality (prismalens, sreforge) does not regress over the
  observation window.
- Groom's keep-rate calibration unblocks — the
  [[mature-kb-emits-no-capture-terminals]] hypothesis was that *documents were
  polluting the judgment pool*.

**KILL if:** memory-genre recall demonstrably misses governing constraints that
the forty always-on ADR lines used to catch (measured by soak steering
corrections), **or** the closed vocabulary forces real knowledge into
`unclassified` at any meaningful rate.

## Baseline — measured 2026-07-28, before 0.0.16

The soak files are still on the *pre-filter* contract — but **not because of the
installed version**. They were last written before Wave B merged and nothing has
regenerated them since (prismalens `MEMORY.md` 07-27 00:06Z, sreforge 02:06Z;
Wave B merged 09:08Z). The home KB shows the post-filter shape only because
`mage index` was actually re-run against it.

| KB / file | lines | bytes | `decisions/` links | governance line |
|---|--:|--:|--:|:--:|
| home `mage/MEMORY.md` (post-filter, after #101) | **59** (56 before #101; 117 before Wave B) | 5,666 | 1 | yes |
| prismalens `projects/prismalens-platform/MEMORY.md` | 115 | 13,035 | 25 | no |
| sreforge `MEMORY.md` | 136 | 11,629 | 29 | no |
| sreforge `projects/sreforge/MEMORY.md` | 115 | 12,921 | 27 | no |

Zero governance lines is the reliable tell for "generated before #98".

**Reading these numbers in a hub:** the top-level `INDEX.md` of a multi-wing hub
is a **wing roster** (~945 bytes — small by design); the note lines live in
`_index.<wing>.md`, and the heavy recall file is the per-project `MEMORY.md`. A
small top-level `INDEX.md` is *not* evidence the filter landed.

## Deferred out of the waves

| Item | Home |
|---|---|
| path-collision decision nudge | FT-22 |
| falsify-on-commit for doc-genre notes | FT-23 |
| per-work-style type maps via template wings | FT-24 |
| capture-side recurrence guard | FT-25 |
| central hub by derivation (`~/.mage/hubs/<slug>`) | FT-26 |
| plugin cache bloat | [#96](https://github.com/Sumit1993/mage-memory/issues/96) |
| worktree propagation research | [#103](https://github.com/Sumit1993/mage-memory/issues/103) |
| `HarnessAdapter` seam | [ADR-0036](../decisions/0036-defer-harness-adapter-seam.md) revisit trigger |

## Post-migration measurement — 2026-07-31

Both soak hubs were re-indexed 2026-07-29 18:17Z (mage 0.0.17-pre). Measured
against the baseline table above:

| KB / file | lines | bytes | `decisions/` links | governance line |
|---|--:|--:|--:|:--:|
| home `mage/MEMORY.md` | 39 | 6,076 | 1 | yes |
| prismalens `projects/prismalens-platform/MEMORY.md` | **62** (was 115) | **8,661** (was 13,035) | **1** (was 25) | yes |
| sreforge `MEMORY.md` | **49** (was 136) | **7,255** (was 11,629) | **1** (was 29) | yes |
| sreforge `projects/sreforge/MEMORY.md` | **45** (was 115) | **6,314** (was 12,921) | **1** (was 27) | yes |

The overflow line renders (`> 41 memory notes total (41 shown)`), so the roster
renderer from #109 is live. Note that in every soak unit K has **not yet bound** —
all entries are shown — so these numbers measure the genre filter, not the ranking.

## The gate, judged — 2026-07-31: **cannot flip**

Judging the gate first required repairing the evidence pipeline, which was broken
in two independent ways. Both are recorded as their own gotchas
([[soak-monitor-blind-spots]]); in short:

- **prismalens was dark.** The hub's `metadata.json` carried pre-move
  `code_repo_path` values (missing the `sources/` segment), so the monitor reported
  `code repo not present on disk` and skipped all three prismalens units. Fixed;
  the soak went from 2 live units to 4.
- **Keep-rate was computable but unwired.** ADR-0031 Phase 2 shipped
  (`src/grooming/reconcile.ts`; `.mage/metrics/keep-rate.json` in all five KBs) but
  the monitor never opened the file, so every digest printed *"Keep-rate not
  computed"*. The `baseline: true` flag on a `seen` entry turns out to **be** the
  capture-vs-adopt split the footer claimed was missing.

**Criterion 1 — met.** Zero document-genre lines, and the bounded roster shipped in
#109. (ADR-0041's amendment text still describes that renderer as an unlanded
0.0.17 deliverable; #109 merged before #108, so that sentence is stale and should
not be read as an open blocker.)

**Criterion 3 — satisfied literally, uninformative in practice.** Keep-rate now
computes: 50% overall (2 keep / 4 fresh captures; sreforge 67% at 2/3,
prismalens-platform 0% at 0/1, adopt cohort of 22 excluded). It has *unblocked* —
which is what the criterion asks — but n=4 calibrates nothing.

**Criterion 2 — unjudgeable.** prismalens was dark for the whole observation window
and only came back online 2026-07-31, so no time series exists for half the
evidence base. **The window effectively restarts 2026-07-31.**

**No KILL condition fired.** ADR-0041 stays `status: proposed`.

> The lesson worth carrying: the window was never running for half the evidence
> base, and nothing said so. A soak that silently drops a unit reports success and
> absence identically — which is why the digest now names live-unit count in its
> rollup.

## What is left, in order

1. ~~Merge #100~~ **done 2026-07-28** — 0.0.16 published to npm. This *starts* the
   observation window; it does not by itself ratify anything.
2. ~~Merge the soak curation PRs~~ **done 2026-07-29** (`prismalens-docs-hub#15`,
   `sreforge-memory#6`).
3. ~~Run `mage index` in each soak repo~~ **done 2026-07-29 18:17Z** — re-measured
   above.
4. **Let the restarted window run with all 4 units live**, then re-judge criteria 2
   and 3. Merging the `code_repo_path` fix
   ([`prismalens-kb#17`](https://github.com/prismalens/prismalens-kb/pull/17)) is a
   precondition — until it lands, prismalens goes dark again on the next machine.
5. Flip [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md) to
   `accepted` if **its** gate holds (the yield/KILL criteria above).
   [ADR-0042](../decisions/0042-reach-tier-harness-grants.md) is **not** covered by
   that gate — it is a separate decision with its own revisit trigger, and is
   evaluated on its own terms.
6. Ratify and implement [ADR-0044](../decisions/0044-setup-is-a-conversation-over-one-address.md)
   (drafted in PR #118, closing [#104](https://github.com/Sumit1993/mage-memory/issues/104)).
   Implementation is sequenced after
   [#121](https://github.com/Sumit1993/mage-memory/pull/121) lands; `hub_path` cannot
   be removed until the migration specified in
   [#123](https://github.com/Sumit1993/mage-memory/issues/123) ships.

## Relations

- Governed by [ADR-0041](../decisions/0041-genre-decides-the-recall-rung.md),
  amending [ADR-0035](../decisions/0035-decouple-harness-memory-from-notes.md)
- Companion to [ADR-0039](../decisions/0039-context-footprint-measure-and-bound.md)
  and [plan-footprint-soak-findings](plan-footprint-soak-findings.md)
- Soak targets: [[soak-targets]]
- Release ordering: [plan-release-sequence](plan-release-sequence.md)
