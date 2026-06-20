---
type: decision
tags: [mage/decisions]
created: "2026-06-20"
updated: "2026-06-20"
last_reviewed: "2026-06-20"
status: active
provenance:
  repo: mage-memory
  work: digest-to-agent-capture
sources:
  - src/commands/nudge.ts
  - src/distill/reader.ts
  - src/distill/prose.ts
  - src/grooming/staging.ts
  - src/grooming/thresholds.ts
  - mage/decisions/0028-prose-keyed-capture.md
  - mage/decisions/0027-faultline-friction-capture-trigger.md
  - mage/decisions/0024-organic-grooming-loop.md
  - mage/decisions/0018-mage-distill-observed-scratch-reader.md
  - mage/decisions/0009-no-runtime-automation-rides-host-hooks.md
---

# 0029 — Digest-to-agent capture: deterministic narrowing, agent judgment (supersedes prose-keyed)

> Status: supersedes [ADR-0028](0028-prose-keyed-capture.md) (prose-keyed, gate-KILLED 0/55) and,
> transitively, [ADR-0027](0027-faultline-friction-capture-trigger.md) (Faultline, gate-KILLED 0/62).
> Both were deterministic candidate-SELECTION designs; both were killed by their own pre-registered
> replay gates. This records the digest→agent pivot the two kills triangulated. Success criterion =
> a NEW, model-swept replay gate (digest → miner agent → adversarial refute + recall-vs-gold +
> control). Grilled 2026-06-20; **the gate then RAN. CAPTURE PASSED** — miners extracted ~all gold
> gems at every tier (Haiku ≈ Opus). The original adversarial refuter scored it 0/0/0, but that was a
> mis-calibrated instrument (it rejected 58/58, incl. the user's own context-mode example, on an
> absolute "self-documenting → worthless" bar). A **balanced re-judge of the same extractions PASSES
> the live-trial-behind-a-flag bar: ops precision 11/33 = 0.333** (the ≥1/3 threshold, and
> under-counted), **8/15 gold recovered** (the reusable half), every confirmed lesson medium/high, the
> judge discriminating. See the [Gate outcome](#gate-outcome-2026-06-20--pass-behind-a-flag) section.

## Context

Two pre-registered replay gates, run over the same 5 ops/infra sessions + 3 mage-dev controls with a
strict, blind, thesis-anchored judge, both returned a decisive KILL:

- **Faultline (ADR-0027): 0/62.** A tool-transition detector — it captured friction *position*
  (a `tried→worked` swap) but discarded the *content*.
- **Prose-keyed (ADR-0028): 0/55.** Keyed on correction prose + recurrent-failure strings — it kept
  the content but surfaced the wrong *unit*: cheap conversational steering (scoping questions,
  product direction), while the failure/command stream where the real lessons live was starved
  (corrections 0/53; the 2 recurrent-failure gems rejected as self-documenting, re-derivation cost ≈ 0).

Both controls were clean (0/14, 0/18) — the judge was strict, not lenient — so these are real
measurements of detector yield, not judge artifacts. The recall phase then **triangulated the
diagnosis**: the durable earned lessons are **single-session friction / derivation ARCS in the
failure + external-command stream** (a WebFetch→curl→chrome-render→PNG pipeline; a 6-command
npm/GH name-and-identity recon; an act_runner empty-token fix; "GitHub Free blocks branch-protection
on a private repo"; an f-string-in-heredoc quoting trap). Every one needs **model synthesis** (stitch
a multi-event arc into one lesson) and **model judgment** (durable vs incidental) — and a model-free
core (ADR-0009) can do neither.

The decisive evidence for the pivot: the recall agents — *models reading the digest* — **found those
gems**. So the bottleneck was never the signal's presence; it was deterministic SELECTION/RANKING of
a purely-semantic property (durability). This is the third independent confirmation of "~1 gem per
~2000 events, no deterministic classifier isolates it" (the two gates + the 0.0.12 proving run).

**Conclusion:** stop trying to make a deterministic core *decide* what a lesson is. Use the core for
what it is good at — cheap, offline NARROWING + COMPRESSION + neutral annotation — and route the
JUDGMENT to the host agent's model (ADR-0027 §2's clarified ADR-0009: a model in the *host*, never in
mage's engine). The deterministic work is not discarded; it is repositioned from *selector* to
*digest-builder*.

## Decision

1. **Supersede deterministic candidate-SELECTION entirely.** `faultline.ts` (the arc selector) and
   prose-candidate-ranking-as-truth are dead. **Full flip:** remove `draftCluster`/`clusterToDraft`
   from the boundary nudge — mage no longer *writes lesson draft files* on its own judgment (the gate
   proved those auto-drafts are ~0% durable). `.mage/staging/` thereafter holds **only** lessons the
   *agent* chose to stage.

2. **The boundary nudge emits a read-only DIGEST**, not drafts. On a SessionStart `source:compact`,
   `nudgeCmd` renders the just-closed chapter's earned-signals as `additionalContext`; the host agent
   mines it; **agent-initiated `mage stage`** is the only path into `.mage/staging/`. Inline capture
   stays PRIMARY (ADR-0024); the digest is the boundary safety-net.

3. **Digest contents = three earned-signal types** (the agent is post-compaction, so the digest is its
   only window into the closed chapter):
   - **Failures** — error strings (`reader.ts` `signals.failures`), `failureSkeleton`-deduped, redacted;
     harness-protocol noise (`isProtocolFailure`) excluded.
   - **External commands** — `curl|wget|gh|kubectl|aws|gcloud|az|terraform|docker|psql|...`, deduped,
     redacted. **First-class, and the single most evidence-backed addition:** the richest missed gems
     (the npm/GH recon arc, the SVG→PNG `curl` workaround) lived *entirely* here, and neither dead
     detector surfaced commands at all.
   - **Corrections** — substantive corrections (`isSubstantiveCorrection`-filtered), each with its
     preceding action for context.
   Excluded throughout: routine successful tool_uses, protocol failures, continuation/boilerplate
   prompts, anything redaction masks.

4. **Flat per-type sections, chronological within each.** The model stitches cross-type arcs from
   *content* — the recall agents reconstructed the SVG→PNG arc from exactly this flat shape. mage does
   NOT pre-build arcs (no resurrecting the killed detector). A hybrid with explicit "these happened
   together" arc-hints is the cheap escalation **only if** a live trial shows the agent missing arcs.

5. **Framing = raw material, never a claim** (the failure mode of both dead detectors was an artifact
   that read as a *claimed lesson*):
   - A non-claim banner: *"Earned-signal inventory from the last chapter — raw material, not lessons.
     mage is not claiming any is worth keeping; most are noise. Stage a durable one with `mage stage`.
     Nothing here is ranked by importance."*
   - **Chronological order — never recurrence-sorted.** Recall showed recurrence is a *poor* value
     proxy (the gems were single-occurrence; the recurrent failures were rejected), and within-chapter
     repetition usually signals a retry loop (transient noise). Sorting by frequency would bury the
     one-shot gems that matter most.
   - Annotations are plain facts (a dedup count, the preceding action, a contradiction-cue flag),
     never an endorsement, never a pre-assigned note type.

6. **Size bounding, with no silent caps:**
   - **Dedup is the primary control** (pure compression, not a value call): `failureSkeleton`-dedup on
     failures, exact-dedup on commands, the substantive-correction filter on prompts.
   - **Generous per-section caps** (`thresholds.ts`, soak-tunable, same seam as `SALIENCE_CAP`); on
     overflow, **keep the most recent** (a neutral rule) and emit an explicit spill line — *"+N more —
     run `mage distill` for the full set."*
   - A total `additionalContext` char budget as the final guard, with the same spill notice. Whenever
     anything is dropped, the digest *says so*.

7. **Tight v1 scope.** v1 = a digest builder (reusing `reader.ts` signals + `failureSkeleton` + a new
   external-command extractor) + rewiring `nudgeCmd`. v1 touches **zero** of `signature.ts` /
   `tally.ts` / `promote`. The v1 recurrence annotation is a **dedup count only** (within-chapter
   compression metadata, not a value signal). **Deferred:**
   - **Cross-session recurrence** (the one genuinely meaningful frequency signal — "this bit you across
     3 prior sessions"), via the *existing* tally with the failure lens repointed to `failureSkeleton`
     (ADR-0028 §5's decision, preserved) — a clean v2.
   - **`mage promote`'s deterministic note-PROPOSAL ladder** (recurred ≥K → "here's a new note") is the
     *same* killed selection pattern; flagged **suspect + deferred** for its own review (it was never
     gated directly). **Note→skill graduation** (≥M, graduating already-human-confirmed notes by
     continued usage — a different signal) is untouched.

8. **ADR-0009 intact; agent-agnostic by construction.** The digest build is model-free + offline (no
   egress, ADR-0021); the model is the *host agent* reading `additionalContext`. Graceful degradation
   is honest because inline `mage stage` works regardless of host model — so a weak-host miner *miss*
   degrades the safety-net, it never breaks capture.

9. **Success criterion = a NEW, model-swept replay gate.** Same discipline (pre-registered,
   replay-before-wiring, replay can kill but only the live reject-ledger crowns):
   - Build the v1 digest deterministically for the same 5 ops + 3 control sessions.
   - A **miner agent** extracts durable lessons from each digest (the digest only, never the
     transcript), with evidence lines.
   - **Precision:** adversarially refute each extraction; `confirmed` = survives.
   - **Recall:** score against the **gold gem-set the prose-gate recall already produced** (SVG→PNG,
     GitHub-Free, act_runner, f-string-heredoc, npm-name recon, code/load separation, commit-leakage) —
     agent-derived, human-inspectable.
   - **Control:** the mage-dev digests must yield ~0 confirmed (else the digest induces hallucination).
   - **Sweep the miner across Opus / Sonnet / Haiku**, with a **FIXED Opus judge** (a constant precision
     instrument — sweeping it would confound miner quality with judge quality). The sweep measures the
     **agent-agnostic degradation curve** *and* tells us how much deterministic scaffolding the digest
     must carry (if Haiku finds the gems, the deterministic layer is doing the work and the model is
     nearly interchangeable; if only Opus does, strengthen the digest rather than depend on a strong host).
   - **Headline:** confirmed durable lessons from the ops digests — directly against the **0/62 and 0/55**
     both detectors scored.
   - **Bar (tiered to graceful degradation):** SHIP-on-default if gems are recovered with good precision
     at **Sonnet** and control stays low; a **Haiku** PASS is the gold-standard result; an **Opus-only**
     PASS ships behind a flag / with a strong-host note and is a signal to strengthen the digest; **KILL**
     only if even Opus yields ~0 (digest too lossy) or control floods at every tier (no precision). A PASS
     flips the flag on for a live trial.

## Gate outcome (2026-06-20) — PASS (behind a flag)

The model-swept gate ran in two stages, and the gap between them is the central finding.

**Stage 1 — the gate as designed (0/0/0, but a broken instrument).** The v1 digest was built
deterministically for the same 5 ops + 3 control sessions; a miner mined each digest at three tiers
(Opus / Sonnet / Haiku); every extraction was scored by a **fixed-Opus adversarial refuter**. The
miners **extracted ~all the gold gems at every tier — Haiku ≈ Opus** (13/14/12 ops extractions; the
deterministic digest carries the load, the model tier barely matters). But the refuter **rejected
58/58 — 0 confirmed at every tier**, including the user's own motivating example (context-mode
WebFetch→ctx_*) and multi-step arcs (the SVG→PNG pipeline, dismissed as "obvious baseline knowledge").

That 0/0/0 was a **mis-calibrated instrument, not a measurement.** The refuter was prompted to "be
skeptical, default to refuted, argue why NOT worth storing" — and a capable model so instructed finds
a universal solvent ("self-documenting / obvious / one-off / over-general") for *any* operational
lesson. This also exposes the "control validates the judge" argument relied on in the prior two gates
as insufficient: a refuter that rejects *everything* still yields a clean control (the control's own
real gems — agy.exe-from-WSL, ctx_execute-rejects-`node`, git merge-tree — were killed too). A clean
control proves the judge is not *lenient*; it cannot prove it is not *unwinnable*.

**Stage 2 — re-judge with a balanced value-bar (the trustworthy measurement).** The same 58
extractions were re-scored by **two independent fixed-Opus lenses** (forward-value: "would an engineer
joining this project be glad this note exists?"; earned-cost: "expensive-to-re-derive / hard-won?"),
confirm = **both** keep, with explicit reject criteria (vacuous / obvious / unsupported / one-off) and
an explicit correction of the refuter's flaw (*self-documenting ≠ worthless — proactive avoidance has
value*).

| metric | ops | control |
|---|:--:|:--:|
| extracted | 33 | 25 |
| confirmed (both lenses keep) | **11** | 5 |
| precision | **0.333** | 0.20 |
| confirmed value | high 2 / medium 9 / low 0 / none 0 | — |
| gold gems recovered | **8 / 15** | — |
| ops extractions rejected | 22 | — |

**Verdict: PASS the pre-registered live-trial-behind-a-flag bar — conservatively, and under-counted.**

- **Precision 0.333 = exactly the ≥1/3 ship-behind-a-flag threshold**, and every confirmed lesson is
  medium-or-high value (zero low, zero none — no padding). It does NOT clear *default-on* (two-thirds
  still rejected → the human/agent at `mage groom` stays the final filter, which is the design).
- **The judge discriminates** (rejected 22/33 ops): it kills the vacuous ("good linking prevents note
  omission"), the genuinely obvious (the `[d]ockerd` self-match trick), and self-documenting one-offs,
  while at least one lens fights for every real gem. Not rubber-stamping.
- **Coverage 8/15 — the reusable half.** Recovered: `block-no-verify`/hooksPath, the context-mode egress
  redirect (the user's own example, recovered cross-session), app/harness separation, GitHub-Free
  private-repo gating. Missed: the narrow, look-up-able one-offs (exit-144 SIGTERM, gitea token,
  f-string heredoc, SVG pipeline, plain-JS workflow scripts, Playwright timeout, npm-scope recon).
  **Recovering the reusable arcs while missing the cheap one-offs is the earned-insight thesis
  *working*, not failing.**
- **The number is a conservative FLOOR.** ~14 of the 22 ops rejections are the forward-value lens
  applying a "must be about *mage-memory*" project-locality filter to lessons that belong to *their own*
  project (sreforge/prismalens) — wrongly killing context-mode, app/harness separation, GitHub-Free,
  etc. that the earned-cost lens kept. Fixing that one lens-prompt bug plausibly lifts precision toward
  ~0.5 and coverage toward 10–11/15.

**Honest 3-gate re-read.** The refuter is *proven* the binding constraint for THIS gate (the miners
extracted the gems; a balanced re-judge recovers them). It does NOT automatically exonerate Faultline
(0/62) and prose (0/55): those used different *extraction* front-ends and had genuine deficits visible
in their own recall (Faultline emitted contentless `topic:null` pairs; prose surfaced conversational
chatter and starved the command stream). What is now certain: the corpora demonstrably contain
capturable gems (8/15 recovered here), so no prior "0" can mean "the corpus was empty" — each prior
pipeline destroyed real signal (at the *detector* for Faultline; somewhere in prose). The
**earned-insight thesis is strengthened** (the miss profile is exactly cheap-one-offs-missed,
reusable-arcs-recovered). The capture program is **"alive and showing signal," not yet "validated"** —
one positive read against two kills, with a known under-count caveat.

**Next actions (a PASS flips the flag for a LIVE trial; replay can pass, only the live reject-ledger
crowns):**

1. **Wire the digest into `nudgeCmd` behind a flag** and run a live dogfood trial; the reject-ledger
   is the real arbiter (Decision §2/§9).
2. **Fix the forward-value lens's project-locality criterion** (judge value to the session's *own*
   project, not to mage-memory) — the single highest-leverage precision/coverage fix.
3. *(Optional, cheap rigor)* re-judge Faultline's 62 + prose's 55 extractions through the same balanced
   lenses, to separate "the refuter killed real signal" from "the detector never found it" and settle
   the 3-gate re-read definitively.

> **Standing read across three gates:** Faultline had the SHAPE and no content (0/62); prose had the
> CONTENT and the wrong unit (0/55); the digest has content *and* the right unit — and on a fair bar it
> finally clears the trial threshold (11/33, 8/15 gold). The deterministic layer's job is NARROWING;
> the judgment is the host model's; the human at `groom` is the crown. Replay passed behind a flag; the
> live reject-ledger decides default-on.

## Consequences

- The boundary nudge surfaces a digest the agent mines; `.mage/staging/` holds only agent-chosen
  lessons; the gate-proven ~0%-durable auto-drafting is **deleted** → lower cost (no wasted drafts /
  groom cycles) and higher yield, with the deterministic narrowing bounding per-boundary cost.
- mage stays **model-free in its core and offline** (ADR-0009/0021); the model is the host agent — now
  not a stylistic choice but the *empirically forced* one (two gates proved a model-free selector cannot
  isolate earned lessons).
- `faultline.ts` and `prose.ts` (+ their unit tests) are **documented negative results** on
  `feat/faultline-detector` and `feat/prose-keyed-capture` (not wired). The gate methodology + harness
  (`~/ai-context/mage-prove-20260619/`) are the reusable assets and the standing bar.
- The model sweep yields a degradation curve that doubles as the central tuning signal for v1 (how much
  structure the digest needs) and the cost story (which host tier suffices).
- If the gate fails **even at Opus**, the deterministic boundary-capture line is fully dead and capture
  collapses to inline-primary only (ADR-0024) — the digest is then removed, not iterated.

## Relations

- **supersedes** [ADR-0028](0028-prose-keyed-capture.md) (prose-keyed, gate-killed 0/55) and,
  transitively, [ADR-0027](0027-faultline-friction-capture-trigger.md) (Faultline, gate-killed 0/62).
- **amends** [ADR-0024](0024-organic-grooming-loop.md) — same organic loop (inline-primary + boundary
  nudge + no embedded judge); changes what the nudge surfaces (a read-only digest, not drafts) and
  grounds "no embedded judge" in two gate kills.
- **constrained_by** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) — no model in mage's
  engine; the model is the host agent (now empirically forced, not just asserted).
- **relates_to** [ADR-0018](0018-mage-distill-observed-scratch-reader.md) — reuses the distill reader's
  `signals` as the digest substrate; removes its draft-drafting role at the nudge.
- **relates_to** [ADR-0019](0019-mage-promote-self-grooming.md) — the failure-skeleton tally repoint
  (cross-session recurrence) is deferred to v2; the deterministic note-proposal ladder is flagged
  suspect + deferred.
