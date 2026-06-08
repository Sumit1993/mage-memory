---
name: promote
description: |
  Catch the slow-burn that distill's first-sight missed — a pattern that kept
  coming up across several distinct sessions with no note covering it, and
  graduate the proven notes. Fires at session boundaries, after `mage:distill`,
  or when the user says "promote", "what keeps coming up", or "any recurring
  patterns". Runs the deterministic recurrence reader (`mage promote --json`),
  judges each `note` candidate's durability, drafts keepers through the shared
  `mage:learn` capture pipeline (or folds them into an existing note via a merge
  Proposal), and hands `graduate` candidates to `mage:graduate`. Nudge-invoked,
  not user-only.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# mage:promote — the recurrence catch-net (scratch → note)

`mage observe` writes a scratch record of every session to mage's own
`.learnings/*.jsonl`. `mage:distill` mines that scratch **on first sight** — one
striking insight earns a note the first time it is seen. **promote is the other
half: recurrence over time.** It folds *every* closed segment (including the ones
distill skipped) into a per-`(wing + keywords)` signature tally that survives the
raw-event purge, and surfaces the patterns that **kept coming up** but were never
striking enough to capture once.

- **distill = first sight** — a single vivid finding, captured now.
- **promote = recurrence** — a pattern that recurred across **≥ K distinct
  sessions** (counting is distinct-session, ADR-0019 §2 — "came up in 3 separate
  sessions" is signal; "3 times in one chatty session" is not) with **no covering
  note** (the same `keywords`/`wing`/`paths` context-match distill uses).

This skill is the judgment tier over a deterministic fold. The reader counts; you
decide what is durable. It surfaces **two** kinds of candidate:

- `action: "note"` — a recurring signature with no covering note. **This skill
  drafts the note** (the catch-net), or folds the lesson into an existing note via
  a `merge` Proposal.
- `action: "graduate"` — a covered, proven playbook/gotcha note that recurred ≥ M
  sessions and has earned its own loadable Procedure skill. **Hand these to
  `mage:graduate`** — do not duplicate that flow here.

Notes are the reusable **insight + procedure + pointers**, never a copy of the
source (see `CONVENTIONS.md`). promote folds **only mage's own** `.learnings/` —
foreign memory stores (ECC instincts, Claude `MEMORY.md`) are not harvested
(ADR-0018 §8).

## Steps

1. **Resolve the knowledge base.** Find the nearest `mage/metadata.json` (walk
   up). docs root = `<repo>/mage/` (in-repo) or
   `<hub_path>/projects/<project>/mage/` (external). If none, tell the user to run
   `mage init` first — there is nothing to promote into.

2. **Run the deterministic recurrence reader.**
   ```bash
   mage promote --json
   ```
   It folds every CLOSED `.learnings/` segment from the last watermark forward
   into the per-signature tally (distinct-session counts, never-regress), persists
   the derived tally, and emits a `PromoteManifest`:
   ```jsonc
   {
     "proposals": [
       { "action": "note"|"graduate", "target": "…", "payload": {…}, "evidence": "…" }
     ],
     "cursors": { "<session>": <offset>, … },  // advance these in step 6
     "covered": <n>                            // signatures ≥ K already covered (info)
   }
   ```
   - A `note` proposal: `target` is a signature key, `payload` is
     `{wing, keywords, hint}` — a recurring pattern with no covering note.
   - A `graduate` proposal: `target` is a note relPath, `payload` is
     `{note, wing, type}` — a covered, proven playbook/gotcha recurring ≥ M sessions.

   If `proposals` is empty, there is nothing new — `covered` tells you how many
   recurring signatures are already covered by notes. Say so and stop.

3. **Split the manifest by action.**
   - Route every `action: "graduate"` proposal to **`mage:graduate`** — point at
     it, don't re-implement. (That skill confirms the backing note + applies the
     graduate Proposal through `mage dream --apply`.)
   - Keep the `action: "note"` proposals for the next steps.

