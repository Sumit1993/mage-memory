---
type: decision
tags: [mage/decisions]
created: "2026-06-05"
updated: "2026-06-05"
last_reviewed: "2026-06-05"
status: active
provenance:
  repo: mage-memory
  work: mega-grill-skill-loop
sources:
  - src/commands/skills-cmd.ts
  - src/commands/dream-cmd.ts
  - src/scan.ts
  - skills/learn/SKILL.md
---

# 0013 — Procedure skills and the self-grooming loop

A 2026-06-05 grill-with-docs session ("mega grill") wove eight new idea-clusters
into the roadmap and resolved **how mage learns and grooms its own skills**. mage
today: `mage:learn` makes **notes**; `mage skills` generates **one awareness skill
per wing**; there is no individually-loadable procedure skill, no usage feedback,
and no optimization. Two pieces of prior art were mined: ECC's
`continuous-learning-v2` (hook-observe → confidence-scored *instincts* → `/evolve`
into skills) and Microsoft **SkillOpt** (a text-space skill optimizer: rollout →
reflect → bounded `add/delete/replace` edits → held-out validation gate). This ADR
adds the **Procedure skill** and the **self-grooming loop**, strictly inside mage's
load-bearing invariants — *no runtime of our own* ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)),
*never auto-commit*, *capture insight, not copies* ([ADR-0004](0004-capture-insight-not-copies.md)),
*durable memory, not a coordination layer* ([ADR-0010](0010-durable-memory-not-coordination-layer.md)).

## Decision

1. **Skills are graduated notes (the Procedure skill).** A proven procedural note
   (a Playbook/Gotcha) **graduates** to its own individually-loadable `SKILL.md`
   with its own trigger/`description`. The note stays the durable substrate
   ([ADR-0004](0004-capture-insight-not-copies.md)/[ADR-0006](0006-two-layer-recall-per-wing-skills.md));
   the skill is its *pushed* form. Promotion is a ladder — **scratch → note → skill**,
   each rung gated — and the reverse is **Demote** (skill → note; never hard-deleted).
   The optimization target is the trigger line: rewording it is how we make the
   agent select the skill for the *right* scenario.

2. **Optimization rides the host agent — no training loop, no model in core.**
   SkillOpt is a model-driven training loop (two model backends, epochs, labeled
   train/selection/test splits) — architecturally incompatible with ADR-0009. mage
   **borrows SkillOpt's rails** — *bounded* `add/delete/replace` edits (a "textual
   learning rate"), a **rejected-edit buffer** (negative feedback), an
   **enough-evidence** threshold, and a **held-out-style gate** — and applies them
   through a host-agent `/mage-optimize` step (human-confirmed), exactly as
   `learn`/`dream` already ride host reasoning. The **literal SkillOpt harness is
   deferred** to an optional out-of-core *bridge* (like the MCP recall accelerator),
   never in core.

