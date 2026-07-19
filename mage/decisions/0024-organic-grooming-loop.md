---
type: decision
tags:
  - mage/decisions
created: "2026-06-16"
updated: 2026-07-19
last_reviewed: 2026-07-19
status: active
provenance:
  repo: mage-memory
  work: 0.0.12-organic-grooming-loop
sources:
  - src/commands/stage-cmd.ts
  - src/commands/groom-cmd.ts
  - src/commands/nudge.ts
  - src/grooming/staging.ts
  - src/distill/reader.ts
  - src/claude-settings.ts
  - src/agents-md.ts
  - mage/notes/plan-0.0.12-organic-grooming-loop.md
  - mage/decisions/0009-no-runtime-automation-rides-host-hooks.md
  - mage/decisions/0013-procedure-skills-self-grooming-loop.md
  - mage/decisions/0018-mage-distill-observed-scratch-reader.md
  - mage/decisions/0019-mage-promote-self-grooming.md
  - cc-session:254aa0ba-a431-4d8f-8bc5-c50d001180c5
modified: 2026-07-19T17:38:49.623Z
---

# 0024 — Organic grooming loop: the lesson path (inline-primary + boundary nudge)

mage captures durable **lessons** the way Claude Code's own memory does — a short note minted
the *first* time something is worth remembering — and routes them through a judged inbox before
they become committed knowledge. This ADR records the locked 0.0.12 design. The full grill
rationale (and the rejected alternatives) lives in
[plan-0.0.12-organic-grooming-loop](../notes/plan-0.0.12-organic-grooming-loop.md); this is the
decision of record.

## Context

After 0.0.11, the live soak produced **zero note→skill graduations**. Investigation showed why:
what *recurs* across sessions is **activity** (40/40 ≥K signatures were the `workflow` lens — a
tool repeated on the same files), not **lessons**. Meanwhile Claude Code's own memory, over the
same work, minted real first-sight LESSONS (no-emojis, dogfood-before-release, branch-protected)
— and CC memory has no skill-graduation at all. So the organic win is the **lesson path**
(first-sight → note), not the procedure path (recurrence → skill). The recurrence machinery built
in 0.0.11 is fine; it was simply pointed at the wrong target.

## Decision

1. **0.0.12 ships the LESSON path** (first-sight insight → note). Note→skill **graduation (a2)
   is deferred**; the 0.0.11 recurrence tally (K/M, de-noise) is **untouched** and continues to
   serve that deferred procedure path.

2. **Three epistemic states** for a lesson, each with a distinct home:
   - `.learnings/` — raw observed scratch, deterministic, auto-pruned (ADR-0015/0018).
   - `.staging/` — **judged-but-uncommitted drafts**, git-ignored, kept OUT of the live index
     (the new third state).
   - `notes/` — committed, indexed knowledge.

3. **Inline-primary + boundary safety-net; NO embedded judge.** mage runs **no model** — the
   *judgment* ("is this a real lesson?") is always the host agent (inline) or the human (at
   groom), never code inside mage. This holds ADR-0009 ("no reasoner in the engine") and ADR-0021
   (offline / no egress); an embedded Haiku-class judge was considered and **rejected** as an
   identity change.

4. **Portable core** (any harness with a shell): `mage stage` composes a SHORT note → scrubs it
   via `redact()` (keep-context, NEVER blocks — drafts are pre-commit + git-ignored) → dedups →
   writes `.staging/<slug>.md`. `mage groom` surfaces the deduped batch; `--accept` moves drafts
   into `notes/` + re-indexes; `--reject` discards + records the key. **Anti-flood:** dedup
   (`coveringNote` vs `notes/`, the staged batch, and the reject ledger) + a **budget of 3**
   drafts per pass + the reject ledger (`.metrics/staged-rejects.json`, never re-drafts).