4. **Judge each `note` candidate's durability.** The signature is **coarse on
   purpose** — the fold buckets, you refine. For each proposal, weigh:
   - Is this a *durable* lesson, or recurring noise (the same routine command that
     carries no insight)? Drop the noise.
   - Are two candidates really **one** lesson under different keywords? Collapse
     them. Does one candidate hold **two** unrelated lessons? Split them.
   - Does it **extend an existing note** in the same wing, or is it genuinely
     **NEW**? (The overlap-check in the next step settles this — but note your
     lean now.)

   Lead with the human-feedback signals: a `correction` lens that recurs ("you
   keep steering me about X") is standing intent and outranks a repeated stack
   trace.

5. **Disposition each kept candidate.**

   - **NEW note → draft it through the shared `mage:learn` capture pipeline.** Do
     not re-derive that pipeline here — follow `mage:learn`'s **Steps**: classify
     (`type` + wing + room → `#<wing>/<room>`), overlap-check vs `INDEX.md`,
     redaction **Gate 2** (`mage redact <draft-file>` — a LIVE secret, non-zero
     exit, STOPS that one note; strip with `mage redact --strip` or remove by
     hand), show the human, write under `mage/notes/` only after a yes. Seed the
     draft from the proposal's `payload.wing` / `payload.keywords` / `payload.hint`
     and the recurrence `evidence`.

   - **Extends an existing note → construct a `merge` Proposal** and apply it
     through the single writer:
     ```bash
     printf '%s' '{"action":"merge","target":"notes/<file>.md","payload":{"note":"notes/<file>.md","addition":"<markdown to append>","keywords":["…"]},"evidence":"recurred in N sessions: …"}' | mage dream --apply
     ```
     The applier folds the addition into the note, honors the ceilings (Gate-2
     secret-block, GEN_MARKER bespoke-guard, never-hard-delete), and **never
     commits**. Prefer merge over a brand-new file when the lesson belongs to an
     existing note — this is the one explicit lever that keeps the base small early
     (ADR-0019 §6).

   - **Reject a candidate that is not durable → back it off** so it won't be
     re-surfaced:
     ```bash
     printf '%s' '<the note Proposal JSON>' | mage dream --reject
     ```

6. **Advance the watermark — only after the human dispositions the batch.**
   ```bash
   mage promote --seen <session>:<offset>   # one per session, from manifest.cursors
   ```
   Use the offsets from `manifest.cursors`. **`--seen` is the ONLY thing that
   moves the bookmark** — the read path is pure. Run it once per session after the
   human has reviewed the batch (the notes you wrote, the merges you applied, and
   the candidates they skipped — advancing past a skipped candidate is promote's
   negative memory). An interrupted run that never reaches this step does no harm:
   a re-run safely re-offers, the overlap-check dedupes anything already written,
   and the rejected buffer keeps backed-off candidates down.

7. **Suggest follow-ups (never auto-run):**
   ```bash
   mage index          # refresh INDEX.md so the new notes are findable
   git -C <repo> add mage && git -C <repo> commit -m "promote: <n> notes"
   ```
   mage never commits for you — it suggests, you run.

## Worked example — a recurring mechanical pattern → a `playbook` note

Across three separate debugging sessions you reached for the same rebuild-then-
restart dance, never once thinking it note-worthy in the moment. distill never
caught it (no single sighting was striking). promote does — the signature crossed
K. Suppose `mage promote --json` returns:

```jsonc
{
  "proposals": [
    {
      "action": "note",
      "target": "svc-api::cache,redis,restart",
      "payload": {
        "wing": "svc-api",
        "keywords": ["cache", "redis", "restart"],
        "hint": "flush redis then restart the worker before the cache test passes"
      },
      "evidence": "recurred in 3 sessions (workflow×3): flush → restart → re-run"
    }
  ],
  "cursors": { "2026-06-08T09-10": 7, "2026-06-08T14-02": 4, "2026-06-09T11-30": 6 },
  "covered": 5
}
```

This is a repeated **workflow** with no covering note — the catch-net's job. Judge
it durable (a real procedure, not noise), then draft a NEW `playbook` note through
the `mage:learn` pipeline — classify (`type: playbook`, wing `svc-api`, room
`cache` → `#svc-api/cache`), overlap-check against `INDEX.md`, run
`mage redact` on the draft, show the human:

```markdown
---
type: playbook
tags: [svc-api/cache]
created: 2026-06-09
last_reviewed: 2026-06-09
provenance: { repo: <repo>, work: promote-2026-06-09 }
status: active
---

# Flush Redis before the cache integration test

The cache test reads a stale value unless Redis is flushed AND the worker is
restarted first — recurred across three sessions. Run, in order:

1. `redis-cli flushdb`
2. restart the worker (`pnpm svc:api restart`)
3. re-run the cache suite

Skipping the restart leaves the worker holding the old connection pool, so the
flush looks like it did nothing.

## Relations
- relates_to [svc-api topology](../svc-api/topology.md)
```

Write on confirm, then advance every session's watermark:

```bash
mage promote --seen 2026-06-08T09-10:7
mage promote --seen 2026-06-08T14-02:4
mage promote --seen 2026-06-09T11-30:6
```

Had the manifest instead carried an `action: "graduate"` proposal (a proven note
recurring ≥ M sessions), you would have handed it to `mage:graduate` rather than
drafting anything here.

## Quality bar

- Counts **distinct sessions**, never raw hits — recurrence across sessions is the
  signal, repetition within one session is not.
- Drafts a note only for a recurring pattern with **no covering note**; prefers a
  `merge` Proposal when the lesson extends an existing note (keeps the base small
  early).
- Routes `graduate` proposals to `mage:graduate`; never graduates here.
- Every draft passes the same capture pipeline as `mage:learn` — classify,
  overlap-check, Gate 2, human confirm.
- The watermark advances **only** on explicit disposition; rejected candidates go
  to `mage dream --reject` so they back off; re-runs are safe.

## See also

- **mage:learn** (`skills/learn/SKILL.md`) — the shared capture pipeline
  (classify → overlap-check → Gate 2 → confirm → write) NEW notes funnel into.
- **mage:distill** (`skills/distill/SKILL.md`) — the first-sight sibling; promote
  catches the slow-burn distill's single-sighting heuristic misses.
- **mage:graduate** (`skills/graduate/SKILL.md`) — where this skill hands
  `action: "graduate"` proposals (note → Procedure skill).
- **ADR-0019** (`mage/decisions/0019-mage-promote-self-grooming.md`) — the
  recurrence tally, distinct-session counting, the K/M thresholds, and the
  note/graduate ladder rungs this skill drives.
