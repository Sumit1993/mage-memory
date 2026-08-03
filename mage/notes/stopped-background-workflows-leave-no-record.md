---
type: gotcha
tags: [mage/build]
created: "2026-08-03"
last_reviewed: "2026-08-03"
status: active
sources:
  - cc-session:8fca047a-2c83-4245-a405-111a0fa68480
provenance:
  repo: mage-memory
  work: groom-2026-08-03
keywords:
  - background-workflow
  - taskstop
  - transcript
  - compaction
  - resume
  - absence-of-evidence
  - anti-stall
  - sentinel
---
# Gotcha — a stopped background workflow leaves no transcript marker, so absence proves nothing

A background workflow stopped via the UI or `TaskStop` writes **no completion record and no
transcript marker**. After a resume or compaction, "no completion record found" is therefore
ambiguous between three states: it finished and the record was lost, it was deliberately
stopped, or it was still running when the session died. Diagnosed 2026-07-30 on the
prismalens `docs-site-review-reuse` workflow — the post-compact session could not
reconstruct what had happened, because there was nothing to read.

**Do not diagnose from absence.** Check durable side-effects instead: the task's output
file under the session scratchpad (`…/tasks/<task-id>.output`), the artifact the workflow
was supposed to produce, a branch/commit it would have pushed.

**Prevention is the anti-stall doctrine:** any work expected to outlive a turn must key on
durable evidence it writes itself — a log file plus an exit sentinel, an artifact, a commit —
never on harness liveness. Evidence the *work* writes survives UI stops, compaction, and
session death; harness bookkeeping survives none of them.

Sibling harness gotcha, same discovery path:
[context-mode-blocks-files-outside-project-root](context-mode-blocks-files-outside-project-root.md).
