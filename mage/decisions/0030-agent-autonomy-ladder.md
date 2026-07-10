---
type: decision
tags:
  - mage/decisions
created: "2026-06-21"
updated: 2026-07-10
last_reviewed: 2026-07-10
status: active
provenance:
  repo: mage-memory
  work: autonomy-ladder
sources:
  - src/commands/nudge.ts
  - src/grooming/thresholds.ts
  - src/paths.ts
  - skills/groom/SKILL.md
  - mage/decisions/0029-digest-to-agent-capture.md
  - mage/decisions/0024-organic-grooming-loop.md
  - mage/decisions/0016-context-match-confidence-ladder-applier.md
  - mage/decisions/0013-procedure-skills-self-grooming-loop.md
  - mage/decisions/0009-no-runtime-automation-rides-host-hooks.md
  - mage/decisions/0001-memory-first-product-supersedes-specshub.md
  - cc-session:38816fdd-1c3d-4bad-b3d0-e1decb93b50c
---

# 0030 — Opt-in agent autonomy ladder for the grooming loop (Operator / Approver / Overseer)

> Status: extends the [ADR-0029](0029-digest-to-agent-capture.md) digest→agent loop with an **opt-in,
> per-KB autonomy dial**. Realizes the "loosening over time" [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)
> explicitly anticipated ("starts human-confirm; graduates to auto-promote — the homunculus ladder"),
> bounded by [ADR-0013](0013-procedure-skills-self-grooming-loop.md)'s floor ("the human confirms — and
> the confirm *is* the git commit"), and mirrors [ADR-0016](0016-context-match-confidence-ladder-applier.md)'s
> existing applier rungs. This is the **standard HITL→HOTL oversight spectrum**, not a bespoke invention.

## Context

ADR-0029 made capture work: the boundary nudge emits a read-only digest, the host agent mines it, and
**agent-initiated `mage stage`** is the only path into `.mage/staging/`. But that fixed only the
*digest → staged* rung. The rungs above it — *staged → written note → `index` → graduate* — still wait
on a human running `mage:groom`, **and the maintainer forgets.** This is the observed, mechanical root
cause of every soak KB stalling at raw `.mage/learnings/` and never producing notes: capture is
automatic (hooks), but promotion was gated on a human action that never reliably happened, while the
boundary nudge only ever counted the *staging* tier (`readStagedDrafts().length`) and was **blind to
the recurrence/graduation backlog accumulating in `.learnings/`**. Nothing tapped the maintainer on the
shoulder, so nothing climbed.

The realization: **anything a human does at `mage:groom`, a capable host agent can do** — judge a
staged draft, distill a chapter, weigh a recurrence, write the note, re-index. The *only* irreducible
human step is the **commit** (ADR-0013: the confirm IS the git commit; mage never commits). So the fix
is not "nudge the human harder" — it is a **dial for how much of the ladder the agent drains
autonomously**, with the nudge as the low-autonomy surface and an activity-report at higher levels.

This is a well-established pattern, adopted rather than invented: the **HITL → HOTL → HOOTL** oversight
spectrum (Human-*In* / *On* / *Out-of*-the-Loop); the user-role spectrum of Feng et al. 2025 (Knight
First Amendment Institute) — *operator → collaborator → consultant → approver → observer*; and the
direct tooling precedent of **Claude Code's own permission modes** (`default` → `acceptEdits` → `auto`
→ `bypass`). mage's ladder is the knowledge-capture analog.

## Decision

1. **Three opt-in autonomy levels, named for the human's role** (the standard role vocabulary):

   | Level | Human role · oversight | Agent does at a boundary | Human does |
   |---|---|---|---|
   | **Operator** *(default)* | operator · **HITL** | stages from the digest (ADR-0029) | runs `mage:groom`, judges each, writes, **commits** |
   | **Approver** | approver · **HITL** (batch) | grooms + writes the clearly-durable notes into the working tree (Gate-2 redaction runs); borderline → staged; runs `mage index` | reviews the diff, **commits** |
   | **Overseer** | observer · **HOTL** | as Approver + disposes the borderline tier, merges into existing notes, and **graduates** eligible notes (≥ M) | audits `git log`, reverts if wrong, **commits** |

   Default = **Operator** because the dial is opt-*in*: a fresh `mage connect` user gets no surprise
   autonomous writes (but does get the new backlog signal, §2 — a strict improvement on today). You opt
   your own repos / soaks up to Approver/Overseer, which is exactly where "I forgot to groom" stops
   mattering: grooming rides the agent's normal session, gated only by the commit you already make.

