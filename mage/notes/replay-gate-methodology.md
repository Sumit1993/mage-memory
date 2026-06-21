---
type: reference
tags: [mage/grooming, mage/evaluation, mage/capture]
created: "2026-06-20"
updated: "2026-06-20"
last_reviewed: "2026-06-20"
status: active
provenance:
  repo: mage-memory
  work: capture-validation-gate
sources:
  - mage/decisions/0027-faultline-friction-capture-trigger.md
  - mage/decisions/0028-prose-keyed-capture.md
  - mage/decisions/0029-digest-to-agent-capture.md
  - mage/notes/plan-faultline.md
---

# Replay-gate methodology — does a capture mechanism produce USEFUL knowledge?

A reusable, **pre-registered, killable-by-data** test for the question that gates every mage capture
change: *does this mechanism actually surface durable, earned knowledge — or just activity/noise?*
Three capture designs were run through it (Faultline tool-transition detector, prose-keyed capture,
digest→agent); the first two were killed, the third passed the trial bar. The METHOD + its
calibration lessons are the durable, reusable asset — re-run this before flipping any capture default.

## When to use it

Before shipping (or default-enabling) ANY new detector / digest / heuristic that claims to surface
lessons. The bar is set BEFORE the run so the result can KILL the design rather than be rationalized.

## The gate, end to end

1. **Corpus + negative control.** Real multi-project ops/infra transcripts (where earned insight
   actually lives) PLUS mage's own dev logs as a NEGATIVE CONTROL. Standing set: 5 ops sessions
   (sreforge ×3, prismalens, todo-app) + 3 mage-dev control, under `~/.claude/projects/`. Adapter:
   raw Claude Code transcript → `ObserveEvent[]` (see the harness).
2. **Run the mechanism over the corpus** (the REAL shipped code, via `tsx` — not a re-implementation)
   to produce its candidates, or the digest the agent will mine.
3. **Eyeball BEFORE spending agents** (cheap, high-value — see Discipline). Confirm the known
   gold-gem source signals survive the narrowing; sanity-check counts.
4. **Judge** each candidate/extraction with a **BALANCED value judge** (see Calibration — NOT an
   adversarial refuter).
5. **Recall** per ops session against an **agent-derived GOLD gem-set** (the durable lessons a model
   finds reading the full digest): does the surfaced/confirmed set cover them?
6. **Pre-registered BAR.** e.g. *keep ≥ 1/3 → ship behind a flag; < 1/5 → kill the line.* Decide it
   before the run. Control should discriminate (not flood).
7. **Verdict.** Control-calibrated; report per-type rates. **Replay can KILL; only a LIVE
   reject-ledger can CROWN** (a replay pass only flips a flag / starts a live trial).

## Calibration lessons (the meta-finding — the most reusable part)

These were paid for in three gates and a near-miss false-kill; do not relearn them the hard way.

- **An adversarial "default-reject, be-skeptical, argue why NOT worth keeping" refuter is UNWINNABLE.**
  A capable model so instructed finds a universal solvent — "self-documenting / obvious / one-off /
  over-general" — for *any* operational lesson, and rejects everything. The digest→agent gate scored
  a false 0/0/0 this way: the miners had extracted ~all gold gems (incl. the user's own motivating
  example), and the refuter killed all 58. Do NOT use a pure adversarial refuter as the sole arbiter
  of "worth keeping."
- **A clean control proves the judge is not LENIENT — NOT that it is not UNWINNABLE.** A
  kill-everything refuter *also* yields a clean control. "Control validates the judge" is necessary,
  not sufficient. Cross-check by inspecting whether the judge KEEPS known-real gems, not just whether
  it rejects control.
- **Use a BALANCED MULTI-LENS value judge**, confirm = consensus of independent lenses, e.g.
  *forward-value* ("would an engineer joining this project be glad this note exists?") + *earned-cost*
  ("expensive-to-re-derive / hard-won the first time?") — WITH explicit reject criteria (vacuous,
  trivially-obvious, unsupported-by-evidence, one-off). Validity check: it must REJECT the genuinely
  weak items; if it keeps everything it is rubber-stamping. Inspect the reject set every time.
- **"Self-documenting ≠ worthless."** An error that prints its own fix still has *proactive-avoidance*
  value — knowing it before you hit the wall saves the whole failed round-trip. The earned-insight
  cost-to-re-derive must count the cost of HITTING and diagnosing the failure, not just applying the
  fix once you are staring at the message.
- **Beware judge framing artifacts.** A "value to THIS project" lens wrongly down-scopes lessons that
  came from OTHER projects in the corpus (it cost ~14 confirmed gems — precision floor 0.333 was
  really ~0.5). Tell the judge to score value to the session's OWN project.
- **Separate the two questions.** CAPTURE (does the mechanism surface the gems? → recall) is distinct
  from VALUE/PRECISION (are the surfaced items worth keeping? → judge). A broken refuter conflated
  them and hid that capture had succeeded. Always measure them separately.

## Discipline: cheap checks before expensive fan-out

Each of these caught a real bug BEFORE a 60–120-agent judging workflow ran:
- **Eyeball the candidates/digest** on a couple of real sessions (caught a chapterization bug that
  collapsed within-session recurrence, a protocol-filter leak — `String to replace not found` —, and
  a continuation-phrase leak — "Continue from where you left off").
- **Confirm the gold-gem source signals survive** the narrowing (grep the rendered digest for each
  known gem) before judging — recall is only meaningful if the substrate isn't lossy.
- **Verify the judge discriminates** (non-empty, sensible reject set) before trusting any keep-rate.

## The reusable harness

Under `~/ai-context/mage-prove-20260619/` (not version-controlled — the standing assets + bar):
- `*-gate-*.mts/.mjs` — replay the REAL detector/digest over the corpus via `tsx` (the adapter that
  maps raw CC transcripts → `ObserveEvent[]` is shared; reuse it).
- The Workflow gate scripts (saved under the session's `workflows/scripts/`): the shape is
  `pipeline(candidates, judge, verify)` + `parallel(recall per session)` + a verdict agent; the
  re-judge variant runs two balanced lenses with `confirm = both`. Model-sweep the *miner/extractor*
  (Opus/Sonnet/Haiku) with a FIXED judge to read the agent-agnostic degradation curve; if a weak host
  extracts as well as a strong one, the deterministic narrowing is carrying the load.

## How to run a future gate (checklist)

1. Pick corpus + control · 2. Build candidates/digest from the SHIPPED code (tsx) · 3. Eyeball +
verify gold-gem presence · 4. Set the bar (write it down) · 5. Run the judge workflow — BALANCED
multi-lens, not adversarial-default-reject · 6. Check discrimination + recall + control · 7. Verdict;
a replay pass → flag / live trial, never an immediate default-on.

## Pointers

- [ADR-0027](../decisions/0027-faultline-friction-capture-trigger.md) ·
  [ADR-0028](../decisions/0028-prose-keyed-capture.md) ·
  [ADR-0029](../decisions/0029-digest-to-agent-capture.md) — the three gated designs + their outcomes.
- [plan-faultline](plan-faultline.md) — the running record of the arc.
- The earned-insight thesis it operationalizes; the friction-trigger exploration it grew out of.
