---
name: optimize
description: |
  Tighten which scenarios mage's generated skills auto-load on — the reword/demote
  half of the self-grooming loop. Fires when the user says "optimize", "are my
  skills firing right", "tune my triggers", or periodically once context-match has
  enough loads to judge. Reads the read-only context-match report
  (`mage skills --metrics --json`), and for each weak trigger judges a sharper
  one-line `description` and applies a bounded reword — or, when a skill never
  fits, a demote — by piping a Proposal to `mage dream --apply`. Nudge-invoked,
  human-confirmed, never auto-committed.
allowed-tools: Read, Grep, Glob, Bash
---

# mage:optimize — reword or demote on context-match

A generated mage skill (`mage-skill-<slug>`, `mage-wing-<x>`) auto-loads on its
frontmatter `description:` trigger. **context-match** measures whether the work
that *followed* a load actually touched that skill's wing / keywords / paths
(ADR-0016 §1) — it is the load-bearing predicate, not a usage counter. A
persistently low match rate means the trigger selects the wrong scenarios: the
skill keeps loading where it does not belong (cost with no payoff). The fix is
**reword** the trigger so it selects the right work — or, if the skill never
fits anywhere, **demote** it back to its note.

This is the host-agent stand-in for SkillOpt's held-out gate (ADR-0013 §2):
you propose a sharper trigger, the reworded skill earns a *fresh* context-match
window to prove it, and if the new trigger does worse you ratchet back. Crucially
the edits are **bounded per pass** — a textual learning rate. Only a few rewords
at a time, never a sweep; a big batch of simultaneous retriggers makes the next
window's signal unreadable.

You never write a skill directly. You construct a **Proposal JSON** and pipe it
to `mage dream --apply` — the single writer that enforces the four hard ceilings
(ADR-0016 §3): never auto-commit, never touch a bespoke hand-authored skill (only
`GEN_MARKER` generated skills are rewritten), never hard-delete (demote archives,
never `rm`), never write past a Gate-2 secret block. Detection can be wrong; the
applier is the choke point that refuses anyway.

## reword vs demote — read the row, not your gut

`mage skills --metrics --json` emits one advisory row per skill, worst-first:

```jsonc
{ "skill": "mage-skill-<slug>", "trigger_hash": "<hash>", "loads": 12, "matchRate": 0.18, "status": "demote-suggested" }
```

The deterministic `status` already did the threshold math — trust it, don't
re-derive it:

| `status` | What context-match found | Your move |
|---|---|---|
| `ok` | trigger selects the right work (or too few loads to judge — `loads < 5`) | leave it; never reword a healthy or unproven trigger |
| `reword-suggested` | matches *some* of the time (rate in the low-but-not-floor band) — the trigger is fixable | judge a sharper `description`, apply a **reword** Proposal |
| `demote-suggested` | matches almost never (rate below the floor) over enough loads — the trigger is unsalvageable | confirm, apply a **demote** Proposal |

Never act on an `ok` row, and never reword a row with too few loads — an unproven
trigger has no signal to optimize against yet.

## Steps

1. **Resolve the knowledge base.** Find the nearest `mage/metadata.json`
   (walk up). docs root = `<repo>/mage/` (in-repo) or
   `<hub_path>/projects/<project>/mage/` (external). If none, tell the user to
   run `mage init` first — there is nothing to optimize.

2. **Read the context-match report (read-only).**
   ```bash
   mage skills --metrics --json
   ```
   It folds the git-ignored `.metrics/` rollup and prints the rows above
   (worst-first). It **never** edits a skill — it only flags. If every row is
   `ok` (or there are no rows yet), nothing needs tuning: say so and stop. Skip
   any row whose `loads` are too low to judge even if it slipped through —
   optimizing noise is worse than waiting.

