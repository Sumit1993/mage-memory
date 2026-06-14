---
type: plan
tags: [mage/grooming, mage/0.0.11]
created: "2026-06-14"
last_reviewed: "2026-06-14"
status: active
provenance:
  repo: mage-memory
  work: 0.0.11-signal-and-capture
sources:
  - src/grooming/tally.ts
  - src/grooming/thresholds.ts
  - src/grooming/signature.ts
  - src/commands/observe.ts
  - src/observe/store.ts
  - src/distill/reader.ts
  - src/claude-settings.ts
  - ~/ai-context/mage-soak/2026-06-14.md
---

# 0.0.11 — "signal quality + autonomous capture"

**Release framing (decided 2026-06-14).** These are **general** grooming/capture
fixes, not part of 0.0.10's "coherence" theme. Sequencing:

- **0.0.10 "coherence" ships as-is.** Verified: none of the candidates below touch
  0.0.10's behavior (the only grooming files in the 0.0.10 diff are 2–4 line label
  renames; `tally.ts` / `thresholds.ts` / `claude-settings.ts` are untouched).
- **0.0.11 = this note** — the release that makes the soak's graduation actually
  *reachable* and *meaningful*, and widens capture to autonomous subagent work.
- **0.1.0 = the beta announcement** of a complete solution, gated on a real observed
  graduation (note→skill) — now achievable once 0.0.11 lands and the soak runs.

Found via a soak audit + a 4-agent hooks/session-counting investigation. The soak has
real captures but **max distinct-sessions per signature = 2** everywhere (gate M=5).

## Candidate 1 — BLOCKER: count compact CHAPTERS, not session_ids (serves BOTH usage patterns)

The recurrence tally keys distinct work on `session_id`. `tally.ts` `foldSession`
dedupes a signature **once per session_id, ever** (line 206 `seen = new Set(prevFold.sigs)`;
`mergeStat` bumps `sessions` only when new-for-session). Claude Code keeps the SAME
`session_id` across compaction, so a user in one long compacted chat
([[single-chat-compaction-workflow]]) produces ~1 session id → M=5 (`thresholds.ts:52`)
is unreachable by construction.

**This must NOT assume one usage pattern** — other users run many short sessions.
The unifying fix: make the work-unit the **chapter** (a `compact`/`session_end`-delimited
segment), which `foldSession` already produces (`segmentClosed`, line 189; distill's
reader chops at the same terminators, `reader.ts:35-36`). Then:

- **Multi-session users are not penalized** — each session is ≥1 chapter, so a signature
  recurring across 5 sessions = 5 chapters = counts 5, exactly as today.
- **Single-chat-compaction users are unblocked** — one session's N chapters now count N.

**Implementation sketch:** in `foldSession`, increment a signature's recurrence count
**once per chapter (segment) it appears in** within the newly-closed region, instead of
merging all segments into one per-session `seen` set. The per-session `offset` watermark
already prevents cross-fold double-counting (a chapter is final once its terminator
closes). Confirm `segmentClosed` granularity == compact-chapter (NOT per-prompt/per-tool,
which would inflate). Lens/lastSeen merging is unchanged.

