---
title: Promote and graduate
description: The graduation path — proven procedures that see continued usage graduate into loadable skills.
sidebar:
  order: 5
---

The [lesson path](./stage-groom.md) catches what is striking the *first* time you see it. The **graduation path** catches the opposite: lessons that have proven themselves through continued usage. A deterministic engine counts that usage; you judge what is worth graduating.

While the command is still named `mage promote` for historical reasons, it now exclusively drives **graduation** — when a proven procedural note earns its own auto-loadable skill. (An older version of this path used to propose new notes based on keyword recurrence; that was deleted in ADR-0038 because deterministic note-selection proved too noisy.)

## It counts chapters, not sessions

The unit of usage is the **compact-chapter** — one stretch of work between context compactions (or session ends), not a session id. This distinction is load-bearing. A session id stays constant across compaction, so if usage counted sessions, one long continuously-compacted chat would never accrue any. Counting chapters means even a single ongoing chat keeps building up usage as it compacts.

A chapter only counts toward usage if it carries real work: at least **two work events** (a prompt plus a tool use). That floor stops a trivial `/compact` from manufacturing a phantom usage unit.

## Graduate: a proven note becomes a loadable skill

Some notes are not just facts but *procedures* — a playbook or a gotcha with a method to run. When the file for such a note is **read** across at least **M = 5** distinct compact-chapters, it has earned its own auto-loadable skill: a `mage-skill-<slug>`. The note stays as the substrate; the skill is its pushed, auto-loaded form.

Only **procedural** notes graduate. A skill is loaded into the agent's context to *do* something, so it must be an actionable procedure — you auto-load a procedure, not a fact. Principle, reference, and interface notes carry knowledge but no method to run, so they stay notes.

Graduation is driven by the `mage:graduate` skill. It reads the deterministic engine for graduate candidates, shows you the backing note plus the usage evidence, and on your confirmation mints the `mage-skill-<slug>` (in both `.claude/skills/` and `.agents/skills/`) and re-points the note at it. The note is never deleted.

```bash
# (Plumbing the mage:graduate skill runs for you.) Surface graduate candidates:
mage promote --json
```

## Note-read usage gates graduation

Be precise about what gates what. **Note-read usage** (the M chapter counts) gates graduation. A not-yet-graduated note loads no skill, so the only usage signal available is how often the agent independently reaches for the note's markdown file while working. The deterministic engine (`mage promote`) counts those distinct reads.

Context-match is a *different* signal that only exists *after* a skill graduates, and it governs reword and demote — never graduation. That is the next page: [Optimize](./optimize.md).

## The sensitivity dial scales M

M is not fixed forever. A single tracked **sensitivity dial** scales the graduation gate. Setting it to `high` lowers the bar (fewer chapters needed to graduate); `low` raises it. The default is `normal`. The quality floors (note size, edit budgets, match-rate thresholds) are not eagerness, so the dial leaves them fixed.

For the exact gate values at each dial position, see [Thresholds and the dial](../reference/thresholds.mdx).

## Nothing auto-commits

Graduate mints a skill and re-points a note. Neither commits. Review the diff and commit yourself once you have looked it over — mage suggests the `git` command, you run it.
