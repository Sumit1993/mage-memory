---
name: groom
description: |
  Dispose of the staged draft batch (`mage groom`): keep, edit or drop each
  draft the capture inbox lifted into `.mage/staging/`. The two mining readers
  it used to run after that, `mage distill` and `mage promote`, retired in #208
  and have no replacement until the proposal digest (#219).
  Fires at session boundaries, after a PreCompact, or when the user says
  "groom", "distill", "promote", "mine the learnings", or "what did we learn".
  Judges candidates through the shared capture pipeline, routes proven notes to
  `mage:graduate`. Nudge-invoked, not user-only.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# /mage:groom — mine the observed scratch into notes

`mage observe` writes a scratch record of every session to mage's own
`.mage/learnings/*.jsonl` (the ADR-0015 schema). **groom turns that scratch into
durable notes.** It is the back half of the loop `/mage:learn` serves, fired once
a stretch of work has closed: `learn` captures *this one finding now*; `groom`
mines *the accumulated record*.

groom is a **judgment tier** — **no model lives in mage** (ADR-0050). Today it has
one working phase, Phase 0 below. Phases 1 and 2 retired in #208 (see the
section after Step 0).

**Phase 0 — pending inline drafts (`mage groom`, 0.0.12).** Before the two mining
phases, dispose of lessons captured INLINE during work. Drafts reach
`.mage/staging/` when `mage groom` lifts the Claude Code capture inbox (flat notes
at the docs root) into it. `mage stage` retired in #208, and its replacement, a
`finding` event on `mage observe`, is not built yet (ADR-0052). Your job is the
batch human-confirm:

- `mage groom --json` surfaces the pending, deduped batch (capped at the staging
  budget; the rest defer). For each draft, keep / edit / drop it.
- `mage groom --accept <slugs|all>` moves the kept drafts into `notes/` and
  re-indexes; `mage groom --reject <slugs|all>` discards them and records the
  rejection so the same lesson is never re-drafted.

These drafts are the freshest, highest-signal material. Clear them; that is the
whole run until #219 lands.

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
- Hold the same **quality bar** as a confirmed write — lead with user corrections, run the one-question test on every draft — NEW costs a justification sentence, MERGE is the default when a note already answers the question; keep notes to insight + procedure + pointers. The waived prompt is convenience, not a lowered value-bar.

**Provenance is stamped for you (ADR-0031) — do not add it by hand.** `mage groom
--accept` stamps each accepted note's `provenance` deterministically at the write:
`autonomy: approver|overseer` (the reject-ledger's authorship mark, ADR-0030) plus
`repo` + `commit`. It appears in the diff you review and commit; you write none of it.

**Approver** — dispose the staged batch and write the **clearly-durable** drafts
straight into the working tree without the per-note prompt; leave anything **borderline** staged in `.mage/staging/` for
a later human pass; run `mage index`. Do **not** graduate.

**Overseer** — everything Approver does, **plus** dispose the borderline tier (write or `--reject` it rather than leaving it staged), fold lessons that share a question with an existing note into that note (one-question test, verdict stated in the batch). Graduation has no input while `mage promote` is retired (#208), so there is nothing to route to `/mage:graduate`.

In autonomous mode "dispositioned" means written, merged or rejected into the
working tree, not a per-note yes.

## Step 0 — Resolve the roots to groom

Find the nearest `mage/metadata.json` (walk up). The docs root to groom is:

- **in-repo / hybrid** → `<repo>/mage/`
- **external** → the hub project it points at: `<hub root>/projects/<project>/`
  — **FLAT**, no nested `mage/` (ADR-0011 / ADR-0023: a project looks like the hub
  it lives in, not like a code-repo `mage/`). The hub root is DERIVED from
  `hub_repo` (ADR-0043) — `~/.mage/hubs/<host>/<owner>/<repo>` — not read off
  `hub_path`, which is now only a deprecated fallback.

If none is found and the cwd is not a hub, you are not in a knowledge base —
`mage doctor` flags a **"bare parent"** when a dir sits above several KBs but is
itself neither. Don't groom; tell the user to `cd` into a project or `mage init`.

**At a hub root, fan out (Decision 1).** A hub is one KB *and* a registry of
project KBs, so groom the hub's OWN `.mage/learnings/` (at the hub root) **and every
registered hub-owned project** (`<hub>/projects/<name>/`). Repo-owned projects keep
their notes in their own repo checkouts and are groomed there.

Then run **Phase 0 once per root**, passing `--dir <root>`. Each root keeps its
own staging batch, so projects never conflate. If the user scopes the run to the hub only (e.g. "groom root-only"),
groom just the hub root and skip the fan-out.

---

## Phases 1 and 2 — retired (#208)

Phase 1 ran `mage distill --json`, a first-sight reader over `.mage/learnings/`.
Phase 2 ran `mage promote --json`, a graduation reader over note-read counts.
Both verbs now print a signpost and exit 0, so neither phase has input. Skip them.
Do not substitute `mage groom --json`: it returns the staged batch, not a
first-sight or graduation manifest. Their work returns as the proposal digest in
`mage groom` (#219).

---

## Step 9 — Suggest follow-ups (never auto-run)

```bash
mage index          # refresh INDEX.md so the new notes are findable
git -C <repo> add mage && git -C <repo> commit -m "groom: <n> notes"
```
mage never commits for you — it suggests, you run. The exception is
`--propose` (ADR-0057): opt-in per knowledge base. `--propose` itself commits
the promoted notes and pushes the proposal branch to open a pull request;
Step 9's manual `git add`/`git commit` does not apply in proposal mode. It can
only ever produce a branch and a pull request.

## Quality bar

- Every kept draft passes the same capture pipeline as `/mage:learn` — classify,
  one-question test, **Gate 2**, human confirm. Captures *insight + procedure +
  pointers*; points to canonical sources, never mirrors them.
- A draft is accepted or rejected only on explicit disposition; re-runs are safe.

## See also

- **/mage:learn** (`skills/learn/SKILL.md`) — the shared capture pipeline
  (classify → one-question test → Gate 2 → confirm → write) Phase 0 funnels into.
- **/mage:graduate** (`skills/graduate/SKILL.md`) — where Phase 2 handed
  `action: "graduate"` proposals, before #208 retired it.
- **ADR-0052** (`mage/decisions/0052-streams-and-the-observe-schema.md`) —
  distill as deterministic reader + judgment skill; first-sight capture; CLOSED-only
  watermark; mage reads only its own artifacts; and the `.mage/learnings/*.jsonl`
  event schema the readers consume.
- **ADR-0057** (`mage/decisions/0057-a-guard-lands-by-pull-request.md`) — the
  recurrence tally, distinct-session counting, the K/M thresholds, and the
  note/graduate ladder rungs.
- **ADR-0053** (`mage/decisions/0053-redaction-two-gates-one-engine.md`) — `mage redact`
  Gate 2 before any tracked write.
