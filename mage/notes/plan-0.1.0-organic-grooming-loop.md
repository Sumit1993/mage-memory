---
type: plan
tags: [mage/grooming, mage/0.1.0]
created: "2026-06-14"
last_reviewed: "2026-06-14"
status: draft
provenance:
  repo: mage-memory
  work: organic-grooming-loop
sources:
  - src/grooming/signature.ts
  - src/grooming/promote.ts
  - src/grooming/tally.ts
  - src/grooming/thresholds.ts
  - src/claude-settings.ts
  - src/dashboard/nudges.ts
  - skills/groom/SKILL.md
  - mage/decisions/0013-procedure-skills-self-grooming-loop.md
  - mage/decisions/0019-mage-promote-self-grooming.md
keywords: [grooming, graduation, organic, recurrence, workflow, lens, procedure, playbook, nudge, surfacing]
---

# Organic grooming loop — closing the procedure path

**Status: DRAFT — design to grill before any build.** Once locked, the concrete
changes become an ADR (next free number 0024) amending [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md)
and [ADR-0019](../decisions/0019-mage-promote-self-grooming.md).

## Why (the evidenced problem)

After 0.0.11 (chapter counting + de-noise + project wings, M back to 5), the live soak
STILL produces **zero graduations** — and M was never the cause. Investigation of the
rebuilt `mage-memory` tally (2026-06-14):

- **Gate 1 — what recurs is ACTIVITY, not LESSONS.** All **40/40** signatures at ≥K(3)
  are the `workflow` lens (a tool repeated on the same files). Exactly **1 of 40** carries
  any `correction`/`failure` signal. The top buckets are routine work —
  `mage::plan,release,sequence` (5), `mage::rollup` (4), `mage::types` (4),
  `mage::connect,test` (4). Nobody drafts a note from "I keep editing the plan." The actual
  lessons (corrections/failures) barely recur — you learn a gotcha once and move on — so
  they never climb toward M.
- **Gate 2 — the recurring signatures that ARE covered are covered by NON-procedural notes.**
  The manifest reports `covered: 20` but `graduate: 0` even at M=5. Of the 12 existing
  notes (5 plan, 3 reference, 3 gotcha, 1 principle), only the 3 gotchas are procedural.
  Graduation fires ONLY for procedural notes (you auto-load a procedure, not a fact or a
  plan — ADR-0019 §5). Concretely `mage::plan,release,sequence` recurs **5 (≥M)** and IS
  covered — but by `plan-release-sequence.md` (type **plan**) → blocked at the procedural
  gate. That single fact is the entire `covered=20 / graduate=0` gap.
- **Gate 3 — the procedural notes that exist don't cover anything that recurs.** The 3
  gotchas are real procedures, but gotchas are one-shot; the work they describe doesn't
  recur as workflow. So the procedural notes and the recurring signatures are **disjoint
  sets**.

**Root cause:** the recurrence tally measures repeated *activity*, but graduation requires a
repeated *procedure captured as a procedural note*. Those two ends never meet. Grooming has
run plenty (14 distill / 10 groom / 8 graduate skill-loads) and notes exist — but none came
from the recurring scratch signatures, because the recurring signatures aren't note-worthy
as-is and aren't on the procedural track.

A secondary gap: **no organic surfacing.** `computeNudges` (`src/dashboard/nudges.ts`) feeds
only the gitignored `dashboard.html`; no hook puts candidates in front of you at a session
boundary (`MAGE_HOOKS` runs only `mage observe` + `mage skills --metrics`). So even the
uncovered workflow candidates never reach you at the reflection moment. But surfacing alone
wouldn't help — what would surface is activity not worth a procedural note.

> **Caveat — this is ONE phase's data (raised 2026-06-14).** The 40/40-workflow skew reflects
> active *early-greenfield* development (planning + MVP builds of sreforge/prismalens, solo,
> one compacted chat). A different usage pattern shifts the lens mix — and possibly the whole
> story. See **Validity & over-fitting risk** below before trusting any tuning.

## Reframe — two graduation paths, only one belongs to recurrence

mage conflates two paths through the ladder:

1. **Lesson path** — `correction`/`failure` → first-sight insight ([mage distill](../decisions/0018-mage-distill-observed-scratch-reader.md))
   → note (gotcha/principle). Lessons are usually one-shot; their home is **distill
   (first-sight)**, NOT recurrence. A lesson rarely needs to graduate to a *skill* — it is
   already auto-loaded as a note.
