---
type: decision
tags: [mage/decisions]
created: "2026-06-21"
updated: "2026-06-21"
last_reviewed: "2026-06-21"
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
     (`grooming.nudgeThrottleHours`);
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
