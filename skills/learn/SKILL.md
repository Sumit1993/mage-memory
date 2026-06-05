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

# mage:learn — capture a note

Turn something you just learned into a durable mage note. mage stores the
reusable **insight**, the **procedure** (how to do it faster; the bad commands
to avoid), and **pointers** to canonical sources — never a copy of the source
(see `CONVENTIONS.md`).

## Modes

- `mage:learn "<finding>"` — capture the stated finding.
- `mage:learn` — scan the current work unit (`mage/work/<slug>/`) and the
  recent conversation for the most capture-worthy insight, then propose it.
- `mage:learn --from <dir>` — bulk-import a directory of existing docs,
  transcripts, and skills (see **Bulk import** below).

## Steps

1. **Resolve the knowledge base.** Find the nearest `mage/metadata.json`
   (walk up). docs root = `<repo>/mage/` (in-repo) or
   `<hub_path>/projects/<project>/mage/` (external). If none, tell the user to
   run `mage init` first.

2. **Classify the finding.** Pick a `type` (open vocab — see `CONVENTIONS.md`):
   `interface`, `tooling`, `topology`, `relationship`, `playbook`, `gotcha`,
   `pointer`, `trail`, `decision`, `principle`. Pick the **wing** (project /
   repo / service / person) and **room** (topic) → tag `#<wing>/<room>`.

3. **Overlap-check (on-write, ADR-0004).** Read `mage/INDEX.md` (and the
   per-wing `_index.<wing>.md` if present) for notes on the same topic or
   keywords. Decide **UPDATE** an existing note vs **NEW** note. If a new claim
   contradicts an existing note, prefer **supersede**: mark the old note
   `status: superseded`, link to the new one — never silently overwrite.

4. **Draft the note** (do not write yet). Frontmatter (all optional, but fill
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
   Body: the verbatim insight (don't oversimplify what you figured out), the
   procedure (steps; bad CLI calls to avoid + why), and a `## Relations`
   section with typed portable links (`- depends_on [x](x.md)`). Use standard
   markdown links `[text](relative/path.md)` — never `[[wikilinks]]`.

5. **Capture by pointer, not copy.** Reference the canonical source in
   `sources:`; quote only the reusable distilled insight. Snapshot a source
   into `work/<slug>/artifacts/` ONLY if it's fragile/ephemeral.

6. **Confirm with the user.** Show the draft + the chosen path
   (`mage/notes/<wing>/<slug>.md`) and whether it's UPDATE or NEW. Wait for a
   yes. (Human-confirm is the default for v0.1.)

7. **Redaction gate (ADR-0014 Gate 2, BEFORE write).** Run
   `mage redact <draft-file>` on the draft. If it reports a **LIVE** secret
   (non-zero exit), **STOP** — strip it (`mage redact --strip <draft-file>`) or
   remove it by hand — never write a secret into a tracked note/skill. A note is
   tracked and shared, so this is the seam where a missed secret becomes public.

8. **Write** the note under `mage/notes/` after confirmation and a clean
   redaction gate.

9. **Suggest follow-ups (never auto-run):**
   ```bash
   mage index          # refresh INDEX.md
   mage skills         # refresh per-wing skills (if a new wing appeared)
   git -C <repo> add mage && git -C <repo> commit -m "note: <title> (#<wing>)"
   ```

## Bulk import — mage:learn --from <dir>

Backfill the knowledge base from existing material in one pass. Distill prose
docs and transcripts into notes, **and adopt the user's own skills in place** —
adopting an authored skill is *remembering*, not copying a source (ADR-0013 §5).

1. **Inventory `<dir>` deterministically.** FIRST run the read-only CLI
   `mage ingest <dir> --json`. It returns a classified manifest: an array of
   `{ relPath, kind, title, summary }` where `kind` is one of `skill` | `note` |
   `prose` | `transcript` | `feeder-ecc` | `feeder-native`. Don't split sources
   by hand — drive the rest of the flow per `kind`:
   - `skill` → **adopt-in-place** (step 3).
   - `prose` | `transcript` | `note` → **distill to notes** (step 2 / normal
     capture via the **Steps** above).
   - `feeder-ecc` | `feeder-native` → the lower-confidence **FEEDER** path
     (step 4).

2. **For each prose / transcript / note file**, run the normal capture pipeline (classify →
   overlap-check → draft insight+procedure+pointers → redaction gate → write),
   but defer the human confirm to the **bulk confirm** in step 5. Point
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

4. **For each `kind: feeder-ecc` / `feeder-native`, take the FEEDER path —
   lower-confidence, same pipeline (ADR-0005).** ECC `continuous-learning-v2`
   instincts (`feeder-ecc`) and Claude native auto-memory (`feeder-native`)
   enter through this same `--from` flow, but as **feeders**: mark them
   lower-confidence, require a recurrence/quality bar before promotion, and lean
   harder on the redaction gate. They feed mage; they never rival it as canonical.

5. **Human-confirm in bulk.** Present the full batch — new notes, adopted
   skills, minted backing notes, and any items the redaction gate blocked — as
   one review. Write only after the user confirms; then suggest `mage index` /
   `mage skills` and the `git` commands (never auto-run, never auto-commit).

## Quality bar

- Captures the *method and the path*, so next time is faster / fewer mistakes.
- Points to canonical sources; doesn't mirror them.
- Tagged with one `#<wing>/<room>` so it lands in the index and the wing skill.
- Links to related notes as graph edges.

## See also

- **ADR-0013** (`mage/decisions/0013-procedure-skills-self-grooming-loop.md`) —
  procedure skills, adopt-in-place, and the scratch → note → skill ladder.
- **ADR-0014** (`mage/decisions/0014-two-gate-redaction.md`) — two-gate
  redaction; `mage redact` is Gate 2 before any note/skill is written.
