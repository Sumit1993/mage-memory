# Read evidence for the 41 notes, measured 2026-09-10

Source: `mage/.mage/learnings/*.jsonl`, 107 files, 30,126 events, 74 sessions.
Method: `tool_use` events whose `paths` resolve to a live `mage/notes/*.md`;
`Write`/`Edit` counts as authoring, anything else as a read.

- 74 sessions in the log. **16 ever opened a note. 58 never did.**
- One session (`09490095`) opened 38 notes at once. That is a sweep, not recall,
  and it is what put a "2 foreign reads" floor under almost every note.
- With that sweep excluded: **14 of 41 notes were read by a session that did not
  write them.** Top: `soak-targets` (4). Everything else is 1.
- 27 of 41 have no foreign read at all.

## Why this signal is weak, and must not be used alone to delete

39 of the 41 notes are listed in `mage/MEMORY.md`, which the harness auto-loads
into every session. A note delivered that way is never opened as a file, so it
records zero reads while doing its job.

Three of the 27 "never read" notes did real work in this session on 2026-09-10:

- `point-in-time-research-stays-private` stopped the road-to-0.1.0 page being
  committed to this public repo, which #262's own Done-when item 2 asked for.
- `status-vocabulary-drift-undercounts-filters` produced the ADR status census
  (13 accepted, 28 active, 4 proposed, 2 superseded) that became the strongest
  row in the collapse PR.
- `agy-commit-message-compliance-is-unreliable` is the verify-do-not-trust habit
  that caught a delegate's false "zero dangling links" claim.

Read count measures the file-read path only. Treat it as one input, never the test.