2. **The backlog signal = a deterministic three-part capped tally** (the nudge's `pending` measure,
   replacing the staged-only count). Computed cheaply at the boundary:
   - **staged drafts** — `readStagedDrafts().length` (a file count);
   - **unmined closed chapters** — terminator-closed chapters in `.learnings/` past the distill
     watermark cursor, **capped at "9+"** so the scan is bounded;
   - **graduation-eligible signatures** — read from the **persisted promote tally** (it already
     survives the raw-event purge, ADR-0019) — **no re-fold**.
   Rendered as one line: `mage: 3 staged · 6 chapters unmined · 1 note ready to graduate → mage:groom`.
   At Operator it is a human reminder; at Approver/Overseer it doubles as the agent's **work-list**.

3. **The irreducible floor, at EVERY level — this is what makes high autonomy safe:**
   - **mage never commits → the git commit is the human's confirm** (ADR-0013). Autonomous writes land
     in the working tree *uncommitted*; reviewing the diff is the review, the commit is the "yes".
   - **Gate-2 redaction always runs** before any tracked write (ADR-0014), regardless of level.
   - **mage's engine never calls a model** (ADR-0009): the CLI only string-templates a mandate by
     reading a config field; the host agent does all judgment and writing; mage spawns no process.
   - **Consequence: mage structurally cannot reach HOOTL (out-of-the-loop).** Even Overseer is
     human-*on*-the-loop, because the commit gate is unconditional. This is the *technical* enforcement
     of the autonomy boundary the governance literature (CSA, Jan 2026) flags as usually absent —
     mage gets it for free from files-as-truth.

