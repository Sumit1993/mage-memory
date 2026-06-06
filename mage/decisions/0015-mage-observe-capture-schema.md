---
type: decision
tags: [mage/decisions]
created: "2026-06-06"
updated: "2026-06-06"
last_reviewed: "2026-06-06"
status: active
provenance:
  repo: mage-memory
  work: grill-observe-schema
sources:
  - src/paths.ts
  - src/redact.ts
  - ~/.claude/skills/continuous-learning-v2/hooks/observe.sh
  - ~/.claude/settings.json
---

# 0015 — `mage observe`: the capture schema (the keystone `.jsonl`)

A 2026-06-06 grill locked the `.learnings/*.jsonl` schema that
[ADR-0013](0013-procedure-skills-self-grooming-loop.md) calls *load-bearing for the
whole loop*: `connect` (0.0.8), `distill` (0.0.9), `promote` (0.0.10), and `optimize`
(0.0.11) all read it. It was grilled against the real formats of **ECC
`continuous-learning-v2`** (`observe.sh` → `observations.jsonl`), **mem0**,
**Microsoft SkillOpt**, and the **Claude Code hook stdin** shapes. This ADR fixes the
envelope, the event vocabulary, the payloads, and where Gate-1 redaction sits. The
*compute* that reads this schema (context-match, the confidence ladder, the applier)
is [ADR-0016](0016-context-match-confidence-ladder-applier.md).

## Decision

1. **Lock a versioned, extensible *envelope* + an additive-only evolution rule — not
   the full event vocabulary.** Every line is a discriminated record:
   `{ "v":1, "ts":"<ISO-8601 UTC>", "session":"<id>", "type":"<event>", … }`.
   - **No `seq`** — the file is append-only and one-per-session, so line order *is*
     causal order; a monotonic counter would force a read-before-append. POSIX
     `O_APPEND` keeps concurrent sub-line writes atomic; `ts` disambiguates the rare
     concurrent case.
   - Session-constant fields ride a one-time `session_start`, not every line.
   - **Evolution rule:** adding an optional field or a new `type` is **non-breaking**
     (consumers ignore unknown types/fields); renaming, removing, or re-meaning a
     field **bumps `v`**. Later releases append *their* event types additively in
     their own grills — they do not reopen this one.

2. **Six event types on the critical path** (discriminator named **`type`**; the
   mem0-style mutation verbs `ADD/UPDATE/DELETE` belong to the *applier* layer, kept
   out of capture):

   | `type` | Fires on | Carries |
   |---|---|---|
   | `session_start` | session begin | `harness, cwd, repo_root, mage_version, source` (no `wing` — derived per-event at compute time) |
   | `user_prompt` | user turn | `text` (redacted, truncated ~2000) — the keyword/intent signal |
   | `skill_load` | a skill auto-loads | see §3 |
   | `tool_use` | a tool runs | see §4 |
   | `compact` | PreCompact | `trigger` (`manual\|auto`) — the high-value distill marker |
   | `session_end` | session end | `reason` (may be **absent** on crash; consumers tolerate) |

   Deviations from ADR-0009's "tool, file, error, decision" sketch: **fold `file` and
   `error` into `tool_use`** (a file touch *is* a tool use; an error is `ok:false`),
   **drop `decision`** (recording "a decision was made" is judgment → the distill
   stage, never a deterministic hook), and **add `session_start` + `user_prompt`**
   (context-match needs them).

