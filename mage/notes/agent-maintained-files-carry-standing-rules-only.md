---
type: feedback
tags: [mage/grooming]
created: "2026-08-03"
last_reviewed: "2026-08-03"
status: active
sources:
  - cc-session:709f9d0f-6309-491f-8dd3-ea37a010f434
provenance:
  repo: mage-memory
  work: groom-2026-08-03
keywords:
  - claude-md
  - skills
  - trim
  - standing-rules
  - decision-history
  - context-cost
---
# Agent-maintained files carry standing rules only — no decision history, no trivial negatives

Standing user intent (2026-07-29, given twice in one session): in the files agents maintain
for the user — global `CLAUDE.md`, skills, kit docs — **trim the narrative**. Specifically
cut:

- **dates and events that led to a decision** — the rule matters, its origin story does not
  belong in a file loaded every session;
- **trivial negative statements** — one-off "don't do X" entries whose X was never a real
  temptation.

**Why:** these files are context paid on every session start. History and noise crowd out
the rules that actually steer behavior. (A KB note is the opposite case — there the *why*
is the payload; this rule is about always-loaded config surfaces.)

**How to apply:** when editing `~/.claude/CLAUDE.md` or a skill, state the rule in present
tense and delete the story of how it was arrived at; if the origin matters, it belongs in a
KB note or ADR that the config can link. Note: this preference is user-level — it lives here
because this KB doubles as the user store today; see
[route-memories-to-the-matching-store](route-memories-to-the-matching-store.md).
