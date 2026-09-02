---
type: gotcha
tags:
  - mage/soak
created: "2026-09-02"
last_reviewed: 2026-09-02
status: active
sources:
  - decisions/0025-one-transient-state-home.md
  - gh-issue:201
  - file:~/ai-context/mage-note-read-telemetry-verification.md
keywords:
  - learnings
  - decoy
  - wrong-directory
  - measurement
  - note-read
  - recall-audit
---

# Gotcha — this repo has two learnings dirs, and the obvious one is a decoy

`mage/.learnings/` looks like the capture sink. It is not. It is a relic from before ADR-0025,
9 files, all 2026-06-18 to 06-20, never written since. The live sink is `mage/.mage/learnings/`,
which is what `learningsPath()` in `src/paths.ts` returns.

On 2026-09-01 a recall audit measured note reads against the relic and reported 91.9 percent of
notes never read. The corrected replay over the live dir gave a different count (3 of 126 chapters
with any note read). The qualitative claim held; the number was from two days of June.

**The tell:** a learnings dir whose newest file is months old while sessions ran yesterday.
Before measuring, run the path function or `ls -t` both candidates.

**The fix:** delete the relic so it cannot be picked again.
