---
type: pointer
tags:
  - mage/grooming
created: "2026-07-10"
last_reviewed: 2026-07-10
sources:
  - src/adapters/claude-code/nudge.ts
  - src/adapters/claude-code/nudge-state.ts
  - src/adapters/claude-code/settings.ts
  - src/distill/digest.ts
  - mage/decisions/0030-agent-autonomy-ladder.md
  - mage/decisions/0029-digest-to-agent-capture.md
  - cc-session:38816fdd-1c3d-4bad-b3d0-e1decb93b50c
keywords:
  - nudge
  - boundary
  - digest
  - startup
  - session-start
  - watermark
  - once-per-chapter
  - teaser
  - two-channel
  - systemMessage
  - additionalContext
  - offer-first
---

# The boundary nudge — internals + where each piece lives

`mage nudge` is one command wired to the Claude Code **SessionStart** hook
(`settings.ts` → `MAGE_HOOKS`, id `mage:nudge:SessionStart`). It is the safety-net for the
[organic grooming loop](decisions/0024-organic-grooming-loop.md): the human's inline capture is
primary; the nudge only catches what the agent forgot. Never throws (fail-open, exit 0).

## The moving parts (by file)

- **`nudge.ts`** — orchestration. `nudgeCmd` gates on `source` (fires on `compact`/`startup`/`resume`,
  NOT `clear`) then `digestNudge` composes the output. `chapterDigest` builds the last-closed chapter's
  digest; `teaserLine` renders the user-visible one-liner; `renderMandate` templates the autonomy line.
- **`digest.ts`** — the pure narrowing engine. `latestClosedChapter` picks the most-recent closed
  chapter across all session streams; `computeDigest` → `renderDigest` produces the raw-material
  markdown. A chapter is closed by a terminator: **`compact` OR `session_end`** (`isTerminator`).
- **`nudge-state.ts`** — the persisted store `.mage/metrics/nudge-throttle.json` (4 concerns: backlog
  clock, dream clock, the once-per-chapter `lastChapterTs` watermark, the mtime tally cache). Fail-open.
- **`settings.ts`** — the hook wiring itself.

## Two output channels (easy to conflate)

- **`systemMessage`** — USER-visible, rendered in the terminal. Carries the deterministic, UNRANKED
  teaser + backlog/health lines. mage never picks a "keeper" here — it narrows, the agent judges.
- **`hookSpecificOutput.additionalContext`** — MODEL-only, injected into the agent's context, never
  shown to the user. Carries the full digest + the autonomy mandate. The agent names the keeper.

## Key behaviours (ADR-0030 amendment, 2026-07-10)

- The digest surfaces at **every firing source**, not just `compact` — non-compacting users (short
  sessions, `/clear`, early quit) close a chapter via `session_end` and see it on their next entry.
- **De-dup is once-per-chapter**, by the terminator `ts` stamped in `lastChapterTs` — shared by the
  compact AND startup/resume paths, so a chapter never surfaces twice. NOT a time throttle. The
  separate backlog *count* line keeps its own 4h throttle (`grooming.nudgeThrottleHours`).
- **One shared, fingerprint-gated read.** `scanBoundary` reads the session streams ONCE and feeds both
  the digest and the backlog tally (`computeBacklogFromStreams`). A no-new-scratch startup is a cache
  hit → reads nothing, surfaces no digest. `compact` always re-reads (fresh chapter must show).
- **Session entry is offer-first at every autonomy level** — startup/resume drop the mandate to
  `operator` even when configured overseer, so opening the CLI never triggers autonomous grooming.

Gotcha when editing ADRs/notes here: the CC memory-hook restamps frontmatter to harness shape
mid-edit; run `mage flatten` to normalize the working tree back to flat schema before review. And
never run biome — see [Mage no biome 2space](mage-no-biome-2space.md).
