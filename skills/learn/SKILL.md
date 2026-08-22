---
name: learn
description: |
  Capture a durable note into the mage knowledge base from work in progress.
  Use when the user invokes mage:learn, asks to "remember", "capture", or
  "save" a finding, or right after you figure out a non-obvious interface,
  gotcha, procedure, or how services connect. Drafts a note (insight +
  procedure + pointers — never a copy of the source), checks the index for
  overlap, and writes only after the user confirms.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
disable-model-invocation: true
---

# /mage:learn — capture a note

Turn something you just learned into a durable mage note. mage stores the
reusable **insight**, the **procedure** (how to do it faster; the bad commands
to avoid), and **pointers** to canonical sources — never a copy of the source
(see `CONVENTIONS.md`).

## Modes

- `/mage:learn "<finding>"` — capture the stated finding.
- `/mage:learn` — scan the current work unit (`mage/work/<slug>/`) and the
  recent conversation for the most capture-worthy insight, then propose it.
- `/mage:learn --from <dir>` — bulk-import a directory of existing docs,
  transcripts, and skills (see **Bulk import** below).

## Steps

1. **Resolve the knowledge base.** Find the nearest `mage/metadata.json`
   (walk up). docs root = `<repo>/mage/` (in-repo) or `<hub root>/projects/<project>/`
   (external — the hub root is derived from `hub_repo`, ADR-0043). The deprecated
   `hub_path` fallback is read only when `hub_repo` is absent or does not resolve.
   If none, tell the user to run `mage init` first.

2. **Walk the better home ladder (ADR-0041).** Ask: *"Would an agent, mid-task and not looking for it, be better off if this arrived unbidden?"* Check the ladder rows in order before authoring a note:
   - **Code comment:** file/function-scoped detail that rots with the code.
   - **Ticket or `work/`:** work not yet done, forward plans, task lists (`mage/work/`).
   - **Doc beside code:** current-truth spec describing what the system IS.
   - **Artifact + pointer:** point-in-time investigation or raw trace.
   - **Skill / prompt:** instruction addressed to the agent as "you".
   - **Decision record:** settled choice and rationale (`mage/decisions/`).
   - **Memory:** non-completing, recallable gotcha, procedure, insight, or pointer.

   If a better home wins, route the content there (`mage/work/` for plans/specs/tasks, `mage/decisions/` for decisions, a repo doc for current truth, a skill for instructions) instead of authoring a note. This is **guidance, not a gate** — never phrase it as a hard block (ADR-0035 §4 forbids write-time tollbooths; if the user still requests a note, author it).