2. **Procedure path** — recurring `workflow` → playbook note → **Procedure skill**. THIS is
   the path recurrence is for, and it is the one that is incomplete: the workflow signal is
   too thin to draft a procedure from, the candidate is never surfaced, and when a note is
   drafted it isn't typed as procedural.

The three changes below complete the **procedure path**. (The lesson path is largely fine;
if anything, corrections/failures deserve a LOWER bar — see Open Questions.)

## Validity & over-fitting risk (raised 2026-06-14)

**The diagnosis above was drawn from ONE usage phase.** The soak is dominated by a single
pattern: active *early-greenfield* development — planning + MVP/early-version builds of
sreforge and prismalens, solo, in one continuously-compacted chat. That phase is
workflow-heavy BY NATURE (you touch many new files in sequences; you issue few "corrections"
because you let the agent run), which is exactly why 40/40 ≥K signatures are workflow and
lessons barely recur. **Other patterns tell a different story:**

- *Maintenance / debugging / incident response* → `failure` recurs (same bug class, same
  flaky test) and `correction` recurs (the same mistake re-steered). The **lesson path**
  carries real recurrence — and those signals ARE worth noting.
- *Code review / multi-developer* → more corrections, more diverse signatures, less
  single-author file-touch repetition.
- *Mature codebase* → recurring procedures are genuine (deploy runbook, release cut, triage)
  — the **procedure path** lights up with material that really is a procedure.

**The inversion this forces:** "zero graduations in early planning" may be the **correct**
output, not a bug. There may simply be little worth graduating yet. Tuning the loop to MAKE
this phase's data graduate would *manufacture noise* — promoting "I keep editing the plan"
into a skill nobody wants. The honest reading of the soak is *"not yet,"* not *"broken."*

**Design consequences (these CHANGE the plan, not just annotate it):**

1. **Build for BOTH paths, lens-balanced — do NOT optimize for workflow.** Let whichever path
   has genuine signal in the current phase light up: procedures in a build/maintenance phase,
   lessons in a debugging phase, *nothing* in a thin planning phase. The two-path design is
   the hedge against over-fitting — keep it central.
2. **DEFER per-lens threshold/bar tuning until a SECOND data pattern exists.** Any specific
   "workflow needs K=N, correction needs K=M" numbers tuned only on this phase will over-fit.
   Validate on a *constructed multi-phase scenario* (a debugging trace, a maintenance trace),
   not just the live early-greenfield soak.
3. **Re-examine the 0.1.0 GATE — it may be the real over-fit.** The soak rule ("a real
   note→skill graduation in any unit cuts 0.1.0") pressures the design to manufacture a
   graduation from whatever phase the user is in. Better: gate 0.1.0 on a **correct, tested
   loop** — graduation demonstrably fires on a constructed procedure scenario AND correctly
   stays quiet on thin/planning work — not on an *observed* organic graduation that may
   legitimately not occur for months.

**Phase-robust** pieces: the two-path reframe, **A** (enrich workflow→procedure), **B**
(organic surfacing — helps any phase), the quality gate. **Phase-FRAGILE** pieces to treat
with care: **C** (bias-to-playbook — only right when the workflow is genuinely procedural; in
a thin phase it mints junk) and any threshold tuning.

## Deterministic plumbing vs agent judgment — the "memory" pattern (raised 2026-06-14)

The over-fitting risk is really an argument for **agent judgment at the decision point**: a
deterministic recurrence counter cannot tell "I keep editing the plan" (not graduatable) from
"I keep doing this 4-step release dance" (a real procedure) — a model can. The fear is the
obvious one: *don't dump all the captures into a model.* Two reference systems already solve
exactly that, and mage is closer to them than it looks:

- **Claude Code's own memory** — agent-judged, two-tier, selectively recalled. The session
  model decides what is durable and writes ONE distilled fact per file with a one-line
  `description`; a lightweight INDEX (`MEMORY.md`, one line each) is the ONLY thing always in
  context; full entries are recalled into a `<system-reminder>` ONLY when the `description`
  matches the task; dedup/curation is the agent's job. The model judges — but over a BOUNDED
  view (the index), never the raw transcript.
- **ECC / context-mode** — checked the plugin: continuous CAPTURE is *deterministic*
  (`session-extract.bundle.mjs`, a regex/heuristic extractor — not a model), and it keeps data
  out of the main context via *sandboxed* processing ("Think-in-Code"). The `claude-haiku-4-5`
  reference is a **cost-accounting table**; the ADR "Haiku" mentions are **tool-description
  A/B tests** — NOT, in what's visible, a Haiku continuous-learning judge. (Caveat: the MCP
  backend isn't in the hook bundle, so a model-judge there isn't ruled out.)

