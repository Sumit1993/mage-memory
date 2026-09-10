---
name: point-in-time-research-stays-private
description: Research, surveys, strategy and "how I work" material never go into a public repo's docs; they go to the kit's private notes/ with a valid_until date
metadata:
  type: feedback
---

Point-in-time research (prior-art surveys, market scans, direction assessments) and anything describing the operator's own strategy or way of working does not get committed to a public repo, not even under docs/plans/.

**Why:** a docs folder makes a snapshot look trustworthy long after it stops being true, and the content discloses what the operator is building. Ruled 2026-09-04 after a prior-art page was committed to mage-memory PR #206 and had to be purged from the branch.

**How to apply:** write it to `~/ai-context/` for the session, then deposit it in claude-kit's `notes/` (private repo) once that directory exists, with a `valid_until` line and one sentence on why it cannot be trusted after that date. Never post it as a repo doc, a public gist or an issue body. See [[route-memories-to-the-matching-store]].