4. **The level lives in `metadata.json → grooming.autonomy`**, sibling to `sensitivity`
   (`"operator" | "approver" | "overseer"`), read via a new `readAutonomy()` mirroring
   `readSensitivity()` — fail-open to `operator`, junk-narrowed. At a hub, autonomy is a **single
   hub-ROOT setting** (`grooming.autonomy` in the hub's own `metadata.json`): a fan-out groom runs the
   whole hub at that one level. Per-project override is **future work** (the field could later be read
   per-project, but v1 does not). **No environment variable** — mage has zero env-config precedent
   and config is files-as-truth (ADR-0001); an untracked override would break it. Set by hand-edit or a
   small **visible** `mage autonomy [level]` get/set command (it edits the tracked field).

5. **The boundary nudge is the carrier.** It reads the level and templates the ADR-0029
   `additionalContext` into one of three mandates (Operator = digest + backlog reminder; Approver =
   "you may groom and write durable notes into the working tree now, uncommitted, Gate-2 enforced";
   Overseer = Approver + dispose-borderline + graduate). Firing + throttle:
   - fires on `compact` **+ `startup` + `resume`** (not `clear`), **mtime-gated** so a no-new-scratch
     startup stays ~instant (recompute the tally only when `.learnings/`/watermark changed);
   - the **fresh-chapter digest is never throttled** (new content each compact); the **backlog reminder
     is throttled** to once per window across all sources — window is a **user-set value, default 4h**
     (`grooming.nudgeThrottleHours`); *(**amended 2026-07-10** — the digest is no longer compact-only;
     it also surfaces at `startup`/`resume` for the last-closed chapter, offer-first, de-duped by a
     once-per-chapter watermark rather than the time throttle. See the Amendment below.)*
   - **no escalation tier** (the growing capped count is the escalation) and **no re-nudge on growth**
     (in a continuously-compacted chat the backlog grows every compact; re-firing on growth would nag).

6. **`mage:groom` gains an autonomous mode** (Approver+). The skill's per-note "write only after a
   yes" is not violated — the **"yes" relocates from a per-note prompt to the batch `git commit`**,
   which is precisely ADR-0013's invariant. In autonomous mode the per-note prompt is waived; Gate-2
   and uncommitted-writes hold. Graduation (Overseer) routes through the same `mage:graduate` flow,
   recurrence-gated (≥ M) and commit-gated like everything else.

7. **Wiring + documentation are in scope of this decision, not an afterthought:**
   - `mage init` prints a one-line autonomy hint (default Operator + how to raise + docs link); writes
     no extra field (absent = Operator).
   - the generated docs data (hook-purpose table) describes the autonomy-scaled nudge;
   - a docs-site page documents the three levels with **worked examples, a diagram, and a per-level
     risk + expected-behavior table** so a user can see exactly what each level does and what they own.

## Amendment (2026-07-10) — the digest surfaces at session start, not only at compact

**Problem.** §5 tied the fresh-chapter digest to `compact` ("new content each compact"). But a chapter
is closed by *either* a `compact` *or* a `session_end` (ADR-0029; `isTerminator`), and many users rarely
compact — short sessions, `/clear`, or an early quit close a chapter via `session_end` and never trigger
a compact. For them the digest — the "here is a specific thing worth saving" content — **never fires**.
They saw only the throttled, model-only backlog *count*, which is near-invisible to the human. The
session-start firing existed (`startup`/`resume` already ran the nudge) but carried the backlog line
alone; the digest was skipped.

**Decision (extends §5, does not reverse it):**

1. **The digest computes on `startup`/`resume`, not only `compact`.** On session entry mage builds the
   same earned-signal digest for the **most-recent closed chapter** of the previous session (the material
   already exists — `session_end` closed it). The compact path is unchanged.
2. **Shown once per chapter, not on a timer.** A new `lastChapterTs` watermark (in `nudge-throttle.json`)
   records the terminator timestamp of the last chapter whose digest surfaced. **Both** the compact and
   the startup paths stamp it, so the same chapter is never surfaced twice across the two paths. An
   already-shown or empty/no-signal chapter surfaces nothing. The backlog *count* line keeps its own
   separate 4h throttle, untouched.
   - **One shared, fingerprint-gated read.** The backlog tally already read every session stream behind
     the scratch-fingerprint cache; the digest needs the same events, so the two now share ONE
     `readSessionStreams` call (`computeBacklog` split into a `-FromStreams` variant). A no-new-scratch
     startup is a cache hit → it reads nothing and surfaces no digest (there is no new chapter); `compact`
     always re-reads (the fresh chapter must show — which also refreshes a would-be-stale tally). This
     keeps §5's "~instant startup" promise literally true for the digest, at zero extra reads.
   - **The fingerprint must track per-file changes, not just the dir.** A `session_end`/`compact` APPEND
     that closes a chapter bumps only the FILE (not the `.learnings/` dir) mtime, so a dir-only
     fingerprint would stay a cache HIT and **skip the just-closed chapter's digest** — silently losing a
     keeper for exactly the non-compacting user this amendment serves. So `scratchFingerprint` folds in the
     **size + mtime of each session stream file** (size changes deterministically on any append, so
     detection never depends on mtime granularity). This also tightens the pre-existing backlog tally,
     which shared the same blind spot.
3. **Two channels, charter-respecting.** mage prints **one deterministic, unranked teaser line** to the
   user-visible `systemMessage` — plain-language category counts only (`mage · recent work: 3 errors · 2
   commands · 1 correction — worth saving any? → mage:learn`), never a picked "keeper", so mage stays a
   *narrower*, not a ranker (ADR-0004, ADR-0029 §5). The phrasing is source-neutral ("recent work" is
   honest for a compacted chapter, a prior session, or a first-run stale one), and the actionable
   `mage:learn` lives in this GUARANTEED channel so the safety-net never depends on the agent acting. The
   full digest still goes to the model-only `additionalContext`; the **agent** names the specific keeper.
4. **Offer-first on entry, at every autonomy level.** Unlike the compact path, the startup digest is
   **always offer-first** — even at Overseer it names + offers and never auto-grooms on session entry
   (opening the CLI is the user's moment). Autonomous grooming stays at compact and natural pauses.

This closes the "non-compacting user never sees a keeper" gap while preserving the model-free engine
(ADR-0009), the no-ranking charter (ADR-0004/0029), and the commit-is-confirm floor (ADR-0013).

## Considered options

- **Discrete ordered ladder (chosen)** vs. independent toggles (auto-write? auto-graduate? …): one knob
  is easier to set and reason about; the role names carry the meaning. Toggles are a later refinement
  if a user wants, e.g., autonomous notes but never autonomous graduation.
- **Default Operator (chosen)** vs. a higher default: the lived problem argues for more automation, but
  the user asked for *opt-in*; a conservative default + the new backlog signal is a strict improvement
  with zero surprise, and the user opts their own repos up.
- **Graduation always-explicit** vs. **at Overseer (chosen)**: the commit floor + the ≥M recurrence
  gate make autonomous graduation neither arbitrary nor durable-until-committed, so the convenience is
  safe at the top level.
- **Env override** — rejected (no env-config precedent; breaks files-as-truth, ADR-0001).
- **Bespoke L0/L1/L2 naming** — rejected in favor of the standard role vocabulary (discoverable,
  grounded in prior art, aligns with how the space already talks).

## Consequences

- The "maintainer forgets → stalls at `.learnings/`" failure mode **disappears at Approver+**: grooming
  rides the agent's normal session and is gated only by the commit the human already makes.
- mage gains a principled, standard-aligned autonomy story, and the commit-is-confirm floor is **free
  technical enforcement** of an HOTL ceiling (no HOOTL).
- New risk: autonomous grooming could write **low-value notes** — the exact noise ADR-0027/0028/0029
  fought. Mitigations: Gate-2 always runs; per-section caps; the value-bar from the gate methodology is
  baked into the groom prompt; `git revert` is trivial; and the **live reject-ledger** (kept-vs-reverted
  notes) is the precision measure that decides whether higher defaults are ever warranted.
- The nudge does more work at `startup`/`resume` than before (the capped scan), bounded by the mtime
  gate; if a KB's `.learnings/` grows pathologically the scan caps at "9+" and never blocks the session.
- A new `mage autonomy` command + a `grooming.autonomy` / `grooming.nudgeThrottleHours` metadata field
  + `readAutonomy()` + the nudge-templating + the groom autonomous-mode + the init hint + the docs page
  are the implementation surface; v1 touches no recurrence/tally internals.
- **Implemented:** §6 (the `mage:groom` autonomous mode — per-note prompt waived at Approver/Overseer,
  Gate-2 + uncommitted-writes held) and §7's **init hint** (the one-line autonomy line at `mage init`)
  are now built; the docs page (§7) ships at `docs/src/content/docs/loop/autonomy.mdx`.
- **Amendment surface (2026-07-10):** a `lastChapterTs` field in `nudge-throttle.json` (schema bump,
  fail-open merge) for the once-per-chapter show-watermark; a single fingerprint-gated `scanBoundary` in
  `nudge.ts` that reads the streams once and feeds both the digest and the tally (`computeBacklog` split
  to a `computeBacklogFromStreams` variant); and a deterministic teaser line on `systemMessage`. No
  recurrence internals change; the compact path, the backlog count line, and its 4h throttle are
  unchanged — and the shared read fixes a latent staleness where a compact's appended chapter could miss
  the cached tally.

## Relations

- **extends** [ADR-0029](0029-digest-to-agent-capture.md) — same digest→agent loop; adds the dial that
  governs how far past *staged* the agent drains autonomously, and replaces the staged-only nudge count
  with the capped backlog tally.
- **amends** [ADR-0024](0024-organic-grooming-loop.md) — the organic loop (inline-primary + boundary
  nudge); the nudge now scales by an autonomy level.
- **realizes** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) — the explicitly-anticipated
  "loosening over time / homunculus ladder," made opt-in and user-controlled; the engine stays
  model-free (it only templates a mandate; the host agent reasons).
- **bounded_by** [ADR-0013](0013-procedure-skills-self-grooming-loop.md) — the commit IS the human's
  confirm; this is the floor that caps the ladder at HOTL.
- **rides** [ADR-0014](0014-two-gate-redaction.md) — Gate-2 redaction before any autonomous tracked write.
- **mirrors** [ADR-0016](0016-context-match-confidence-ladder-applier.md) — the existing propose-only →
  higher-rung applier ladder; same shape, new domain.
- **constrained_by** [ADR-0001](0001-memory-first-product-supersedes-specshub.md) — config is files-as-truth, so the dial
  is a tracked metadata field, never an env var.