5. **Claude-Code adapter** (`mage nudge`, the boundary safety-net): on a **`SessionStart` with
   `source === "compact"`** it distills the just-closed chapter's `.learnings/`, drafts up to the
   budget of *forgotten* lessons into `.staging/` (re-scrubbed), and emits a one-line
   `additionalContext` nudge → `mage:groom`. It **never advances the distill watermark** (dedup
   makes a re-offered chapter idempotent; a **stable per-cluster slug** prevents two distinct
   chapters from silently colliding); it is **fail-open** (never throws to the host). Finishes
   [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) §24 step 2 (the planned-but-unbuilt
   nudge).

   - **Hook mechanism (corrected during the build):** it is `SessionStart(compact)`, **NOT** the
     originally-guessed PreCompact/SessionEnd. Verified against the Claude-Code hook docs: a
     **SessionEnd** hook's stdout is *not* injected as context (the session is ending); **PreCompact**
     fires *before* the chapter closes. `SessionStart(compact)` fires right *after* compaction —
     the only boundary where `.learnings/` is complete AND the hook's stdout becomes the new
     session's context. mage writes hooks into `settings.json` (not plugin config), sidestepping
     the plugin-hook `additionalContext` drop. (Build decisions N1–N6 are in the plan note.)

6. **Always-on inline-capture instruction** in the generated `AGENTS.md` (the inline-primary
   driver): "capture lessons inline, at first sight, via `mage stage`; batch-review at `mage:groom`".

7. **Graceful degradation** (ADR-0009 ladder): no hook adapter on a harness → inline capture, or
   manual `mage:learn` / `mage stage` — **lossless**. Nothing depends on a hook for *correctness*;
   inline reliability is a quality gradient (harness-dependent salience), not a correctness hole.

8. **Release framing:** the loop ships as **0.0.12** (bake it). ~~**0.1.0 is the announcement**~~,
   gated on **a1 = observed organic note creation in real use** — NOT an over-fit "force a
   graduation" gate. Bundled with 0.0.12: the redact false-positives fix (load-bearing because the
   loop generates more note commits).

   > **Amended 2026-07-19 — [ADR-0040](0040-versions-are-mechanical-announcement-is-named.md).**
   > The **a1 gate stands unchanged**; only its attachment to a version number is struck.
   > `release-please` bumps the minor for *any* pre-1.0 breaking change, so 0.1.0 could be — and
   > on 2026-07-19 nearly was — spent by an unrelated commit, silently. The announcement is now a
   > **named GitHub release plus an ADR recording the a1 evidence**; version numbers carry no
   > quality claim.

## Consequences

- A lesson now has a frictionless inline path AND a boundary catch for what the agent forgets,
  with a human batch-confirm before anything is committed.
- `human-confirm-is-the-commit` (ADR-0013) is **bent, not broken**: the per-note confirm becomes a
  batch confirm at `mage groom` (exactly CC memory's frictionless-write / no-commit split), with
  mage's committed-notes tier on top.
- mage stays model-free and offline (ADR-0009/0021 intact).
- New git-ignored artifacts at the docs root (`.staging/`, `.metrics/nudge-throttle.json`) — whose
  proliferation is addressed by [ADR-0025](0025-one-transient-state-home.md).

## Relations

- **finishes** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md) §24 step 2 — the
  PreCompact/SessionEnd nudge that was planned but never wired (now SessionStart-compact).
- **amends** [ADR-0013](0013-procedure-skills-self-grooming-loop.md) — the scratch→note→skill
  loop; bends "human-confirm is the commit" to a batch confirm.
- **amends** [ADR-0019](0019-mage-promote-self-grooming.md) — graduation deferred; recurrence
  machinery untouched and repurposed for the deferred procedure path.
- **relates_to** [ADR-0018](0018-mage-distill-observed-scratch-reader.md) — distill is the
  first-sight engine the nudge runs.
- **constrained_by** [ADR-0021](0021-offline-no-telemetry-local-signal.md) — offline / no
  embedded judge.
- **followed_by** [ADR-0025](0025-one-transient-state-home.md) — folds `.learnings/`/`.metrics/`/
  `.staging/` into one `.mage/` state home.