**Shared pattern — and mage already fits it:** deterministic cheap CAPTURE → a BOUNDED ranked
SURFACE → MODEL JUDGMENT over that surface, never raw data. mage's deterministic fold +
`promotionBudget` top-N manifest IS the bounded surface; the `mage:groom` / `mage:graduate`
SKILLS ARE the agent judgment (the host session model reading the manifest). Per ADR-0009
("no model lives here") + ADR-0021 (offline / no-telemetry), the judge is the HOST model
invoked through a skill, NOT a model embedded in the engine.

**So agent-vs-deterministic is mostly a FALSE FORK — mage is already both.** What's missing is
(A) richer candidates so the agent can judge well, (B) an organic TRIGGER so it is asked to
judge at the right moment, and TRUSTING the agent to judge WORTHINESS (reject "edit the plan")
rather than transcribe — which is also the over-fitting fix.

**The one REAL fork (grill, OQ 9):** should mage EMBED a cheap dedicated judge (a Haiku-class
model mage calls itself at session boundaries, ECC-style) to groom fully autonomously and OFF
the main chat's expensive context? Pro: out-of-band continuous learning that doesn't spend the
main session's tokens; consistent judgment. Con: breaks ADR-0009/0021 (embeds a model, needs a
key + network, opens a cost/telemetry surface) — a genuine identity shift. Default lean: keep
the host-skill judge + organic trigger (B); the bounded manifest already keeps data off the
model. An embedded judge is a LATER option IF fully-autonomous out-of-band grooming is wanted.

## Proposed changes

### A — make a recurring workflow DRAFTABLE as a procedure (highest leverage)

Today a `workflow` hit (`signature.ts` §③) is `tool + path basenames`, and the signature's
`hint` is a single line like `workflow: Edit rollup.ts` — no sequence. You cannot write a
playbook from that.

- **A1 (lighter, preferred first):** enrich the recurring signature so the groom skill has
  the *repeating multi-step shape* to draft from — either by carrying a short, redacted,
  ordered step-list (the tool+target sequence of a representative chapter) on the
  `SignatureStat`, OR by having `mage:groom` pull the signature's actual `.learnings`
  segments and reconstruct the sequence at draft time (the skill already has fs access).
  Bucketing key stays `(wing+keywords)`; only the drafting material gets richer.
- **A2 (heavier, defer):** true sequence mining — bucket on a recurring ordered n-gram of
  tool+target steps, not just topic keywords. Closer to real procedure detection but needs
  sequence alignment / variable-length handling. Only if A1 proves insufficient.

### B — surface ripe candidates at the reflection moment (organic trigger)

Add a hook path that injects a SHORT nudge into the agent's context when (and only when) a
candidate is ripe — never auto-grooms, never commits.

- **Mechanism:** a `mage nudge` (or `mage promote --nudge`) command run from a SessionStart
  group (and/or SessionEnd) that folds incrementally (the offset watermark keeps re-folds
  cheap), checks for a NEW ripe state (≥K uncovered workflow candidate, or a graduate
  proposal), and prints one line to stdout, which Claude Code injects as `additionalContext`
  (the same channel context-mode uses). E.g. *"mage: the 'rollup' workflow recurred 5× —
  capture it as a playbook? (`mage:groom`)"*.
- **Single-chat fit:** SessionStart fires on every compact (`source: "compact"`), so this
  surfaces at each chapter boundary — exactly the [[single-chat-compaction-workflow]] user's
  reflection moment. SessionEnd covers multi-session users.
- **Anti-nag:** throttle via a tiny state file (nudge at most once per N hours, and only on a
  NEW threshold crossing since the last nudge).

### C — bias workflow-derived drafts toward a PROCEDURAL type