**To grill:** a min-events/min-span floor per chapter (so a trivial auto-compaction
doesn't mint a work-unit); reconcile the M/K thresholds with the new, finer unit
(`high` graduate=4, `normal`=5, `low`=7 may need re-tuning); keep idempotency + never-regress.

**BUILT (0.0.11).** Decision: keep the **compact-chapter** as the unit with a
`MIN_CHAPTER_WORK_EVENTS = 2` floor (thresholds.ts); `tally.ts` `foldSession` now counts
distinct qualifying chapters (the offset watermark keeps each folded once); `PROMOTE_VERSION`
bumped to 2 with a `normalizeTally` reset so v1 per-session tallies rebuild under the new unit.
**Validated on the live single-chat KB:** max recurrence 2 → **8**; note-eligible (≥3) 0 → **93**;
graduation-eligible (≥5) **0 → 27**. The gate is now reachable.

**Tuning BUILT (0.0.11).** Raised **M 5→8** (dial high 6 / low 11) and added a **bounded, ranked
promotion budget** (`promotionBudget=5`, thresholds.ts): in `buildManifest`, eligible proposals rank
strongest-first (graduate rung, then recurrence, lens diversity, recency, target asc) and only the top
N surface — the rest are reported as `deferred`. This is the "dynamic, good-enough promotion stage" that
deals with the flood the finer chapter unit creates. **Validated on the live KB:** the 93-candidate note
flood → **5 surfaced + 88 deferred**, strongest-first. NOTE the surfaced candidates are still NOISY
(`home::cli,read`; "Read cli.ts recurred 8×") — exactly what **Candidates 2 + 3** fix. **Still deferred:**
a window-independent unit (days/episodes) and a fully-dynamic (percentile) threshold if the budget proves
insufficient.

## Candidate 2 — hub-owned project signatures mis-tag `wing = projects`

Digest 2026-06-14: every prismalens-engine / sreforge signature has `wing = "projects"`
(the literal dir) instead of the project name. Wing feeds per-wing skills + `#wing/room`
tags. Likely the wing is derived from a path segment of the flat hub-owned docs root
(`<hub>/projects/<name>/`) and grabs `projects`. Fix: derive wing from the resolved
**project name** (registry/metadata), not a path basename. Look in `src/grooming/signature.ts`.

**BUILT (0.0.11).** `wingFromSegment` now treats a hub's `projects/` container as
TRANSPARENT: `projects/<name>/<leaf>` (>= 3 segments, so `<name>` is a real directory
scope) names the wing `<name>`, via a new `wingOfSegments` helper keyed on `PROJECTS_DIR`
(paths.ts). The `<hub>` repoRoot makes touched doc paths relative to `projects/<name>/...`,
so this is the right de-container point. **Validated on the live soak:** prismalens-engine
and sreforge signatures now carry `wing = prismalens-engine` / `wing = sreforge` (was
`wing = projects` for every one).

## Candidate 3 — keyword signatures are noise-dominated → patterns never recur

Signatures key on generic tool-verbs, **raw command strings**, and path fragments
(`[commands, home, mage, memory, src, sumit]`; `bash+echo+git` vs `bash+cat+echo`).
1885 distinct signatures across 6 sessions. Near-identical work yields *distinct*
signatures, so recurrence is impossible even after Candidate 1. Fix: de-noise
`signature.ts` — drop path fragments, collapse tool-call boilerplate, normalize verbs;
key on the **topic**, not the shell incantation. (Candidate 1 makes graduation possible;
this makes it meaningful.)

**BUILT (0.0.11) — MODERATE dial (user-chosen).** A `DENOISE` set in `keywordsFromText`
drops two token classes alongside STOPWORDS: ① tool / shell VERBS (`read`, `edit`, `bash`,
`grep`, `git`, `echo`…) and ② generic file / container NAMES (`readme`, `index`, `cli`,
`paths`, `package`…). Topical file words (`spec`, `roadmap`, `conductor`, `types`,
`structuredoutput`…) deliberately survive. `PROMOTE_VERSION` bumped **2 → 3** (key
semantics changed) so old-key tallies rebuild under the de-noised keys.

**Validated on the live soak — PRECISION, not reach (honest finding):** proposals went from
verb+filename noise (`mage::read,readme`, `mage::edit,readme`, `mage::paths,read`) to real
topics (`mage::structuredoutput`, `mage::plan,release,sequence`, `mage::claude,settings`;
`sreforge::alert,prometheus`, `sreforge::conductor`, `sreforge::deployer`). Signatures
2237 → 1967; note-eligible (≥3) 61 → 40. BUT **max recurrence 6 → 5**: the old top
(`read+readme` = 6) was NOISE; de-noise dropped it and revealed the true topical ceiling
(`plan+release+sequence` = 5), still **below M=8**. So de-noise did NOT make graduation
newly reachable — it made the measured signal honest. **Implication:** topical recurrence
climbs as more compact-chapters accrue; M=8 is reachable with more real work, OR — now that
de-noise + the bounded budget already tame the flood — M could come back down toward the
real signal level (a `dynamic/percentile` threshold remains the deferred lever).

## Candidate 4 — CRITICAL: capture autonomous subagent work (SubagentStop)

Agent harnesses are moving toward **autonomous multi-agent workflows** (the Workflow/
subagent fan-outs used in this very project). That work runs in subagents and is
**invisible** to mage's main-session `PostToolUse` hook — so an increasing share of real
work never reaches `.learnings`. mage registers 8 events but NOT `SubagentStop`
(`src/claude-settings.ts:42-52`).

Fix: add a `SubagentStop` capture hook → `mage observe` (carries `agent_id`, `agent_type`,
`last_assistant_message`, `exit_reason`); consider `SubagentStart` for the spawn boundary.
This widens capture to where autonomous work increasingly happens — and a subagent run is
itself a natural work-unit candidate that complements Candidate 1's chapters. (Verify
mage isn't already getting subagent signal another way; `PreToolUse` is likely redundant
with `PostToolUse`'s `tool_input` — confirm before wiring.)

**BUILT (0.0.11) — minimal, correct capture seam.** Wired `SubagentStop` into both halves:
`MAGE_HOOKS` (claude-settings.ts, now 9 groups) AND `observe.ts` `inferType`
(`SubagentStop → assistant_msg`, alongside `Stop`). Confirmed a subagent's tool calls never
reach the main-session `PostToolUse` hook, so the SubagentStop payload's `transcript_path`
(the SUBAGENT transcript) is the one seam — reusing the proven `buildAssistantMsgEvent` path
that reads the last assistant reply, scrubbed. **Scope note:** this CAPTURES the subagent's
product (final reply) into `.learnings`; it does NOT yet mint subagent-specific *signatures*
(an assistant_msg is a correction antecedent, not itself a lens hit). Treating a whole
subagent run as a first-class work-unit (parse its transcript's tool_uses, or a dedicated
`subagent` lens) is the natural **follow-up** once we confirm the hook fires with a usable
transcript on a real autonomous run.

## Relations

- informs [plan-release-sequence](plan-release-sequence.md) — inserts 0.0.11 before the 0.1.0 beta announcement
- relates_to [plan-v0.1-locks](plan-v0.1-locks.md)
- depends_on [ADR-0013](../decisions/0013-procedure-skills-self-grooming-loop.md) — the scratch→note→skill ladder + thresholds
- depends_on [ADR-0015](../decisions/0015-mage-observe-capture-schema.md) — the compact terminator + capture schema (where a SubagentStop event slots in)
- depends_on [ADR-0016](../decisions/0016-context-match-confidence-ladder-applier.md) — signatures as the load-bearing predicate
