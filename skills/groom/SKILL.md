---
name: groom
description: |
  Groom mage's own observed scratch (`.learnings/*.jsonl`) into durable notes —
  the judgment tier of the self-grooming loop. Runs the two deterministic engines
  in sequence: `mage distill` (FIRST SIGHT — a striking insight earns a note the
  first time it is seen) then `mage promote` (RECURRENCE — a pattern that kept
  coming up across distinct sessions but was never striking enough to capture
  once). Fires at session boundaries, after a PreCompact, or when the user says
  "groom", "distill", "promote", "mine the learnings", "what did we learn", or
  "what keeps coming up". Judges candidates through the shared capture pipeline,
  routes proven notes to `mage:graduate`. Nudge-invoked, not user-only.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# mage:groom — mine the observed scratch into notes

`mage observe` writes a scratch record of every session to mage's own
`.learnings/*.jsonl` (the ADR-0015 schema). **groom turns that scratch into
durable notes.** It is the back half of the loop `mage:learn` serves, fired once
a stretch of work has closed: `learn` captures *this one finding now*; `groom`
mines *the accumulated record*.

groom is the **judgment tier** over two deterministic engine readers — **no
model lives in mage** (ADR-0009). The engines count and cluster; you decide what
is note-worthy. They run in sequence, catching durable knowledge through two
complementary gates:

- **Phase 1 — first sight (`mage distill`)** — a single vivid finding earns a
  note the *first* time it is seen.
- **Phase 2 — recurrence (`mage promote`)** — a pattern that recurred across
  **≥ K distinct sessions** with no covering note, that no single sighting was
  striking enough to capture. Catches the slow-burn Phase 1 misses.

Notes are the reusable **insight + procedure + pointers**, never a copy of the
source (see `CONVENTIONS.md`). groom mines **only mage's own** `.learnings/` —
foreign memory stores (ECC instincts, Claude `MEMORY.md`) are not harvested
(ADR-0018 §8).

## Step 0 — Resolve the knowledge base (once, for both phases)

