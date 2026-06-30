---
title: Stage and groom (the lesson path)
description: The everyday lesson path — frictionless staged drafts reviewed in a deduped batch and accepted into durable notes.
sidebar:
  order: 4
---

The **lesson path** is how mage captures durable lessons the way a good memory does: a short note minted the *first* time something is worth remembering, then routed through a reviewed inbox before it becomes committed knowledge. This is the everyday path — the one most new users will use, and the one the [boundary nudge](./nudge.md) feeds into.

It has three epistemic states, each with its own home:

- `.mage/learnings/` — the raw observed scratch (from [capture](./capture.md)). Deterministic, auto-pruned, git-ignored.
- `.mage/staging/` — **judged-but-uncommitted drafts**. Git-ignored, kept out of the live index. This is the inbox.
- `notes/` — committed, indexed knowledge.

Drafts reach `.mage/staging/` from two feeders: `mage stage` (the agent composing a lesson directly — including when the [boundary nudge](./nudge.md) prompts it), and — on Claude Code — the **capture inbox**, the scrubbed native-memory writes Gate-0 drops at the docs-root top. `mage groom` ingests that inbox into staging at the start of each pass, so both feeders converge on the one batch below. See [Capture on Claude Code](./capture.md#capture-on-claude-code-the-native-memory-redirect-gate-0).

## Stage: a frictionless draft

When the agent notices a lesson during work — a correction you made, a gotcha that bit you, a rule worth keeping — it stages a short draft with `mage stage`. There is no per-draft confirmation prompt; staging is meant to be cheap so the agent captures at first sight instead of deferring. The [boundary nudge](./nudge.md) surfaces forgotten lessons at the chapter boundary for the agent to stage the same way — the nudge itself writes nothing.

A staged draft is small on purpose: one distilled fact plus a short *why* and *how*. The target size is the **soft lesson cap of 1200 characters**. It is genuinely soft — `mage stage` warns if a draft runs past it but never blocks. Frictionless capture matters more than a hard limit on a draft that you are about to review anyway. (The 1200-character lesson cap is far under the 6000-character cap on a full authored note.)

Every draft is scrubbed for secrets before it touches disk, even though `.mage/staging/` is git-ignored and pre-commit — defense in depth.

## Groom: review the batch

Staging fills the inbox; **grooming empties it.** You invoke the `mage:groom` skill (say "groom", "what did we learn", or "review the lessons", or follow the nudge's prompt). It surfaces the pending drafts as a deduped batch and asks you to keep or drop each one. Nothing is written to `notes/` without your yes — the judgment is always yours.

```bash
# Surface the pending, deduped batch:
mage groom --json

# Accept the keepers (moves them into notes/ and re-indexes):
mage groom --accept all

# Or accept some and reject the rest by slug:
mage groom --accept migration-lock-fix
mage groom --reject stale-draft-slug
```

`--accept` moves the confirmed drafts into `notes/` and re-runs `mage index` so they show up in `INDEX.md`. `--reject` discards a draft and **records its key** in the lesson reject ledger, `.mage/metrics/staged-rejects.json`, so the same lesson is never re-drafted. (This is the lesson path's ledger; do not confuse it with the recurrence path's `.mage/metrics/rejected.json`, which suppresses re-proposed recurring *signatures* — see [Promote and graduate](./promote-graduate.md).)

## How the inbox stays uncluttered

A frictionless capture stream would flood you without guards. Three anti-flood mechanisms keep the groom batch small and signal-dense:

- **Covering-note dedup.** A draft is dropped if a committed note already covers the same lesson — checked against your notes, the existing staged batch, and the reject ledger.
- **A staging budget of 3.** `mage groom` surfaces at most three drafts per pass; the rest defer to the next pass. This budget is load-bearing even when the salience bar is loose.
- **A reject buffer.** Rejecting a draft records its key, so a rejected lesson stays rejected and is not re-offered.

## Nothing auto-commits

Accepting a batch writes notes and re-indexes, but it does **not** commit. After you accept, review the diff and commit yourself:

```bash
git -C /path/to/repo add mage && git -C /path/to/repo commit -m "groom: accept lessons"
```

mage suggests the command; you run it.

## Where this sits in the loop

The lesson path is the first-sight half of the loop. The complementary half is the recurrence path — patterns that were never striking enough to stage once but kept coming back. That is the next page: [Promote and graduate](./promote-graduate.md).