3. **Bound the pass (the textual learning rate).** Take only the **few worst**
   actionable rows this pass — sort is already worst-first (lowest `matchRate`,
   then most `loads`). A sensible bound is two or three rewords plus any clear
   demotes; do **not** retrigger the whole catalog at once. Each reword opens a
   fresh measurement window, and too many open windows at once make the next
   report unreadable. The rest wait for the next pass once these have re-proven.

4. **For each `reword-suggested` row — judge a sharper trigger.** Open the
   skill's `SKILL.md` (under `.claude/skills/<skill>/` and `.agents/skills/<skill>/`)
   and its backing note. Ask: *what work should this skill load on, and what is
   it currently mis-firing on?* Then write **one** new single-line `description`
   that names the real scenario tighter — the wing, the concrete task, the verbs
   a relevant prompt would use — and excludes the look-alike work it kept
   catching. Keep it one line, declarative, trigger-shaped (a "Load when …"
   clause earns its keep). Apply it as a **reword** Proposal:
   ```bash
   printf '%s' '{
     "action": "reword",
     "target": "mage-skill-<slug>",
     "payload": { "skill": "mage-skill-<slug>", "description": "<new single-line trigger>" },
     "evidence": "match-rate 0.18 over 12 loads"
   }' | mage dream --apply
   ```
   The applier rewrites **only** the frontmatter `description:` line in each dir
   the skill lives in (body byte-identical) and refuses a bespoke (non-`GEN_MARKER`)
   skill. Rewording changes the `trigger_hash` **by design**: it resets the
   context-match bucket so the *next* loads measure the new trigger, not the old
   one (ADR-0016 §1). Review the diff and commit it yourself — the applier never
   commits.

5. **Watch the fresh window, and ratchet back if worse.** A reworded trigger
   starts a clean bucket. Re-run `mage skills --metrics --json` after the next
   stretch of work; if the new trigger's rate is **worse** than the old one, the
   reword was a mistake — back it off:
   ```bash
   # 1. back off the bad reword so that exact retrigger is never re-surfaced:
   printf '%s' '<the same reword Proposal JSON>' | mage dream --reject
   # 2. restore the PRIOR trigger — a reword Proposal carrying the OLD description
   #    (you never edit a SKILL.md directly; the restore rides the applier too):
   printf '%s' '{"action":"reword","target":"mage-skill-<slug>","payload":{"skill":"mage-skill-<slug>","description":"<the PREVIOUS description, from your step-4 diff>"},"evidence":"revert: the reworded trigger did worse"}' | mage dream --apply
   ```
   `--reject` records the bad reword in the rejected-edit buffer (the back-off);
   the second `--apply` puts the original trigger back **through the single writer**
   (its `trigger_hash` returns to the prior bucket). Review the diff and commit.
   Better-or-equal: keep the reword.

6. **For each `demote-suggested` row — confirm, then demote.** A skill matching
   almost never over enough loads has earned its way *off* the auto-load
   catalog. Show the human the row (rate + loads) and the skill, and on a yes
   apply a **demote** Proposal:
   ```bash
   printf '%s' '{
     "action": "demote",
     "target": "mage-skill-<slug>",
     "payload": {},
     "evidence": "match-rate below floor over 20 loads"
   }' | mage dream --apply
   ```
   Demote **archives the skill and keeps the backing note** — the note is the
   substrate; only its pushed (auto-loaded) form retires (the reverse of
   `mage:graduate`). The ceiling holds: demote never hard-deletes — the skill is
   archived, recoverable, never `rm`-ed. The knowledge survives in the note; it
   just stops auto-loading where it never helped.

7. **Suggest the commit (never auto-run).** After applying, mage has written but
   **not** committed — that is the human gate. Suggest:
   ```bash
   git -C <repo> add -A && git -C <repo> commit -m "optimize: reword <skill> trigger"
   ```
   Review the diff first. mage never commits for you — it suggests, you run.

## Worked example — a trigger that kept mis-firing

`mage skills --metrics --json` returns (worst-first):