3. **Classify the finding.** Pick a `type` (see `CONVENTIONS.md`). The seven
   memory types — `gotcha`, `procedure`, `pointer`, `principle`, `feedback`,
   `reference`, `note` — are all **one genre** (memory, rung 2): shelf labels,
   not walls. Type never decides where a note's boundary is — the one-question
   test in step 4 does, and memory notes of different types merge freely (pick
   the merged note's type by what the merged body mostly is). Only the
   non-memory genres have walls: `decision`, `plan`, `tasks`, `spec` follow
   their own lifecycles and never merge with memory notes (a wrong decision is
   superseded, not merged). Any other type string is legal but lands
   **unclassified** (rung 3). Pick the **wing** (project / repo / service /
   person) and **room** (topic) → tag `#<wing>/<room>`.

4. **One-question test (on-write, ADR-0004) — answer it aloud before drafting.**
   Every memory note answers one reader question. State, in one sentence, the
   question a reader mid-task would ask when they need this finding ("why does
   X fail when Y?", "what is the fast path to Z?").

   Then read `mage/INDEX.md` (and the per-wing `_index.<wing>.md` if present)
   and name the existing note closest to that question — **closest by question,
   not by shared keywords, note size, or matching `type`**. Emit this block in
   your reply before drafting anything:

   ```
   Question:     <the reader's question>
   Closest note: <title> (<path>) — it answers: <its question>
   Verdict:      MERGE | SUPERSEDE | NEW
   ```

   - **MERGE** — an existing note answers the same question, or the two
     findings are halves of one trap a reader always meets together. Edit that
     note in place: integrate the finding into its body, union `keywords`,
     keep its `created`, bump `updated`/`last_reviewed`. No new file.
     (Mechanics: `CONVENTIONS.md` §"Merging notes".)
   - **SUPERSEDE** — an existing note answers the same question but its answer
     is now wrong: mark it `status: superseded`, link it to the new note —
     never silently overwrite.
   - **NEW** — no existing note answers the question. NEW must be justified:
     complete the sentence *"No existing note answers this question because
     …"*. If you cannot complete it truthfully, the verdict is MERGE — unless an existing note answers the question but its content is now wrong, in which case the verdict is SUPERSEDE.

5. **Draft the note** (do not write yet).
   - **For NEW / SUPERSEDE:** draft the frontmatter (all optional, but fill
     what you know):
     ```yaml
     ---
     type: interface
     tags: [billing/payments]
     created: <ISO date>
     last_reviewed: <ISO date>
     provenance: { repo: <repo>, commit: <sha>, work: <work-slug> }
     sources:
       - https://… (canonical doc / ticket / file:line) — when to go here
     status: active
     ---
     ```
     (For **SUPERSEDE**, also draft the edit to the superseded note: set
     `status: superseded` and link it to the new note).
   - **For MERGE:** edit the survivor note in place (`CONVENTIONS.md` §"Merging
     notes"): keep its existing `created`, bump `updated`/`last_reviewed` to
     today, and union `tags`, `keywords`, and `sources`.

   Body: the verbatim insight (don't oversimplify what you figured out), the
   procedure (steps; bad CLI calls to avoid + why), and a `## Relations`
   section with typed portable links (`- depends_on [x](x.md)`). Use standard
   markdown links `[text](relative/path.md)` — never `[[wikilinks]]`.

6. **Capture by pointer, not copy.** Reference the canonical source in
   `sources:`; quote only the reusable distilled insight. Snapshot a source
   into `work/<slug>/artifacts/` ONLY if it's fragile/ephemeral.

7. **Confirm with the user.** Show the draft (or diff for MERGE), the target
   path (`mage/notes/<wing>/<slug>.md` for NEW/SUPERSEDE, or the existing note's
   path for MERGE), and the step-4 verdict block — including the "No existing
   note answers this because …" sentence when the verdict is NEW. Wait for a yes.

8. **Redaction gate (ADR-0014 Gate 2, BEFORE write).** Run
   `mage redact <draft-file>` on the draft. If it reports a **LIVE** secret
   (non-zero exit), **STOP** — strip it (`mage redact --strip <draft-file>`) or
   remove it by hand — never write a secret into a tracked note/skill. A note is
   tracked and shared, so this is the seam where a missed secret becomes public.

9. **Write** the note under `mage/notes/` after confirmation and a clean
   redaction gate.

10. **Suggest follow-ups (never auto-run):**
    ```bash
    mage index          # refresh INDEX.md
    mage skills         # refresh per-wing skills (if a new wing appeared)
    git -C <repo> add mage && git -C <repo> commit -m "note: <title> (#<wing>)"
    ```

## Bulk import — /mage:learn --from <dir>

Backfill the knowledge base from existing material in one pass. Distill prose
docs and transcripts into notes, **and adopt the user's own skills in place** —
adopting an authored skill is *remembering*, not copying a source (ADR-0013 §5).

1. **Inventory `<dir>` deterministically.** FIRST run the read-only CLI
   `mage ingest <dir> --json`. It returns a classified manifest: an array of
   `{ relPath, kind, title, summary }` where `kind` is one of `skill` | `note` |
   `prose` | `transcript`. Don't split sources by hand — drive the rest of the
   flow per `kind`:
   - `skill` → **adopt-in-place** (step 3).
   - `prose` | `transcript` | `note` → **distill to notes** (step 2 / normal
     capture via the **Steps** above).

2. **For each prose / transcript / note file**, run the normal capture pipeline (classify →
   one-question test → draft insight+procedure+pointers → redaction gate → write),
   but defer the human confirm to the **bulk confirm** in step 4. Point
   `sources:` at the original file; never paste the source body in.

3. **For each `kind: skill`, adopt-in-place** (do NOT rewrite from scratch):
   - **Assign a wing/room** from its topic → tag `#<wing>/<room>`.
   - **Add provenance** (`repo`, `commit`, original path) to its frontmatter.
   - **Run the redaction gate** — `mage redact <skill-file>` (ADR-0014 Gate 2).
     A LIVE secret (non-zero exit) STOPS adoption for that skill until it's
     stripped (`mage redact --strip`) or removed; never adopt a skill that
     carries a live secret.
   - **Mint/link a backing note** under `mage/notes/<wing>/` so the skill has a
     durable substrate (the note is the truth; the skill is its pushed form,
     ADR-0013 §1). Link skill ↔ note.
   - **Re-emit** the skill as `mage-skill-<slug>` so it joins mage's catalog.

4. **Human-confirm in bulk.** Present the full batch — new notes, adopted
   skills, minted backing notes, and any items the redaction gate blocked — as
   one review. Write only after the user confirms; then suggest `mage index` /
   `mage skills` and the `git` commands (never auto-run, never auto-commit).

> **Observed scratch is a different lane.** `--from` imports *foreign* docs by
> pointer. Distilling mage's **own** observed `.learnings/*.jsonl` into notes
> lives in the separate **/mage:groom** skill — mage reads only its own
> artifacts; foreign memory stores (ECC instincts, Claude `MEMORY.md`) are not
> harvested (ADR-0018).

## Quality bar

- Captures the *method and the path*, so next time is faster / fewer mistakes.
- Points to canonical sources; doesn't mirror them.
- Tagged with one `#<wing>/<room>` so it lands in the index and the wing skill.
- Links to related notes as graph edges.
- **Keep it short.** A lesson captured inline during work (via `mage stage`) targets
  the CC-memory-sized `lessonNoteCap` (~1200 chars) — one durable fact, tersely. The
  larger 6000-char `noteSizeCap` is for deliberately authored design/reference notes.

## See also

- **ADR-0013** (`mage/decisions/0013-procedure-skills-self-grooming-loop.md`) —
  procedure skills, adopt-in-place, and the scratch → note → skill ladder.
- **ADR-0014** (`mage/decisions/0014-two-gate-redaction.md`) — two-gate
  redaction; `mage redact` is Gate 2 before any note/skill is written.
