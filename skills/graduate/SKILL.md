---
name: graduate
description: |
  Push a proven procedural note up into its own auto-loadable Procedure skill.
  Fires when the user says "graduate", "make this a skill", or when
  `mage:groom` surfaces a proven note that recurred across enough sessions.
  Reads the deterministic recurrence reader (`mage promote --json`) for
  `action: "graduate"` proposals, shows the human the backing note plus the
  recurrence evidence, and on confirm pipes the graduate Proposal JSON to
  `mage dream --apply` — the single writer that mints `mage-skill-<slug>`,
  points the note at it, and honors the ceilings. Nudge-invoked, not user-only.
allowed-tools: Read, Grep, Glob, Bash
---

# mage:graduate — note → Procedure skill

A **proven procedural note** — a playbook or gotcha that recurred across **≥ M
distinct sessions** — earns its own loadable **Procedure skill**
(`mage-skill-<slug>`). The note stays the substrate; the skill is its *pushed
form* (ADR-0013 §1). A skill is **auto-loaded** into context, so it must be an
actionable, proven **procedure** — you auto-load a *procedure*, not a *fact*. That
is why **only playbook/gotcha notes graduate**: principle / reference / interface
notes carry knowledge, not a method to run, so they stay notes (ADR-0019 §5).

Recurrence — not context-match — gates graduation: a not-yet-graduated note emits
no `skill_load`, so there is no context-match data to gate on. Context-match only
exists *after* graduation, where it governs **reword / demote** (driven by
`mage:optimize`). The reverse of graduation — a skill that stops earning its keep
— is **demote** (skill → note; the skill is archived, the note kept).

This skill is judgment over a deterministic fold: the reader counts recurrence and
proposes; you confirm against the actual note; `mage dream --apply` does every
write through the single applier.

## Steps

1. **Resolve the knowledge base.** Find the nearest `mage/metadata.json` (walk
   up). docs root = `<repo>/mage/` (in-repo) or
   `<hub_path>/projects/<project>/mage/` (external). If none, tell the user to run
   `mage init` first — there is nothing to graduate.

2. **Run the deterministic recurrence reader.**
   ```bash
   mage promote --json
   ```
   It emits a `PromoteManifest`. Look only at the `action: "graduate"` proposals
   here (`mage:groom`'s Phase 2 handles the `action: "note"` catch-net):
   ```jsonc
   {
     "action": "graduate",
     "target": "notes/<file>.md",            // the backing note's relPath
     "payload": { "note": "…", "wing": "…", "type": "playbook"|"gotcha" },
     "evidence": "recurred in N sessions"
   }
   ```
   If there are no `graduate` proposals, say so and stop — nothing has recurred
   enough to graduate yet.

3. **Show the human the backing note + the recurrence evidence.** For each
   `graduate` proposal, read the note at `target` and present:
   - the note's title, `type`, and wing (confirm it really is a playbook/gotcha —
     a non-procedural note is a reader/judgment mismatch; do **not** graduate it);
   - the recurrence `evidence` (how many distinct sessions corroborated it);
   - what graduation will produce: a `mage-skill-<slug>` SKILL.md written into both
     `.claude/skills/` and `.agents/skills/`, carrying `GEN_MARKER` + a `wing:`
     line + a `Load when…` trigger, with the note re-written to point at it
     (`graduated_skill: mage-skill-<slug>`).

   Wait for an explicit yes. If the human declines, leave it — the note persists
   and a later pass can re-offer.

4. **On confirm, apply the graduate Proposal through the single writer.** Pipe the
   exact proposal JSON to `mage dream --apply` on **stdin** (the graduate payload
   is `{}` — the applier reads the note at `target` and derives its wing):
   ```bash
   printf '%s' '{"action":"graduate","target":"notes/<file>.md","payload":{},"evidence":"recurred in N sessions"}' | mage dream --apply
   ```
   The applier (the single serialized writer):
   - renders the SKILL.md from the note's body and writes it into **both**
     `.claude/skills/mage-skill-<slug>/` and `.agents/skills/mage-skill-<slug>/`;
   - re-writes the note with a `graduated_skill:` pointer + a bumped `updated`
     stamp (the note is **never deleted** — never-hard-delete);
   - **refuses to clobber a bespoke skill** (the GEN_MARKER bespoke-guard: it only
     writes over a mage-generated target);
   - **refuses to write past Gate 2** (a live secret in the rendered skill blocks
     the write);
   - **structurally refuses a non-playbook/gotcha note** — the renderer throws, so
     a misrouted proposal cannot mint a skill from a fact;
   - **never commits.** It prints what it wrote/archived, or a refusal if a ceiling
     blocked it.

