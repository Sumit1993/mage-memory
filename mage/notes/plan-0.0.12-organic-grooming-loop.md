---
type: plan
tags: [mage/grooming, mage/0.0.12]
created: "2026-06-14"
updated: "2026-06-15"
last_reviewed: "2026-06-15"
status: active
provenance:
  repo: mage-memory
  work: 0.0.12-organic-grooming-loop
sources:
  - src/grooming/signature.ts
  - src/grooming/promote.ts
  - src/grooming/tally.ts
  - src/grooming/thresholds.ts
  - src/claude-settings.ts
  - src/dashboard/nudges.ts
  - src/observe/scrub.ts
  - src/commands/observe.ts
  - skills/learn/SKILL.md
  - skills/groom/SKILL.md
  - mage/decisions/0009-no-runtime-automation-rides-host-hooks.md
  - mage/decisions/0013-procedure-skills-self-grooming-loop.md
  - mage/decisions/0018-mage-distill-observed-scratch-reader.md
  - mage/decisions/0019-mage-promote-self-grooming.md
  - ~/ai-context/mage-redact-false-positives-issue.md
keywords: [grooming, organic, lesson, first-sight, distill, staging, nudge, inline, claude-code-memory, redact, 0.0.12]
---

# Organic grooming loop (0.0.12) — the lesson path

**Status: GRILLED 2026-06-15 — decisions locked, ready to build.** Becomes **ADR-0024**
once built — *finishing* [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
§24 step 2 (the planned-but-unbuilt nudge) and amending
[ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) /
[ADR-0019](../decisions/0019-mage-promote-self-grooming.md).

> **The grill flipped the thesis.** This note was drafted as "closing the *procedure* path"
> (recurring workflow → skill). The 2026-06-15 grill established the opposite: the organic
> win is the **lesson path** (first-sight → note, Claude-Code-memory style), and the
> procedure path (skill graduation) is **deferred**. The analysis below is the rationale that
> led there; **the locked spec is this section.** Read it first.

## Decisions locked (grill 2026-06-15) — the 0.0.12 spec

**Gate & scope**
1. **Gate = a1: observed organic NOTE creation**, Claude-Code-memory style (SHORT + concise).
   **a2 (note→skill graduation) is DEFERRED** to a longer timeframe / bigger user base.
2. **0.0.12 = the LESSON path** (first-sight → note), NOT the procedure path. The 0.0.11
   recurrence machinery (tally, K/M, de-noise, Candidates 1–4) is **untouched** — it serves
   the deferred procedure path (a2). Evidence: 40/40 ≥K signatures are `workflow` (activity),
   while the notes Claude Code's *own* memory minted from this same work (no-emojis, dogfood,
   branch-protected) are first-sight LESSONS — and CC memory has no skill-graduation at all.
3. **Release: the loop ships as 0.0.12** (bake it); **0.1.0 = the announcement** once a1 is
   observed working in real use.

**Architecture (how notes get made)**
4. **Inline-primary + boundary safety-net; reject the embedded judge.** Verified CC memory
   uses **no hook**: index loaded at session start, recall via `<system-reminder>`, creation
   **inline via the Write tool during the response**, driven by an always-on instruction. So
   inline is the primary path; the boundary is only the safety-net. (OQ 9 = NO embedded judge:
   breaks ADR-0009 "no reasoner in the engine" + ADR-0021 no-egress, and is redundant — the
   skills already ARE the judge.)
