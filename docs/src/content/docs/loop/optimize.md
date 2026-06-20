---
title: Optimize (context-match)
description: How context-match feedback rewords a mis-firing skill trigger or demotes a skill that never fits — the post-graduation tuning half of the loop.
sidebar:
  order: 6
---

Once a note [graduates](./promote-graduate.md) into a `mage-skill-<slug>`, that skill auto-loads into the agent's context whenever its trigger matches. But a trigger can be wrong — too broad, firing on look-alike work where the skill does no good. The **optimize** stage is the feedback that fixes that: it measures whether a loaded skill actually matched the work that followed, and tunes the trigger accordingly.

## Context-match: did the skill match the work?

A generated skill auto-loads on its frontmatter `description:` trigger. **Context-match** measures whether the work that *followed* a load actually touched that skill's wing, keywords, or files. It is a real predicate, not a usage counter — a skill that loads constantly but never matches the following work is pure cost with no payoff.

The match data is rolled up by a hook: `mage:metrics:Stop` runs `mage skills --metrics --quiet` at the end of each turn, folding the context-match signal into a git-ignored `.mage/metrics/` rollup. (See the [Hooks reference](../reference/hooks.mdx).) Optimize reads that rollup.

## Two moves: reword, or demote

Optimize is driven by the `mage:optimize` skill. It reads the read-only context-match report and acts on each skill's match rate. There are exactly two corrective moves, and a match-rate threshold gates each:

- **Reword** — the trigger matches *some* of the time but mis-fires on look-alike work. Triggered when the match rate falls below **0.4**. The fix is one sharper single-line `description` that names the real scenario tighter and excludes the work it kept catching wrongly.
- **Demote** — the skill matches almost never; the trigger is unsalvageable. Triggered when the match rate falls below **0.2**. Demote archives the skill and keeps the backing note. The knowledge survives; only its auto-loaded form retires. Demote is the exact reverse of graduation.

```bash
# (Plumbing the mage:optimize skill reads for you.) The read-only report:
mage skills --metrics --json
```

The report does the threshold math and emits a `status` per skill (`ok`, `reword-suggested`, or `demote-suggested`), worst-first. You trust the status rather than re-deriving the rate.

## Never judge on thin evidence

A new trigger has no signal to optimize against. So context-match only suggests a reword or demote after a skill has auto-loaded at least **5 times** (the minimum loads floor). Below that, the skill is left alone no matter its rate — optimizing noise is worse than waiting.

## Bounded per pass: a textual learning rate

Optimize applies at most **3 edits per pass**. This bound is deliberate. Each reword resets that skill's context-match bucket so the *next* loads measure the new trigger, not the old one — it opens a fresh measurement window. Too many open windows at once make the next report unreadable, and a skill that retriggers every pass thrashes instead of converging. A few rewords plus any clear demotes per pass, never a catalog-wide sweep.

A reword that does worse is reversible: you back it off and restore the prior trigger, both through the single writer.

## Keep the two gates distinct

This is the one distinction to hold onto across the whole loop:

- **Recurrence gates graduation** — how many distinct chapters a pattern recurred across decides whether a note becomes a skill. (See [Promote and graduate](./promote-graduate.md).)
- **Context-match gates reword and demote** — how well a *graduated* skill's trigger matches the following work decides whether to sharpen or retire it.

They are different signals on different sides of graduation. Recurrence has no skill-load data to read before a skill exists; context-match has no recurrence count to read after one does.

## Nothing auto-commits

A reword rewrites a `description:` line; a demote archives a skill (it never hard-deletes — the skill is recoverable, and the note is untouched). Both write through a single applier that refuses to touch a hand-authored skill, refuses to write past a secret, and never commits. Review the diff and commit yourself.