3. **Usage + context-match drive promote / reword / demote.** The gate evidence is
   deterministic and model-free: a per-skill **context-match** — when the skill
   auto-loaded, did the work that followed actually touch its wing/keywords/paths? —
   computed from `mage observe` data, plus an **optional agent self-report** ("this
   skill helped / was irrelevant"). Persistently low match ⇒ reword the trigger or
   demote. This is mage's no-benchmark, no-core-model stand-in for SkillOpt's
   held-out selection score.

4. **Automation = auto-capture + human-confirm promotion, with an opt-in confidence
   ladder.** Hooks observe deterministically into the gitignored `.learnings/`
   (no model, no commit); the host agent distills candidates; promote-on-recurrence
   surfaces them; **the human confirms — and the confirm *is* the git commit**, so
   "mage never auto-commits" holds. Per-class confidence thresholds may opt low-risk
   skills into auto-*write*, but **never auto-*commit***. mage's KB is git-tracked
   and *shared*, so the commit is the natural human gate (unlike ECC's local YAML).

5. **Existing skills are adopted in place; auto-memory is a feeder.** `mage learn
   --from <dir>` ingests a user's **own** skills by assigning a wing, adding
   provenance, redacting, and minting/linking a backing note (**adopt-in-place**,
   human-confirmed in bulk) — adopting an authored skill is *remembering*, not
   *copying a source*. ECC instincts + native auto-memory enter the **same** `--from`
   path as lower-confidence **feeders** ([ADR-0005](0005-one-canonical-memory-others-are-feeders.md)).
   > **Amendment (2026-06-08, [ADR-0018](0018-mage-distill-observed-scratch-reader.md)).**
   > The **feeder half is cut**: ECC instincts + native auto-memory are **no longer
   > harvested** — foreign stores are ignored, not fed in (the duplication / format-coupling
   > argument, see ADR-0018 §8 + ADR-0005's amendment). **Adopt-in-place of the user's *own*
   > skills via the *generic* `--from` importer stands** — only the ECC/native-feeder
   > special-casing is removed.

6. **Dream is the single applier of skill mutations.** Resolves ADR-0006 §27's open
   question: promote/optimize **detect** candidates; `/dream` **applies** note↔skill
   graduation and demotion (it already owns supersede/prune file mutations). One
   mutation path into the skill catalog, not two — single-writer, no races.

7. **0.1.0 ships the full self-grooming loop; the horizon is capped at 0.1.0.** No
   1.0 is crowned in this planning horizon. **0.1.0** = founding value +
   observe → connect → distill → promote → **graduate** → `/mage-optimize`
   auto-reword + full dream sweep, all human-committed. **Deferred past 0.1.0**
   (unplanned future 0.x): the literal SkillOpt bridge, multi-repo hub
   aggregation, and the **MCP recall accelerator**.
   > **Amendment (2026-06-08, [ADR-0019](0019-mage-promote-self-grooming.md)).** **MCP
   > recall is deferred past 0.1.0** (was a numbered 0.0.x release). It is redundant with
   > file-based recall for any file-capable agent, and the only value-adding form — a
   > queried shared-memory *service* — edges into the coordination layer
   > [ADR-0010](0010-durable-memory-not-coordination-layer.md) bounds mage away from. It
   > joins the out-of-core, opt-in bridges above; build it only on real demand, with its
   > own grill. This removed the last remaining grill on the path to 0.1.0.

## Considered options

- **Skills first-class / notes secondary** — rejected: inverts ADR-0004/0006; notes
  are the durable substrate, skills the pushed recall layer.
- **Notes-only, no standalone procedure skill** — rejected: ideas 1/3/6/7 lose an
  addressable target (you can't redact/track/group/optimize a single procedure if it
  only ever rides a whole-wing umbrella).
- **Literal SkillOpt in core** — rejected: needs a model, epochs, and labeled splits;
  violates ADR-0009 (no runtime) and ADR-0001 (files-as-truth). Kept as an opt-in,
  out-of-core bridge.
- **Outcome/success scoring for "correct context"** — rejected: needs outcome labels,
  attribution is noisy, and it drags mage toward the eval-harness world it avoids.
- **Usage-count-only (pure ECC confidence)** — rejected: blind to the key insight that
  *high usage ≠ right context* — a mis-firing skill looks "popular."
- **Fully-automatic promotion (ECC background observer, no confirm)** — rejected:
  mage's KB is git-tracked + shared, so auto-promoted noise/secrets would reach
  teammates; collides with never-auto-commit.
- **Two mutation paths (optimize applies *and* dream applies)** — rejected: catalog
  churn / write races; dream-as-applier is single-writer.

## Consequences

- One new artifact (**Procedure skill**) and new verbs (**graduate**/**Demote**,
  **context-match**) — glossary ([context.md](../notes/context.md)) updated inline.
- The capture chain (observe → connect → distill → promote) gains a **skill-graduation
  rung** and an **optimize stage**; the observe `.jsonl` schema must also carry
  **skill-load events** so context-match is computable — *load-bearing*, so observe
  stays the keystone grill before anything downstream locks.
- Redaction becomes mandatory in the pipeline — split out as [ADR-0014](0014-two-gate-redaction.md).
- **Skill naming/distribution** (revised during 0.0.3 implementation, superseding the
  grill's "prefix every name with `mage-*`" idea): the hand-authored static skills
  **ship as a Claude Code plugin** (marketplace `mage`, `.claude-plugin/`), so the
  `mage:` plugin namespace does the grouping and each skill's `name:` stays **bare**
  (`mage:learn`, `mage:specify`, `mage:plan`, `mage:guide`). `mage init` prints the
  `/plugin install mage@mage` group-install (user-driven). **Generated** per-repo skills
  (`mage-wing-*`, `mage-skill-*`) keep a prefix — no plugin namespace groups them.
  Trade-off: the namespace is **Claude-Code-only**; other agents see bare names (collision
  risk) — an accepted dent in "any agent" portability, chosen for clean names + one-step
  group install. See CONVENTIONS §9.
- 0.1.0 is an ambitious, longer runway; the never-auto-commit invariant and ADR-0006's
  "promotion deferred until wings proliferate" trigger are **explicitly preserved**
  (wings proliferate across the 0.0.x ladder before the promote/optimize releases land).

## Relations

- extends [ADR-0006 — two-layer recall](0006-two-layer-recall-per-wing-skills.md) — adds the skill rung of the promotion ladder + resolves its §27 applier question
- rides [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- feeders_from [ADR-0005 — one canonical memory; others are feeders](0005-one-canonical-memory-others-are-feeders.md)
- bounded_by [ADR-0010 — durable memory, not a coordination layer](0010-durable-memory-not-coordination-layer.md)
- realizes [ADR-0004 — capture insight, not copies](0004-capture-insight-not-copies.md)
- gated_by [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md)
- mines microsoft/SkillOpt (text-space skill optimizer) + ECC `continuous-learning-v2`
- sequenced_by [release sequence](../notes/plan-release-sequence.md)
- informs [mage roadmap](../notes/roadmap.md)