Find the nearest `mage/metadata.json` (walk up). docs root = `<repo>/mage/`
(in-repo / hybrid) or `<hub_path>/projects/<project>/mage/` (external). If none,
tell the user to run `mage init` first — there is nothing to groom into. **At a
hub root** the engines groom the hub's own `.learnings/` AND fan out to every
registered project (pass `--root-only` to scope to just the hub's own notes).

---

## Phase 1 — first sight (`mage distill`)

1. **Run the deterministic reader.**
   ```bash
   mage distill --json
   ```
   It reads mage's own `.learnings/*.jsonl` from the **last watermark forward**,
   chops un-distilled events at `compact`/session boundaries (the natural
   "chapters"), keeps only salient events, and emits a `DistillManifest`:
   ```jsonc
   {
     "clusters": [ /* candidate clusters, each with salient signals */ ],
     "cursors":  { "<session>": <offset>, … },  // advance these in step 3
     "capped":   false                          // true ⇒ output was capped
   }
   ```
   Only **closed** segments are offered (up to the last `compact`/`session_end`);
   the in-flight session is never half-distilled. If `clusters` is empty, there is
   nothing new on first sight — move to Phase 2. A failed read fails open to empty.

2. **Judge each cluster through the four lenses — *led by user corrections*.**
   For every cluster, weigh these in order (the reader flags the signals; you
   reason over them):

   | Lens | What it looks like in the cluster | mage note-type |
   |---|---|---|
   | **① User corrections & nudges** *(first-class — look here first)* | a `user_prompt` right after an agent action: "no, do it this way", "actually I meant…", a steer or a standing rule | `principle` / `gotcha` |
   | **② Error → fix** | a `tool_use` with `ok:false` followed by the fix that worked | `gotcha` |
   | **③ Repeated workflow** | the same tool sequence run several times | `playbook` |
   | **④ Tool / approach preference** | a consistent tool or approach choice | `playbook` / `principle` |

   **Direct human feedback is the highest-signal durable knowledge** — a user
   correction is a standing intent the agent should never relearn, so it outranks
   a one-off stack trace. You may **split** a cluster holding two unrelated
   insights or **merge** clusters that are really one; the reader's chunking is
   mechanical scaffolding, not a verdict. Drop routine clusters with no lesson.
   Capture **on first sight** — do not wait for a recurrence here (that is Phase 2).

3. **For each kept insight, run the SHARED CAPTURE PIPELINE** (the same back half
   `mage:learn` defines — see that skill's **Steps**; do not re-derive it):
   classify (`type` + wing + room → `#<wing>/<room>`), overlap-check vs `INDEX.md`
   (UPDATE / NEW / supersede; dedup within the batch), **redaction Gate 2**
   (`mage redact <draft-file>` — a LIVE secret, non-zero exit, STOPS that one
   note; strip with `mage redact --strip` or remove by hand), show the human, and
   write under `mage/notes/` only after a yes.

4. **Advance the Phase-1 watermark — only after the human dispositions the batch.**
   ```bash
   mage distill --seen <session>:<offset>   # one per session, from manifest.cursors
   ```
   This moves mage's per-session bookmark **past everything the human just
   reviewed** — kept notes *and* skipped clusters (advancing past a skip is
   distill's negative memory). The reader is a pure read; **`--seen` is the only
   thing that moves the bookmark.** An interrupted run that never reaches this step
   does no harm: a re-run safely re-offers, and the overlap-check dedupes. If
   `manifest.capped` is `true`, tell the user the output was capped and that
   re-running continues from the new watermark to drain the rest.

---

## Phase 2 — recurrence (`mage promote`)

Phase 1 captures first sight. **Phase 2 is the catch-net for everything it
missed:** patterns that recurred across sessions but were never striking enough
to note once.

5. **Run the deterministic recurrence reader.**
   ```bash
   mage promote --json
   ```
   It folds every CLOSED `.learnings/` segment from the last watermark forward
   into a per-`(wing + keywords)` signature tally (distinct-session counts,
   never-regress, survives the raw-event purge), persists the tally, and emits a
   `PromoteManifest`:
   ```jsonc
   {
     "proposals": [
       { "action": "note"|"graduate", "target": "…", "payload": {…}, "evidence": "…" }
     ],
     "cursors": { "<session>": <offset>, … },  // advance these in step 8
     "covered": <n>                            // signatures ≥ K already covered (info)
   }
   ```
   Recurrence counts **distinct sessions**, never raw hits (ADR-0019 §2): "came up
   in 3 separate sessions" is signal; "3 times in one chatty session" is not. If
   `proposals` is empty, there is nothing recurring uncovered — say so and stop.

6. **Split the manifest by action.**
   - Route every `action: "graduate"` proposal (a covered, proven playbook/gotcha
     note recurring ≥ M sessions, earning its own loadable skill) to
     **`mage:graduate`** — point at it, don't re-implement. Never graduate here.
   - Keep the `action: "note"` proposals (a recurring signature with no covering
     note — the catch-net's own job) for the next steps.

7. **Judge each `note` candidate's durability, then disposition it.** The
   signature is **coarse on purpose** — the fold buckets, you refine. Drop
   recurring *noise* (the same routine command carrying no insight); collapse two
   candidates that are one lesson; split one that holds two. Lead with the
   human-feedback signals (a `correction` that recurs is standing intent and
   outranks a repeated stack trace). Then:
   - **NEW note → draft it through the shared `mage:learn` capture pipeline**
     (classify → overlap-check → Gate 2 → confirm → write), seeded from the
     proposal's `payload.wing` / `payload.keywords` / `payload.hint` + the
     recurrence `evidence`.
   - **Extends an existing note → a `merge` Proposal** through the single writer
     (prefer this over a new file when the lesson belongs to an existing note —
     it keeps the base small early, ADR-0019 §6):
     ```bash
     printf '%s' '{"action":"merge","target":"notes/<file>.md","payload":{"note":"notes/<file>.md","addition":"<markdown to append>","keywords":["…"]},"evidence":"recurred in N sessions: …"}' | mage dream --apply
     ```
   - **Not durable → back it off** so it won't be re-surfaced:
     ```bash
     printf '%s' '<the note Proposal JSON>' | mage dream --reject
     ```

8. **Advance the Phase-2 watermark — only after the human dispositions the batch.**
   ```bash
   mage promote --seen <session>:<offset>   # one per session, from manifest.cursors
   ```
   **`--seen` is the ONLY thing that moves the bookmark** — the read path is pure.
   A re-run safely re-offers, the overlap-check dedupes, and `--reject`'d
   candidates stay backed off.

---

## Step 9 — Suggest follow-ups (never auto-run)

```bash
mage index          # refresh INDEX.md so the new notes are findable
git -C <repo> add mage && git -C <repo> commit -m "groom: <n> notes"
```
mage never commits for you — it suggests, you run.

## Quality bar

- Phase 1 leads with **user corrections** and standing intent, not error-fix volume.
- Phase 2 counts **distinct sessions**, never raw hits; drafts only for a recurring
  pattern with **no covering note**; prefers a `merge` over a new file early.
- Every draft passes the same capture pipeline as `mage:learn` — classify,
  overlap-check, **Gate 2**, human confirm. Captures *insight + procedure +
  pointers*; points to canonical sources, never mirrors them.
- Routes `graduate` proposals to `mage:graduate`; never graduates here.
- Watermarks advance **only** on explicit disposition; re-runs are safe.

## See also

- **mage:learn** (`skills/learn/SKILL.md`) — the shared capture pipeline
  (classify → overlap-check → Gate 2 → confirm → write) both phases funnel into.
- **mage:graduate** (`skills/graduate/SKILL.md`) — where Phase 2 hands
  `action: "graduate"` proposals (note → Procedure skill).
- **ADR-0018** (`mage/decisions/0018-mage-distill-observed-scratch-reader.md`) —
  distill as deterministic reader + judgment skill; first-sight capture; CLOSED-only
  watermark; mage reads only its own artifacts.
- **ADR-0019** (`mage/decisions/0019-mage-promote-self-grooming.md`) — the
  recurrence tally, distinct-session counting, the K/M thresholds, and the
  note/graduate ladder rungs.
- **ADR-0015** (`mage/decisions/0015-mage-observe-capture-schema.md`) — the
  `.learnings/*.jsonl` event schema the readers consume.
- **ADR-0014** (`mage/decisions/0014-two-gate-redaction.md`) — `mage redact`
  Gate 2 before any tracked write.