```jsonc
[
  { "skill": "mage-skill-redact-strip", "trigger_hash": "a1b2", "loads": 12, "matchRate": 0.33, "status": "reword-suggested" },
  { "skill": "mage-wing-billing",       "trigger_hash": "c3d4", "loads": 21, "matchRate": 0.10, "status": "demote-suggested" },
  { "skill": "mage-skill-charge-key",   "trigger_hash": "e5f6", "loads":  3, "matchRate": 0.00, "status": "ok" }
]
```

Bound the pass to the two actionable rows; the third is `ok` (only 3 loads — no
signal yet), so leave it.

**Row 1 — `mage-skill-redact-strip` (reword).** Its current trigger is broad —
*"Load when redacting or handling secrets."* — so it fires on every mention of
"secret" or "redact", including reads of the redaction *docs*, where it does no
good (rate 0.33 over 12 loads). Open the SKILL.md: the procedure is specifically
about *stripping* a flagged secret out of a drafted note before a tracked write.
Sharpen the trigger to that:

```bash
printf '%s' '{
  "action": "reword",
  "target": "mage-skill-redact-strip",
  "payload": { "skill": "mage-skill-redact-strip", "description": "How to strip a live secret out of a drafted mage note before it is written. Load when mage redact flags a secret in a note you are about to commit, not when merely reading about redaction." },
  "evidence": "match-rate 0.33 over 12 loads — fires on docs reads, not strip work"
}' | mage dream --apply
```

The applier rewrites the `description:` line in both `.claude/skills/` and
`.agents/skills/`, the `trigger_hash` flips to a new value, and the bucket is
fresh. After the next stretch of work, re-run the report: if the new rate beats
0.33, keep it; if it is worse, `mage dream --reject` the same JSON, then re-apply a
reword Proposal carrying the *old* description via `mage dream --apply` (the restore
rides the applier too — you never edit a SKILL.md by hand).

**Row 2 — `mage-wing-billing` (demote).** Rate 0.10 over 21 loads — it almost
never matches the work that follows, and 21 loads is plenty of signal. Confirm
with the human, then:

```bash
printf '%s' '{
  "action": "demote",
  "target": "mage-wing-billing",
  "payload": {},
  "evidence": "match-rate 0.10 over 21 loads — below the demote floor"
}' | mage dream --apply
```

The skill is archived (not deleted); the billing notes stay exactly where they
are and remain findable through `INDEX.md`. Then review the diff and commit. Two
edits this pass — the learning rate held.

## Quality bar

- Acts **only** on `reword-suggested` / `demote-suggested` rows with enough
  loads to judge; never touches an `ok` or under-loaded trigger.
- **Bounded per pass** — a few rewords plus clear demotes, never a catalog-wide
  retrigger; each reword opens one fresh window and too many at once blind the
  next report.
- A reword writes **one** sharper single-line `description` (one line, declarative,
  names the wing + the real task); the body is never touched.
- Trusts the applier's ceilings rather than re-checking them: only `GEN_MARKER`
  skills are rewritten, demote archives (never hard-deletes), nothing is written
  past a Gate-2 secret block, nothing is committed.
- Ratchets back a reword that does worse via `mage dream --reject`, restoring the
  prior trigger — optimization is reversible.

## See also

- **mage:graduate** (`skills/graduate/SKILL.md`) — the forward move (note →
  Procedure skill); demote is its reverse (skill → archived, note kept).
- **mage:promote** (`skills/promote/SKILL.md`) — the recurrence catch-net that
  feeds new generated skills into the catalog this skill then tunes.
- **ADR-0016** (`mage/decisions/0016-context-match-confidence-ladder-applier.md`)
  — context-match as the load-bearing predicate, the confidence ladder, the
  single-writer applier, and the four hard ceilings.
- **ADR-0013** (`mage/decisions/0013-procedure-skills-self-grooming-loop.md`) —
  the scratch → note → skill ladder and the textual-learning-rate held-out gate.
