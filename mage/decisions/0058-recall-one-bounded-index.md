---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [recall, index, roster, MEMORY.md, INDEX.md, footprint, context-match, skills, trigger, project-subdir]
---

# 0058 — Recall is one bounded index, loaded every session
## Decision
`mage index` generates `INDEX.md` (one line per note: type, title, keywords, link) and `MEMORY.md`, the roster
Claude Code auto-loads; the AGENTS.md block carries a managed `@mage/INDEX.md` import line as the fallback. The
roster lists only notes that passed the ladder, in the order they passed, and is bounded by the harness cap
(25,600 bytes, 200 lines); `footprint` warns at 70 percent, `doctor` fails at 90, and nothing is silently
truncated. Per-project skills are generated and auto-load; a skill firing is counted by context-match over a
20-event window. Decisions and plans are never in the roster. Recall at the moment of need, a note's trigger
matched mid-task, comes after 0.1.0 (#201).
## Why
`MEMORY.md` reached 75 percent of the cap while 3 of 126 sessions read a note. What is not loaded is not
recalled, and what is loaded costs every session its bytes.
## Forbids
Importing note bodies or `_index.mage.md`. A tokenizer dependency. A second frontmatter field deciding recall.
Editing a generated file by hand (the memory hook denies writes to `INDEX.md` and `MEMORY.md`). Ranking the
roster by a recurrence tally.
## Example
`mage footprint`: "MEMORY.md 19,201 of 25,600 bytes (75%): warn. INDEX.md 37 notes. Skill mage: 4 loads,
2 fired." `mage doctor` at 23,100 bytes fails with "roster breach: drop or climb a note".
## Relations
Absorbs 0006, 0033, 0039, 0041, the context-match half of 0016 and the roster clause of decision 7 of 0048.
Enforced by `src/commands/index-cmd.ts:55` and `:493`, `src/adapters/claude-code/projects.ts:29`
(`GENERATED_MD`), `src/metrics/footprint.ts:16`, `src/adapters/claude-code/constants.ts:7`,
`src/metrics/context-match.ts:16`. Roster limited to notes that passed the ladder: #245. ADR keywords in the governance lines: #135.
#239 measured the observe arm at about 100 ms per call; "footprint unchanged" is not a claim this ADR makes.