5. **(b2) frictionless staged write + batch-confirm at the boundary.** The agent writes a
   short draft with NO per-note confirm; the human-confirm happens at the batch commit. Bends
   (doesn't break) "human-confirm is the commit" (ADR-0013), exactly like CC memory's
   frictionless-write / no-commit split — plus mage's committed-notes tier on top.
6. **New gitignored `mage/.staging/`** holds judged-but-uncommitted drafts — a third epistemic
   state, separate from `.learnings/` (raw, deterministic, auto-pruned) and `notes/`
   (committed, indexed-live). Keeps unconfirmed drafts OUT of the live index until promoted.

**Mechanism**
7. **Engine = first-sight** (`mage distill`, ADR-0018) + inline capture — never the recurrence
   tally.
8. **The boundary nudge RUNS distill (ii)** over the new `.learnings/` segment to catch
   lessons the agent forgot to capture inline, drafts them to `.staging/`, and surfaces the
   batch — robust against the forgetting that IS the failure mode.
9. **Anti-flood gate:** dedup (against `notes/` via `coveringNote`, `.staging/`, and
   `rejected.json`) + **bounded budget N = 3** drafts surfaced per boundary + reject →
   `rejected.json` (never re-drafts) + distill's first-sight salience bar. N=3 is load-bearing
   (caps volume even if the bar is loose).
10. **No per-prompt nag to start.** Ship inline + boundary-safety-net; escalate salience (a
    light `UserPromptSubmit` reminder) ONLY if dogfooding shows inline misses.
11. **Notes stay SHORT** (CC-memory-sized). Tension to resolve in build: the 6000-char
    `noteSizeCap` is for authored design notes; staged lesson-notes want a much smaller target.

## Build decisions (locked during the build, 2026-06-15)

Resolving the spec's "resolve in build" tensions + the codebase-map's open questions:

- **D1 — `.staging/` = a new gitignored `STAGING_DIR=".staging"`** sibling of `.learnings/`/`.metrics/`,
  holding **complete note drafts** as `<slug>.md` (frontmatter + body). It is in the indexer
  **SKIP_DIRS** (never indexed); `mage groom` reads it **directly** (bypasses the scanner). So
  groom-accept = **move + index** (no re-serialize). Per-project in a hub (each project gets its own).
- **D2 — slug = kebab(title)**, de-collided with `-2`, `-3` … on clash.
- **D3 — short lesson cap = `lessonNoteCap` (BASE 1200 chars, body)** in `thresholds.ts`. CC-memory-sized.
  **Soft**: `mage stage` *warns* past it but never blocks (frictionless). The 6000 `noteSizeCap`
  stays for authored design notes.
- **D4 — `mage stage`** (hidden plumbing): `--title` + `--type`(default `gotcha`) + `--tags` + `--wing`
  + body on **stdin**; composes a note, **scrubs via `redact()`** (keep-context, NEVER blocks — drafts
  are pre-commit + gitignored), dedups, writes `.staging/<slug>.md`; `--json` → `{staged,path,key,skipped,reason}`.
- **D5 — `mage groom`** (hidden plumbing): default/`--json` **surfaces** the deduped, N-capped pending
  batch (read-only); `--accept <slugs|all>` **moves** drafts → `notes/<slug>.md` + runs the indexer;
  `--reject <slugs|all>` deletes them + records their key. Notes are **flat** in `notes/` (wing via tags).
- **D6 — dedup reuses `coveringNote(sig, notes)`** (grooming/covering-note.ts); `sig = {wing from tags,
  keywords from title+body}`. A draft is skipped if a committed note covers it, it is already staged,
  or its key is in the reject ledger.
- **D7 — budget = `stagingBudget` (BASE 3)** in `thresholds.ts`; surface caps at 3 and **logs the
  remaining count** (no silent truncation).
- **D8 — lesson reject ledger = `.metrics/staged-rejects.json`** (`{v,keys:[]}`, fail-open) — a NEW
  file, kept **out of `.staging/`** (so groom can safely clear staging) and **distinct from** the
  recurrence-path `.metrics/rejected.json` (which keys on proposal action+target, the procedure path).

## Adapter build decisions (locked during the build, 2026-06-16) — `mage nudge`

The Claude-Code adapter (`mage nudge`, hook-fired). **The hook mechanism was CORRECTED
during the build** (the plan hand-waved "PreCompact + SessionEnd"; both are wrong):

- **N1 — fires on `SessionStart` with `source === "compact"`, NOT PreCompact/SessionEnd.**
  Verified against the Claude-Code hook docs: a **SessionEnd** hook's stdout is NOT injected
  as context (the session is ending) — it can't nudge the agent. **PreCompact** fires *before*
  compaction, when the chapter isn't closed yet. **SessionStart(compact)** fires right *after*
  a compaction, when the just-closed chapter's `.learnings/` are complete AND its structured
  stdout becomes the new session's context. The command gates on `source==="compact"` itself,
  so other SessionStart sources (startup/resume/clear) are a fast no-op. (mage writes the hook
  into settings.json, not plugin config, sidestepping the plugin-hook additionalContext bug.)
- **N2 — the nudge DRAFTS distilled lessons to `.staging/` but NEVER advances the distill
  watermark** (only `mage distill --seen` does). Dedup (vs `notes/` + `.staging/` + the reject
  ledger) makes a chapter re-offered every compact get drafted **at most once** — idempotent.
- **N3 — budget = `stagingBudget` (3) NEWLY-written drafts per run**; deduped/empty clusters
  don't consume budget; the rest defer to the next compact.
- **N4 — anti-nag throttle = `.metrics/nudge-throttle.json`** (`{v,lastNudge}`, fail-open):
  a fresh draft is ALWAYS surfaced; a *pending-only* reminder fires at most once per 4h.
- **N5 — `additionalContext` via the structured `{hookSpecificOutput:{hookEventName,
  additionalContext}}` JSON** (the documented SessionStart form; one line, well under the 10k cap).
- **N6 — re-SCRUBS the composed draft (title + body) via `redact()`** before disk — defense in
  depth over the capture-time scrub, so a raw `.learnings` line can never leak into a draft.
- **No-hook degradation** holds: inline `mage stage` is the primary path; the nudge is the
  safety-net. NEVER throws to the host (fail-open, exit 0).

## The 0.0.12 build — portable core + Claude-Code adapter

The whole loop splits along ADR-0009's existing line (*"notes portable, capture host-specific"*):

- **Portable core (any harness with a shell + an instruction):** a new deterministic
  **`mage stage`** verb (redacts via `scrubField`/`redact`, writes a short draft to
  `.staging/`) · the agent drafts inline and calls it · **`mage groom`** surfaces the batch
  and moves confirmed drafts to `notes/` + `mage index` · reject → `rejected.json`. File
  layout + verbs + the draft-then-stage pattern need nothing host-specific.
- **Claude-Code adapter (first):** the boundary distill safety-net — fired on
  **`SessionStart(source=compact)`** (see N1 above; NOT the originally-guessed PreCompact/
  SessionEnd), agent-aimed via `additionalContext`, wired by `mage connect`. Hooks +
  context-injection are per-harness — others land as demand appears (ADR-0009 §27).
- **Graceful degradation (ADR-0009 ladder):** no hook adapter on a harness → inline capture,
  or manual `mage:learn`/`mage stage` — **lossless**. Nothing depends on a hook for correctness;
  inline reliability is a quality gradient (harness-dependent salience), not a correctness hole.

## Also in 0.0.12 (bundled) — redact false-positives

`mage redact` (Gate-2 pre-commit) blocks **legitimate** commits on false-positive
high-entropy / generic-key-value matches with **no allowlist** — and the loop generates *more*
note commits, so this becomes load-bearing (every false positive blocks the loop). Source:
`~/ai-context/mage-redact-false-positives-issue.md`. Fixes:
- **Skip mage's own generated artifacts** in the staged scan (`INDEX.md`, `_index.*.md`,
  `.agents/skills/**`, `.claude/skills/**`, `AGENTS.md`, `CLAUDE.md`, `IDENTITY.md`) — reuse the
  indexer skip-set; their paths are not secrets.
