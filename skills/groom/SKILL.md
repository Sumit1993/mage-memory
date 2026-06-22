---
name: groom
description: |
  Groom mage's own observed scratch (`.mage/learnings/*.jsonl`) into durable notes —
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
`.mage/learnings/*.jsonl` (the ADR-0015 schema). **groom turns that scratch into
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

**Phase 0 — pending inline drafts (`mage groom`, 0.0.12).** Before the two mining
phases, dispose of lessons captured INLINE during work. `mage stage` parks short,
redacted drafts in `.mage/staging/` with no per-note confirm (and the boundary nudge
distills forgotten ones there too); your job is the batch human-confirm:

- `mage groom --json` surfaces the pending, deduped batch (capped at the staging
  budget; the rest defer). For each draft, keep / edit / drop it.
- `mage groom --accept <slugs|all>` moves the kept drafts into `notes/` and
  re-indexes; `mage groom --reject <slugs|all>` discards them and records the
  rejection so the same lesson is never re-drafted.

These drafts are the freshest, highest-signal material (the agent chose to stage
them) — clear them first, THEN run the mining phases below for what inline capture
missed. (`mage groom` the COMMAND manages `.mage/staging/`; the two phases below are the
deeper `.mage/learnings/` mining that the `mage:groom` SKILL also runs.)

Notes are the reusable **insight + procedure + pointers**, never a copy of the
source (see `CONVENTIONS.md`). groom mines **only mage's own** `.mage/learnings/` —
foreign memory stores (ECC instincts, Claude `MEMORY.md`) are not harvested
(ADR-0018 §8).

## Autonomous mode (Approver / Overseer)

By default this skill is **Operator** mode (HITL): you draft each note, show the
human, and write **only after a yes** (Step 3 / Step 7). That per-note confirm is
unchanged at Operator.

When the boundary nudge invokes groom under an **Approver** or **Overseer**
mandate (ADR-0030 — it reads `metadata.json → grooming.autonomy` and templates the
mandate into the session), that per-note "write only after a yes" prompt is
**WAIVED**. This does not break the loop's floor: the human's confirm has not
vanished, it has **relocated to the batch `git commit`** — ADR-0013's invariant
that *the commit IS the yes*. So in autonomous mode you write without pausing per
note, and the human reviews the resulting diff and commits (or `git revert`s) once.

The floor never moves, at either level:

- **Gate-2 redaction (ADR-0014) still runs before EVERY write** — a LIVE secret
  on a draft still stops that one note, exactly as in Operator mode. Autonomy
  waives the *human prompt*, never the redaction gate.
- **Writes land UNCOMMITTED in the working tree.** mage never commits (ADR-0009).
  The uncommitted diff is the review surface; the commit is the human's "yes".
- Hold the same **quality bar** as a confirmed write — lead with user corrections,
  prefer a `merge` over a new file early, keep notes to insight + procedure +
  pointers. The waived prompt is convenience, not a lowered value-bar.

**Stamp every autonomous write — the reject-ledger depends on it.** A note you write
under an Approver or Overseer mandate (never at Operator, never a human-confirmed
note) gets one extra field in its `provenance:` block marking it agent-written:

```yaml
provenance:
  autonomy: overseer   # the mandate level that wrote it — `approver` or `overseer`
```

This is the attribution the crown signal needs (ADR-0030's live reject-ledger): a
kept note survives in `git`, a wrong one is `git revert`ed or discarded, so the
keep-vs-revert ratio per level becomes a deterministic scan over stamped notes — no
guessing which notes the agent authored. Add only that field; the note's existing
`created` date carries the timing, and a later `mage ledger` (Tier 1, ADR-0031) will
read the stamp rather than re-derive authorship.

**Approver** — groom the backlog and write the **clearly-durable** notes straight
into the working tree (run Phase 1 / Phase 2 below, but write the keepers without
the per-note prompt); leave anything **borderline** staged in `.mage/staging/` for
a later human pass; run `mage index`. Do **not** graduate.

**Overseer** — everything Approver does, **plus** dispose the borderline tier
(write or `--reject` it rather than leaving it staged), merge lessons into existing
notes, and **graduate** eligible notes — route every `action: "graduate"` proposal
through **`mage:graduate`** as always (recurrence-gated ≥ M, commit-gated). Never
graduate inline here; the routing is unchanged, only the per-note pause is waived.

Watermarks still advance only after the batch is dispositioned (Step 4 / Step 8) —
in autonomous mode "dispositioned" means written/merged/rejected into the working
tree, not a per-note yes.

## Step 0 — Resolve the roots to groom (once, for both phases)

Find the nearest `mage/metadata.json` (walk up). The docs root to groom is:

- **in-repo / hybrid** → `<repo>/mage/`
- **external** → the hub project it points at: `<hub_path>/projects/<project>/`
  — **FLAT**, no nested `mage/` (ADR-0011 / ADR-0023: a project looks like the hub
  it lives in, not like a code-repo `mage/`).

If none is found and the cwd is not a hub, you are not in a knowledge base —
`mage doctor` flags a **"bare parent"** when a dir sits above several KBs but is
itself neither. Don't groom; tell the user to `cd` into a project or `mage init`.

**At a hub root, fan out (Decision 1).** A hub is one KB *and* a registry of
project KBs, so groom the hub's OWN `.mage/learnings/` (at the hub root) **and every
registered project**. Read the hub's `metadata.json` registry and derive each
project's docs root from its `storage`:

- `repo-owned` (hybrid) → `<code_repo_path>/mage/`
- `hub-owned`           → `<hub>/projects/<name>/` (flat)

Then run **both phases below once per root**, passing `--dir <root>` to each engine
command. Each root keeps its **own** watermark + tally, so `--seen` stays
unambiguous and projects never conflate — this is why the fan-out is a per-root
loop, not one mixed manifest. Skip any project whose `code_repo_path` is absent on
this machine. If the user scopes the run to the hub only (e.g. "groom root-only"),
groom just the hub root and skip the fan-out.

---

## Phase 1 — first sight (`mage distill`)

1. **Run the deterministic reader.**
   ```bash
   mage distill --json
   ```
   It reads mage's own `.mage/learnings/*.jsonl` from the **last watermark forward**,
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
   It folds every CLOSED `.mage/learnings/` segment from the last watermark forward
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
  `.mage/learnings/*.jsonl` event schema the readers consume.
- **ADR-0014** (`mage/decisions/0014-two-gate-redaction.md`) — `mage redact`
  Gate 2 before any tracked write.