5. **Review the diff and commit yourself (never auto-commit).**
   ```bash
   git -C <repo> add .claude/skills .agents/skills mage \
     && git -C <repo> commit -m "graduate: <note title> → mage-skill-<slug>"
   ```
   mage never commits for you — review the two written SKILL.md files and the
   re-pointed note, then commit. If the applier printed a refusal (a ceiling
   blocked it), nothing was written — resolve the cause (strip a secret, pick a
   different slug if a bespoke skill owns the name) and re-run, or leave it.

## Worked example — a proven gotcha graduates

`mage:groom` surfaced, and you ran `mage promote --json`, which returned:

```jsonc
{
  "proposals": [
    {
      "action": "graduate",
      "target": "notes/svc-api/migration-lock.md",
      "payload": { "note": "notes/svc-api/migration-lock.md", "wing": "svc-api", "type": "gotcha" },
      "evidence": "recurred in 5 sessions (failure×4, correction×1)"
    }
  ],
  "cursors": { "…": 0 },
  "covered": 8
}
```

Read `notes/svc-api/migration-lock.md` — a `gotcha` titled **Migration lock** that
documents the "release the advisory lock before re-running the migration"
procedure, and it has burned five separate sessions. Show the human the note body
and the `failure×4, correction×1` evidence, confirm it is procedural, and on a yes:

> The skill **slug is derived from the note's title** (`procedureSkillSlug`), not
> its filename: a short title like *Migration lock* mints `mage-skill-migration-lock`,
> while a long title mints a long, truncated slug. Glance at the applier's printed
> paths to see the actual name.

```bash
printf '%s' '{"action":"graduate","target":"notes/svc-api/migration-lock.md","payload":{},"evidence":"recurred in 5 sessions (failure×4, correction×1)"}' | mage dream --apply
```

The applier writes `mage-skill-migration-lock/SKILL.md` into both
`.claude/skills/` and `.agents/skills/` (with `GEN_MARKER`, `wing: svc-api`, and a
`Load when…` trigger), re-writes the note with `graduated_skill:
mage-skill-migration-lock`, and prints the two paths it wrote. Then:

```bash
git -C <repo> add .claude/skills .agents/skills mage \
  && git -C <repo> commit -m "graduate: migration-lock → mage-skill-migration-lock"
```

Had `notes/svc-api/migration-lock.md` been a `principle` instead, the applier's
renderer would have thrown — you auto-load a procedure, not a fact, so it would
stay a note.

## Quality bar

- Only **proven** procedures graduate — a playbook/gotcha that recurred ≥ M
  distinct sessions, confirmed against the actual note body before applying.
- The **note persists** — graduation pushes a copy up into a skill and points the
  note at it; it never deletes or replaces the note.
- Every write goes through `mage dream --apply` (the single writer); the skill
  honors the ceilings (Gate-2 secret-block, GEN_MARKER bespoke-guard,
  never-hard-delete, never-commit).
- mage never commits — the human reviews the two SKILL.md files + the re-pointed
  note and commits.

## See also

- **mage:groom** (`skills/groom/SKILL.md`) — surfaces the `action: "graduate"`
  proposals this skill applies (and the `action: "note"` catch-net it does not).
- **mage:optimize** (`skills/optimize/SKILL.md`) — the post-graduation half:
  reword a mis-firing trigger, or **demote** a skill that stops earning its keep
  (skill → note, the reverse of graduation).
- **ADR-0013** (`mage/decisions/0013-procedure-skills-self-grooming-loop.md`) §1 —
  a skill is a graduated note; the note is the substrate, the skill its pushed
  form; dream is the single applier.
- **ADR-0019** (`mage/decisions/0019-mage-promote-self-grooming.md`) §5 — only
  procedural notes graduate; recurrence (not context-match) gates graduation.