When `mage:groom` drafts a note from a `workflow`-lens candidate, DEFAULT it to **playbook**
(a recurring workflow *is* a procedure), so it lands on the graduation track instead of
becoming a non-graduating plan/reference. Mostly a `skills/groom/SKILL.md` prompt change
(the proposal payload already carries lens info), plus possibly surfacing the lens in the
manifest. The human still judges — C is a default, not a forced type.

## Central risk — graduating NOISE

A+B+C make graduation reachable, which re-opens the danger the recurrence model was wary of:
turning "I keep editing the plan" into a Procedure skill nobody wants. The design MUST carry
a quality gate, or it trades "nothing graduates" for "junk graduates":

- The groom skill REJECTS workflow candidates that aren't genuine reusable procedures (a
  single repeated file-touch is not a procedure; a repeated multi-step sequence is).
- Consider a HIGHER bar for workflow candidates than for correction/failure (e.g. require an
  actual A1 step-sequence, or lens diversity, or more recurrence) — recurrence-of-activity is
  weaker evidence than a stated lesson.
- The human-confirm-is-the-commit invariant (ADR-0013) stays the backstop; B never
  auto-grooms.

## Open questions (to grill)

1. A1 vs A2 — is enriching the hint / skill-side reconstruction enough, or do we need real
   sequence bucketing? (Lean A1.)
2. Should `correction`/`failure` candidates get a LOWER K than `workflow` (lessons are more
   note-worthy per occurrence)? Or route one-shot strong lessons through distill only?
3. B's boundary + audience: SessionStart-on-compact, SessionEnd, or both? Nudge the AGENT
   (additionalContext → it proactively offers groom) or just log for the human?
4. B's cost: is an incremental fold on every SessionStart acceptable, or do we need a cached
   "ripe?" flag updated by the existing Stop metrics fold?
5. Does C risk a flood of low-value playbooks? Pair with the quality gate; maybe C only
   applies once an A1 sequence exists.
6. Release home: a focused **0.0.12 "organic grooming loop"**, or is this the real substance
   of **0.1.0**'s "complete solution"? (See [[mage-011-signal-capture]] / the release
   sequence.)
7. **Re-gate 0.1.0?** Should the gate be a *correct, TESTED* loop (graduates a constructed
   procedure scenario, stays quiet on thin work) rather than an *observed* organic graduation
   in the live soak — which over-fits to whatever phase the user is in? (Validity §3.)
8. **Where do we get a SECOND usage pattern** to validate against — wait for the
   sreforge/prismalens work to mature into a maintenance/debugging phase, or construct
   synthetic debugging/maintenance traces now?
9. **Embed a cheap dedicated judge?** A Haiku-class model mage calls itself at session
   boundaries (ECC-style, out-of-band, off the main chat's context) vs the current
   host-skill judgment + organic trigger (B). Touches ADR-0009 ("no model in the engine") +
   ADR-0021 (offline / no-telemetry) — an identity decision, not just a knob. (Lean: B.)

## Relations

- amends [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) — the
  scratch→note→skill loop; this completes its *procedure* path and adds the organic trigger
  ADR-0013 §4 hand-waved ("promote-on-recurrence surfaces them").
- amends [ADR-0019](../decisions/0019-mage-promote-self-grooming.md) — the promote manifest +
  the procedural-only graduation gate (the `covered=20 / graduate=0` finding lives here).
- depends_on [ADR-0015](../decisions/0015-mage-observe-capture-schema.md) — the lens
  definitions (workflow vs correction/failure) the diagnosis turns on.
- relates_to [ADR-0018](../decisions/0018-mage-distill-observed-scratch-reader.md) — the
  lesson path's proper home (first-sight, not recurrence).
- constrains [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md) — "no
  model in the engine; judgment rides host hooks/skills" — the principle the embedded-judge
  fork (OQ 9) would have to amend.
- constrains [ADR-0021](../decisions/0021-offline-no-telemetry-local-signal.md) — offline /
  no-telemetry / local-signal — the other principle an embedded cheap judge would touch.
- follows [plan-0.0.11-signal-and-capture](plan-0.0.11-signal-and-capture.md) — whose honest
  soak finding (precision not reach) surfaced this.
- informs [plan-release-sequence](plan-release-sequence.md) — slots a grooming-loop release
  before / as the 0.1.0 beta announcement.