- **Don't flag `${ENV}` placeholders** (`${...}` / `${env:...}` / `${varlock:...}`) as values.
- **Tune the high-entropy detector** to exclude path-like tokens (contain `/`, end `.md`,
  slash/hyphen-joined word runs) and CamelCase prose.
- **Add a non-bypass allowlist** (`mage/.redactignore` globs + literal allows, and/or the
  `--confirm` flow the hook message already promises) so no-`--no-verify` environments aren't
  deadlocked.

## Also in the 0.0.12 cycle — adopt release-please (decided 2026-06-15)

Releases move from a hand-made version-bump PR to **release-please**. Researched the landscape
first: **husky** is the wrong layer (a hook *runner*, not a bumper); **release-it** has no
native PR mode (its CI model pushes the bump+tag straight to the branch) and would need either
a bypass-actor (which violates mage's "never direct-push; the USER merges PRs" rule) or a
hand-built two-phase wrap that just re-implements release-please. **release-please fits the
branch-protected, human-merges-the-PR model natively.**

- **How it handles "one release = many PRs":** it runs on every merge to `main` and maintains
  ONE rolling `chore(main): release X` PR that accumulates all the feature PRs' conventional
  commits (version + CHANGELOG grow as more land). You merge that release PR once to cut the
  release — the #12–17 → hand-made #18 pattern, automated.
- **0.0.x cadence:** release-please derives the bump from commit type (`feat`→minor), so a
  pre-1.0 `feat:` would jump to 0.1.0. Keep 0.0.x with **`bump-patch-for-minor-pre-major: true`**
  (feats bump the patch), with a `Release-As: 0.0.x` commit footer as the milestone override.
- **Bespoke files** ride `extra-files`: `package.json` (native), `.claude-plugin/plugin.json`
  (`$.version`), `.claude-plugin/marketplace.json` (`$.plugins[0].version`), and the README
  status badge (a `generic` marker). CHANGELOG is maintained natively. **npm publish stays
  manual** (no `NPM_TOKEN` in CI to start). `src/release-consistency.test.ts` (the 0.0.11
  interim guard) is **kept** — it now backstops that the `extra-files` config stays correct.
- **Sequencing:** **PR #18 is refactored from a manual 0.0.11 bump into the release-please
  INIT PR** — so **0.0.11 becomes the first release-please-managed release** (no manual
  tag/publish). The refactor reverts the manual bump, adds `.github/workflows/release-please.yml`
  + `release-please-config.json` + `.release-please-manifest.json` (pinned to `0.0.10`), and
  keeps the one-time historical `CHANGELOG [0.0.10]` fix. **Caveat:** a release-please bootstrap
  on an existing repo usually needs one post-merge CI iteration (extra-files paths / README
  marker / version derivation reveal only when the Action runs) — verify config against current
  release-please docs, don't guess the schema.

## Deferred to a2 / later (the procedure path)

The procedure path — **A** (enrich workflow→procedure), **C** (bias-to-playbook), **D** (the
confidence-ladder auto-tuner, planned in ADR-0009 §25 / ADR-0021 §2), A2 sequence mining,
lens-aware K (OQ 2), and a second-usage-pattern validation (OQ 8) — is **deferred** with a2.
The recurrence machinery built in 0.0.11 already serves it when it lands. The sections below
are the rationale that produced this split; treat them as background, not scope.

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

## Provenance — finishing a planned loop, not inventing one (raised 2026-06-14)

The whole organic loop this note proposes was **written down at the start and simply left
unbuilt** — A/B are completing [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md),
not extending it:

- **The nudge trigger (B) = ADR-0009 §24, step 2** — *"A `PreCompact` / `SessionEnd` hook
  **nudges** the agent … before context is lost."* The deployed hooks stopped at step 1
  (`mage observe`, deterministic capture); the step-2 nudge was never wired.
- **The loosening-to-autonomy (the confidence ladder / auto-tuner) was planned twice** —
  ADR-0009 §25 (*"Promote … starts human-confirm; graduates to **auto-promote** when a pattern
  recurs ≥2× at confidence ≥ threshold"*) and [ADR-0021](../decisions/0021-offline-no-telemetry-local-signal.md)
  §2 (*"local data drives **per-user adaptation (the deferred auto-tuner / autonomy rungs)** …
  more automated promotions over time runs through the user's **own local accept-rate**, not a
  remote server"*). Both UNBUILT — promotion still cold-starts at human-confirm (ADR-0016 Rung
  A), with no local-accept-rate loosening yet.
- **What these ADRs already SETTLE for OQ 9:** judgment "rides" the host agent and "never
  smuggle a reasoner into the CLI" (ADR-0009 §17,§19); signal stays local, no phone-home
  (ADR-0021 §1). So an embedded cloud judge breaks BOTH on two counts (reasoner-in-engine +
  network egress); even a local model still adds the "runtime of our own" ADR-0009 forbids. The
  blessed path is exactly B + the §25/§2 local-accept-rate ladder.

Framing: this is **finishing the plan, not a pivot.** The only genuinely new decision is OQ 9
(embed a judge), and the ADRs already lean it toward "no."

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

> **Not new design — UNBUILT design.** This is [ADR-0009](../decisions/0009-no-runtime-automation-rides-host-hooks.md)
> §24 step 2 verbatim: *"A `PreCompact` / `SessionEnd` hook **nudges** the agent ('distill
> `.learnings/` … before context is lost')."* The nudge was planned at the start; the wired
> hooks only ever ran `mage observe` (capture, step 1), never the nudge (step 2). B finishes it.

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

## Open questions — RESOLVED in the 2026-06-15 grill

> All resolved; see **Decisions locked** above. Quick map: OQ6 → 0.0.12 (announce 0.1.0
> later); OQ7 → gate is **a1** observed note creation; OQ9 → **no** embedded judge; over-fit →
> signal exists but it's *lessons*, build the lesson path, defer a2; OQ1/OQ2/OQ5/OQ8 + D →
> deferred with the procedure path (a2). Retained below for traceability.

1. A1 vs A2 — is enriching the hint / skill-side reconstruction enough, or do we need real
   sequence bucketing? (Lean A1.) → **deferred (a2).**
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