3. **`skill_load` is a specialization of `tool_use`, needing no new hook.** Modern
   Claude Code loads every skill through the **`Skill` tool**
   (`{"name":"Skill","input":{"skill":"…"}}`) — user-typed *or* model-auto-selected —
   so a load is observable via the same `PostToolUse` hook. "Auto-load" = "the model
   auto-invokes the Skill tool," which is exactly what context-match should measure.
   Payload:
   ```jsonc
   { "type":"skill_load", "skill":"mage-skill-…",
     "args": null,                                   // redacted+truncated if present
     "match": { "wing":"…", "keywords":["…"], "paths":["…"] },  // snapshot at load
     "trigger_hash": "…" }                           // hash of the trigger/description as loaded
   ```
   `match` + `trigger_hash` are **captured inline at load time** (one frontmatter read
   per mage-recognized skill) because they are **capture-time-only** — you cannot
   recover "what the trigger said when it fired" after it is edited, and optimize's
   held-out gate must attribute a match-rate to a *specific* trigger version. Foreign
   skills (not mage's own) record `skill` only.

4. **`tool_use` is a *salient extract*, not a transcript copy.** The cost data is
   decisive: agentmemory captures deterministically at ≈$10/yr / 95% recall, while
   mem0's LLM-summary-per-write costs ≈$500/yr / 68% recall; and the salient core of a
   memory is ≈38 tokens, not ECC's blind 5000-char dump. So:
   ```jsonc
   { "type":"tool_use", "tool":"Bash", "paths":[],
     "detail":"pnpm test -- redact",      // ≤200, redacted, deterministic per-tool salient field
     "ok": false, "error_summary":"3 failing in redact.test" }  // redacted, truncated
   ```
   - `paths[]` extracted from **structured** inputs only (Read/Write/Edit→`file_path`;
     Glob/Grep→`path`/`pattern`). **Bash commands are NOT parsed for paths** (unreliable).
   - `detail` is a mechanical per-tool string (Bash→command, Grep→pattern, WebFetch→url),
     **null** when `paths[]` already says it. **No LLM at capture** — that is both the
     cost trap *and* the recall-loss trap mem0 falls into.
   - **No raw `input`/`output`.** ECC stores them only because its distiller is a
     *separate blind process*; mage's distill rides the host agent, which has
     `transcript_path` for prose. `salience` is a pure function of `(tool, ok)` —
     **derived, not stored**.

5. **Gate-1 redaction is internal to `observe`, scrub-only, never-block.** It calls the
   shared `redact()` engine (full ruleset incl. entropy) in-process on the free-text
   fields only — `user_prompt.text`, `tool_use.detail`, `tool_use.error_summary`,
   `skill_load.args` — leaving structured identifiers (`paths`, `tool`, hashes, `cwd`)
   untouched. **Fail-closed on redaction** (a scrubber throw → `[REDACT-ERROR]`, never
   raw), **fail-open on observe** (any other error → degrade/drop the line, `exit 0`,
   never break the host session). This *refines* [ADR-0014](0014-two-gate-redaction.md):
   the gate distinction is **behaviour** (scrub-and-continue vs scan-and-block), not
   ruleset strength.

6. **`mage observe` is a plumbing-tier command; scratch hygiene is internal.** It is a
   CLI entry invoked **by host hooks** (a process boundary — there is no internal-call
   path, unlike Gate-1 redaction), never typed by a human. `.learnings/` size-cap
   rotation + age-purge live **inside** observe (ECC parity) — there is **no
   `mage clean`**. Retain tiny `skill_load` events longer than bulky `tool_use` events
   so the context-match signal survives purge. See the command taxonomy in
   [CONVENTIONS §10](../../CONVENTIONS.md) ([ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)'s
   determinism line: a hook *fires* a deterministic command or *nudges* a judgment
   skill, never reasons).

## Considered options

- **Freeze the full event vocabulary now** — rejected: forces designing six unbuilt
  releases' data needs blind; any miss is a `v`-bump anyway. Lock the envelope + rule.
- **Emit `skill_load` via skill self-report / transcript-grep** — rejected as
  unnecessary: the `Skill` tool call already *is* the load event, deterministically
  observable.
- **Fat `tool_use` (ECC's truncated input/output)** — rejected: ECC is fat only
  because its distiller is a blind separate process; mage has the transcript + a host
  reasoner, so fat just bloats scratch and widens the leak surface.
- **Thin `tool_use` (paths+ok only)** — rejected mid-grill: starves cold-distill of
  *what was learned*, forcing the expensive transcript re-read the write-once/read-many
  principle exists to avoid. The salient extract is the middle that serves both.
- **A weaker "fast" Gate-1 ruleset** — rejected: a weaker scrub just lets more live
  secrets rest in `.learnings/`; the full ruleset is sub-ms on truncated fields.

## Consequences

- One new plumbing command (`mage observe`) and a stable `.jsonl` contract every
  downstream release reads; `v` + the additive rule absorb their event-type additions.
- `skill_load` snapshotting needs a "is this a mage skill?" check + a frontmatter read
  per load — cheap, bounded.
- Gate-1's refinement is folded back into [ADR-0014](0014-two-gate-redaction.md).
- The compute over this schema (context-match, ladder, applier) is
  [ADR-0016](0016-context-match-confidence-ladder-applier.md); read-only metrics land
  in 0.0.5, capture in 0.0.7.

## Relations

- realizes [ADR-0013 — procedure skills + the self-grooming loop](0013-procedure-skills-self-grooming-loop.md) — fixes the load-bearing `.jsonl`
- rides [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md)
- refines [ADR-0014 — two-gate redaction](0014-two-gate-redaction.md) — Gate distinction is behaviour, not strength
- read_by [ADR-0016 — context-match, the confidence ladder, and the single applier](0016-context-match-confidence-ladder-applier.md)
- mines ECC `continuous-learning-v2` (`observations.jsonl`), mem0, Microsoft SkillOpt, Claude Code hook stdin
- sequenced_by [release sequence](../notes/plan-release-sequence.md)
