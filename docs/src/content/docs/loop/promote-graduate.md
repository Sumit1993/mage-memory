---
title: Promote and graduate
description: The recurrence path — patterns that keep coming back become note candidates, and proven procedures graduate into loadable skills.
sidebar:
  order: 5
---

The [lesson path](./stage-groom.md) catches what is striking the *first* time you see it. The **recurrence path** catches the opposite: patterns that were never striking enough to stage once, but that kept coming back across your sessions. A deterministic engine counts that recurrence; you judge what is worth keeping.

This path has two rungs: **promote** (a recurring pattern becomes a new note candidate) and **graduate** (a proven procedural note becomes its own loadable skill).

## It counts chapters, not sessions

The unit of recurrence is the **compact-chapter** — one stretch of work between context compactions (or session ends), not a session id. This distinction is load-bearing. A session id stays constant across compaction, so if recurrence counted sessions, one long continuously-compacted chat would never accrue any. Counting chapters means even a single ongoing chat keeps building up recurrence as it compacts.

A chapter only counts toward recurrence if it carries real work: at least **two work events** (a prompt plus a tool use). That floor stops a trivial `/compact` from manufacturing a phantom recurrence unit.

## Promote: a recurring pattern becomes a note candidate

The promote engine folds every closed chapter of the captured scratch into a per-signature tally — grouped by wing and keywords, counting distinct chapters. When a signature has recurred across at least **K = 3** distinct compact-chapters **and no committed note already covers it**, it surfaces as a *new note candidate*.

The two conditions both matter:

- **At least K chapters.** "Came up in three separate chapters" is signal. "Three times in one chatty chapter" is not.
- **No covering note.** If a note already documents the pattern, there is nothing new to draft.

Promote is plumbing behind the `mage:groom` skill — you do not run it by hand. The skill runs the deterministic reader, shows you the candidates ranked strongest-first (at most a **promotion budget of 5** per pass; the rest defer), and you decide: draft a new note, merge the lesson into an existing note, or back it off as noise. Only after you disposition the batch does the watermark advance.

```bash
# (Plumbing the mage:groom skill runs for you.) Surface recurring candidates:
mage promote --json
```

Recurrence is coarse on purpose — the engine buckets, you refine. You can split one candidate that holds two lessons, or collapse two that are really one.

## Graduate: a proven note becomes a loadable skill

Some notes are not just facts but *procedures* — a playbook or a gotcha with a method to run. When such a note has itself recurred across at least **M = 5** distinct compact-chapters, it has earned its own auto-loadable skill: a `mage-skill-<slug>`. The note stays as the substrate; the skill is its pushed, auto-loaded form.

Only **procedural** notes graduate. A skill is loaded into the agent's context to *do* something, so it must be an actionable procedure — you auto-load a procedure, not a fact. Principle, reference, and interface notes carry knowledge but no method to run, so they stay notes.

Graduation is driven by the `mage:graduate` skill. It reads the same recurrence engine for graduate candidates, shows you the backing note plus the recurrence evidence, and on your confirmation mints the `mage-skill-<slug>` (in both `.claude/skills/` and `.agents/skills/`) and re-points the note at it. The note is never deleted.

## Recurrence gates graduation — not context-match

Be precise about what gates what. **Recurrence** (the K and M chapter counts) gates this whole path: it decides whether a pattern becomes a note and whether a note becomes a skill. A not-yet-graduated note loads no skill, so there is no usage signal to judge it on — recurrence is the only available evidence.

Context-match is a *different* signal that only exists *after* a skill graduates, and it governs reword and demote — never graduation. That is the next page: [Optimize](./optimize.md).

## The sensitivity dial scales K and M

K and M are not fixed forever. A single tracked **sensitivity dial** scales both recurrence gates together — and only those two. Setting it to `high` lowers the bar (fewer chapters needed to surface and graduate); `low` raises it. The default is `normal`. The quality floors (note size, edit budgets, match-rate thresholds) are not eagerness, so the dial leaves them fixed.

For the exact gate values at each dial position, see [Thresholds and the dial](../reference/thresholds.mdx).

## Nothing auto-commits

Promote drafts a candidate; graduate mints a skill and re-points a note. Neither commits. Review the diff and commit yourself once you have looked it over — mage suggests the `git` command, you run it.
