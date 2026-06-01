---
name: mage-learn
description: |
  Capture a durable note into the mage knowledge base from work in progress.
  Use when the user invokes /mage-learn, asks to "remember", "capture", or
  "save" a finding, or right after you figure out a non-obvious interface,
  gotcha, procedure, or how services connect. Drafts a note (insight +
  procedure + pointers — never a copy of the source), checks the index for
  overlap, and writes only after the user confirms.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
disable-model-invocation: true
---

# /mage-learn — capture a note

Turn something you just learned into a durable mage note. mage stores the
reusable **insight**, the **procedure** (how to do it faster; the bad commands
to avoid), and **pointers** to canonical sources — never a copy of the source
(see `CONVENTIONS.md`).

## Modes

- `/mage-learn "<finding>"` — capture the stated finding.
- `/mage-learn` — scan the current work unit (`mage/work/<slug>/`) and the
  recent conversation for the most capture-worthy insight, then propose it.

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

7. **Write** the note under `mage/notes/` after confirmation.

8. **Suggest follow-ups (never auto-run):**
   ```bash
   mage index          # refresh INDEX.md
   mage skills         # refresh per-wing skills (if a new wing appeared)
   git -C <repo> add mage && git -C <repo> commit -m "note: <title> (#<wing>)"
   ```

## Quality bar

- Captures the *method and the path*, so next time is faster / fewer mistakes.
- Points to canonical sources; doesn't mirror them.
- Tagged with one `#<wing>/<room>` so it lands in the index and the wing skill.
- Links to related notes as graph edges.
