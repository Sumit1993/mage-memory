---
type: decision
tags: [mage/decisions]
created: "2026-06-06"
updated: "2026-06-06"
last_reviewed: "2026-06-06"
status: active
provenance:
  repo: mage-memory
  work: grill-observe-schema
sources:
  - ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py
---

# 0016 — Context-match, the confidence ladder, and the single applier

The 2026-06-06 grill that fixed the capture schema
([ADR-0015](0015-mage-observe-capture-schema.md)) also locked the *compute* that reads
it — the part [ADR-0013](0013-procedure-skills-self-grooming-loop.md) §3/§4/§6 named
but left open. This ADR makes "context-match," the "human-confirm → auto loosening
ladder," and "dream as the single applier" concrete and deterministic (no model in
core, [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)). It spans the
read-only metrics of 0.0.5, promote/graduate (0.0.10), optimize (0.0.11), and the
dream sweep (0.0.12).

## Decision

1. **Context-match is computed deterministically from the schema.** For each
   `skill_load` (carrying `match:{wing,keywords,paths}` + `trigger_hash`):
   - **Window:** the next **N = 20** `tool_use`/`user_prompt` events, or until
     `session_end`/`compact`, whichever first. (Skills accumulate, so "until next
     load" is wrong; a bounded forward window handles overlapping active skills.)
   - **Predicate (per load → boolean hit):** the work **touches** the spec if *any*
     dimension matches — some `tool_use.paths[]` hits a `match.paths` glob, **or** some
     `user_prompt.text`/`tool_use.detail` contains a `match.keywords` term
     (case-folded, word-boundary), **or** a touched path resolves (via `repo_root`) to
     `match.wing`. OR-semantics, **but record which dimension(s) fired** so optimize can
     reword the dead dimension.
   - **Score:** `context_match_rate(skill, trigger_hash) = matched_loads / total_loads`,
     plus an optional tallied agent self-report. Persistently low rate
     (`< 0.4` over `≥ M` loads) ⇒ reword the trigger or demote. Keying on
     `trigger_hash` is what makes optimize's held-out comparison (rate(A) vs rate(B))
     valid. **No outcome/success scoring** (ADR-0013 already rejected it — needs labels,
     noisy attribution): purely "did the work touch the declared context."
   - Runs as 0.0.5's read-only metrics; consumed by 0.0.10/0.0.11.

2. **Metrics never enter git — only the mutations they motivate do.** The tally is a
   **derived, gitignored, purge-exempt rollup** (`mage/.metrics/`), one record per
   `(skill, trigger_hash)`: `{loads, matches, dim_breakdown, self_reports, last_seen}`,
   recomputable from extant raw events. Raw events purge freely; the tiny rollup
   persists. This rejects ECC's frontmatter-stored `confidence:` (our KB is
   git-tracked + *shared*, so stats in frontmatter = uncommitted churn + statistical
   noise in history). The three layers stay clean: **raw events (gitignored, purge) →
   rollup (gitignored, persist, local) → mutations (tracked, human-committed)**.
   Recency is a feature — aged-out events naturally weight recent firing behaviour.

3. **The confidence ladder loosens on *human-approval recurrence*, per mutation-class,
   with hard ceilings.** Two signals feed it — **recurrence/confidence** (is the pattern
   real? → promote) and **context-match** (does it fire right? → reword/demote); neither
   alone auto-acts.
   - **Rung A — propose-only (cold start):** the human confirms every mutation.
   - **Rung B — auto-write / human-commits (earned):** a mutation *class* loosens to
     auto-write the file (uncommitted) once the human has approved that class **≥ K
     times** AND the target is a **GENERATED** skill AND the mutation is **reversible +
     low-blast** (reword, demote). The diff still waits at the commit.
   - mage loosens on the *human's track record of saying yes*, not on raw pattern
     frequency (ECC's model); the **rejected-edit buffer** ratchets it back on
     rejection — self-correcting, human-governed.
   - **Hard ceilings — never loosen at any rung:** **never auto-commit** (the commit is
     *the* human gate), **never touch a bespoke hand-authored skill** (auto-write only
     rewrites GENERATED — resolves the 0.0.10 clobber tension), **never hard-delete**
     (demote/archive only), **never auto-write past a Gate-2 block**. Promote (new
     shared content) may auto-write a *draft* once earned but leans hardest on the
     commit review and the Gate-2 block.

4. **Dream is the single applier; detection only proposes.** Resolves ADR-0013 §6.
   - **"Dream" names the applier *module*** — the one piece of code that mutates the
     skill catalog (graduate, demote, reword) plus the note mutations it already owns
     (supersede, consolidate, prune, archive) — not merely the scheduled sweep.
   - **Detection never touches `skills/`.** promote/optimize emit **proposals**
     `{action, target, payload, evidence}` into a gitignored, local proposal queue
     (same storage philosophy as the rollup). They decide *what*, never *write*.
   - **Two trigger paths, one applier:** an auto-approved reword does *not* mean
     optimize writes the file — the proposal is auto-approved and optimize **invokes the
     dream applier** to apply it now; the scheduled 0.0.12 sweep invokes the *same*
     applier for pending work. Both funnel through one serialized writer → no races.
   - **The applier is the single choke point that enforces the §3 ceilings.** Even an
     auto-approved or mis-detected proposal that would hit a bespoke skill, hard-delete,
     or carry a live secret is **refused at apply time**. Detection can be wrong; the
     one writer is the last invariant gate. Rejected proposals feed the rejected-edit
     buffer (§3).

```
promote/optimize ──proposal──▶ [ladder: human-confirm OR auto-approve] ──▶ dream applier ──▶ file mutation ──▶ human commits
   (detect what)                    (gate: who confirms)                   (the ONE writer,        (tracked diff)
                                                                            enforces ceilings)
```

## Considered options

- **All-time tally / store in frontmatter (ECC)** — rejected: tracked churn + history
  noise + worse recency than the natural event-purge window.
- **Loosen on pattern-recurrence (ECC)** — rejected: blind to whether the *human* trusts
  the mutation; approval-recurrence keeps the human governing the automation itself.
- **Let optimize write the catalog directly** — rejected: a second writer races the
  scheduled sweep; one applier module serializes all mutations.
- **Enforce ceilings in detection** — rejected: detection is pluggable and can be wrong;
  the single writer must be the last gate.

## Consequences

- 0.0.5 ships the read-only context-match compute + `mage/.metrics/` rollup; 0.0.10/11
  gate on it; 0.0.12's sweep shares the applier.
- New local, gitignored artifacts (rollup, proposal queue, rejected-edit buffer) that
  never commit; the never-auto-commit invariant is enforced *in the applier*.
- Bespoke vs GENERATED is now a hard automation boundary the applier checks.

## Relations

- extends [ADR-0013 — procedure skills + the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) — realizes §3 (context-match), §4 (ladder), §6 (applier)
- reads [ADR-0015 — the capture schema](0015-mage-observe-capture-schema.md)
- rides [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- gated_by [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md) — the Gate-2 block the applier honours
- mines ECC `continuous-learning-v2` (confidence model) + Microsoft SkillOpt (held-out gate, rejected-edit buffer)
- sequenced_by [release sequence](../notes/plan-release-sequence.md)
