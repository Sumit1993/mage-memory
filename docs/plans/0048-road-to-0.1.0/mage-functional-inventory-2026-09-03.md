# Mage functional inventory -- 2026-09-03

Ground truth of what mage does today, by interaction surface.
Branch: docs/adr-0048-enforcement-redirection.
All file paths are relative to the repo root unless otherwise noted.

---

## 1. CLI commands

Source: `src/cli-program.ts`, individual files under `src/commands/`.
Telemetry note: mage has no phone-home telemetry (ADR-0021). The only counting
that happens at run-time is local metric updates written to `.mage/metrics/`.

### mage init [options] [name]

Scaffolds a knowledge base. With no arguments and inside a git repo, creates an
in-repo KB at `mage/`; not a git repo, creates a standalone hub in the current
directory. With a name argument, creates a hub at `./name` (or at the given path).
Source: `src/commands/init.ts`
Governing ADRs: ADR-0008, ADR-0012, ADR-0046
Telemetry: none.

Flags that change behaviour materially:
- `--in-repo` -- force in-repo KB even when a positional name is absent.
- `--hub` -- force standalone hub.
- `--private / --public / --local` -- hub visibility when creating a GitHub repo.
- `--no-connect` -- skip auto-wiring capture hooks after init.
- `-y / --yes` -- non-interactive, use defaults.

### mage index [options]

Regenerates `INDEX.md` and `MEMORY.md` (the two recall surfaces). Idempotent.
At a hub root also fans out to regenerate per-project pairs. MEMORY.md roster
order consults local usage metrics (tally) when present.
Source: `src/commands/index-cmd.ts`
Governing ADRs: ADR-0006, ADR-0033, ADR-0039, ADR-0041
Telemetry: none; reads `.mage/metrics/tally.json` for ordering.

Flags:
- `-d / --dir` -- explicit docs root.

### mage skills [options]

Regenerates one auto-loaded per-wing skill into `.claude/skills/` and
`.agents/skills/`. In `--metrics` mode, folds the context-match rollup from
`.mage/metrics/` and reports skill-load match rates without regenerating skills.
Source: `src/commands/skills-cmd.ts`
Governing ADRs: ADR-0006, ADR-0013, ADR-0016
Telemetry: `--metrics` reads `.mage/metrics/rollup.json`; `--quiet` is used by
the Stop hook to update the rollup silently.

Flags:
- `-d / --dir` -- explicit docs root.
- `--metrics` -- report match rates without regenerating.
- `--json` -- emit metric rows as JSON.
- `--quiet` -- update rollup silently (Stop-hook path).

### mage footprint [options]

Reports context-window cost: bytes and lines of launch surfaces, token estimate,
yield (notes tracked vs. ever read), pointer leverage. Reads tally for yield.
Source: `src/commands/footprint.ts`, `src/metrics/footprint.ts`
Governing ADRs: ADR-0039
Telemetry: none (read-only).

Flags:
- `--json` -- emit as JSON.
- `--quiet` -- return result without printing.

### mage dream [options]

Without `--apply`: reports KB health (stale notes, dangling links, orphans).
With `--apply`: reads one Proposal JSON from stdin and executes it through the
single serialized writer (graduate, reword, demote). With `--reject`: records one
Proposal JSON in the rejected-edit buffer.
Source: `src/commands/dream-cmd.ts`, `src/dream.ts`
Governing ADRs: ADR-0013, ADR-0016
Telemetry: none.

Flags:
- `-d / --dir` -- explicit docs root.
- `--stale-days N` -- flag notes older than N days (default 180).
- `--strict` -- exit 1 if any findings.
- `--json` -- emit report as JSON.
- `--apply` -- apply one Proposal from stdin (the single writer).
- `--reject` -- record one Proposal in the rejected-edit buffer.

### mage link hub-path

Links a code repo to an existing hub. Records `hub_repo` (the authoritative
remote address) and for hub-owned storage creates a project slot under
`projects/`. Auto-detects storage kind from the presence of `mage/` content.
Source: `src/commands/link.ts`
Governing ADRs: ADR-0011, ADR-0023, ADR-0043
Telemetry: none.

Flags:
- `--project name` -- project name in the hub.
- `--storage repo-owned|hub-owned` -- override auto-detected storage.
- `--no-connect` -- skip auto-wiring hooks after link.
- `-y / --yes` -- non-interactive.

### mage unlink

Removes a mage linkage from a code repo. Updates both `mage/metadata.json` and
the hub registry.
Source: `src/commands/unlink.ts`
Governing ADRs: ADR-0011
Telemetry: none.

Flags:
- `--hub path` -- specific hub to unlink from.
- `--delete-hub-side` -- also delete the hub-owned project dir.
- `-y / --yes` -- non-interactive.

### mage verify [code-repos...]

Sanity-checks a hub's structure and optionally linked code repos. Exits 1 on
failure.
Source: `src/commands/verify.ts`
Governing ADRs: ADR-0011
Telemetry: none.

Flags:
- `--hub path` -- hub root (default: cwd).

### mage list

Lists registered projects in a hub.
Source: `src/commands/list.ts`
Governing ADRs: ADR-0011
Telemetry: none.

Flags:
- `--hub path` -- hub root.

### mage migrate

Upgrades a KB's `metadata.json` to the current schema. Idempotent; never commits.
Source: `src/commands/migrate.ts`
Governing ADRs: ADR-0043, ADR-0047
Telemetry: none.

Flags:
- `--dir path` -- explicit docs root.

### mage adopt

Onboards pre-existing Claude Code memories into the KB capture inbox. In-shape
captures are placed at the docs-root top; out-of-shape sources are reported for
manual distill. Plan-first; never commits.
Source: `src/commands/adopt.ts`
Governing ADRs: ADR-0034
Telemetry: none.

Flags:
- `-d / --dir` -- explicit docs root.
- `--all` -- whole-machine sweep across all KBs.
- `--dry-run` -- plan only, write nothing.
- `-y / --yes` -- skip confirmation prompt.

### mage status code-repos...

Checks per-machine link health for one or more code repos. Exits 1 on failure.
Source: `src/commands/status.ts`
Governing ADRs: ADR-0045
Telemetry: none.

### mage autonomy [level]

Shows or sets the KB grooming autonomy level: operator (default), approver, or
overseer. Never commits.
Source: `src/commands/autonomy.ts`
Governing ADRs: ADR-0030
Telemetry: none.

Flags:
- `--dir path` -- explicit docs root.

### mage doctor [options]

Diagnoses environment, KB, connection, and recall readiness across three layers:
capture, recall, skills. With `--fix`, repairs missing capture-sink ignore rules.
With `--report`, bundles a redacted support package. Exits 1 on failure.
Source: `src/commands/doctor.ts`
Governing ADRs: ADR-0017, ADR-0021, ADR-0037, ADR-0042, ADR-0043
Telemetry: none (read-only diagnostics; `--report` bundles local logs only).

Flags:
- `--hub path` -- hub root.
- `--fix` -- add missing capture-sink ignores.
- `--report` -- print redacted support bundle.

### mage dashboard [options]

Generates `Dashboard.md` plus `Knowledge.base` (Obsidian data). With `--html`,
also generates a self-contained `dashboard.html` cockpit.
Source: `src/commands/dashboard-cmd.ts`, `src/dashboard/`
Governing ADRs: ADR-0020
Telemetry: none.

Flags:
- `--html` -- also generate the HTML cockpit.
- `--hub path` -- hub root.
- `--open` -- print the open command.
- `--open-with file|obsidian|vscode` -- link target for note clicks.

### mage connect [options]

Wires mage capture hooks into the repo's `.claude/settings.local.json` (personal
+ gitignored). In hub/hybrid modes also grants the harness filesystem access to
out-of-repo KB roots (`permissions.additionalDirectories`, reach tier). Optionally
installs the redaction pre-commit hook. If CC auto-memory is on and a docs root
resolves, commandeers `autoMemoryDirectory` to the KB root (commandeer tier).
After wiring, offers to adopt any pre-existing memories whose origin cwd maps to
this KB.
Source: `src/commands/connect.ts`, `src/adapters/claude-code/settings.ts`
Governing ADRs: ADR-0017, ADR-0032, ADR-0033, ADR-0042, ADR-0043
Telemetry: none.

Flags:
- `--user` -- target `~/.claude/settings.json` instead of the repo-local file.
- `--all-projects` -- from a hub, wire every registered project's code repo.
- `--no-git-hook` -- skip redaction pre-commit hook install.
- `-y / --yes` -- non-interactive; auto-confirms including clone-on-demand.

### mage disconnect [options]

Removes mage capture hooks from the Claude Code settings file. Restores any
stashed `autoMemoryDirectory`. Leaves host hooks intact.
Source: `src/commands/disconnect.ts`
Governing ADRs: ADR-0017, ADR-0032, ADR-0042
Telemetry: none.

Flags:
- `--user` -- target global settings.
- `--no-git-hook` -- skip removing the pre-commit hook.
- `-y / --yes` -- non-interactive.

### Hidden plumbing commands (not shown in --help)

**mage observe** -- Hook-fired capture seam. Reads a Claude Code hook JSON on
stdin, maps it to one ObserveEvent, scrubs free-text fields (Gate-1 redaction),
and appends to `.mage/learnings/`. Never throws; always exits 0.
Source: `src/commands/observe.ts`
Governing ADRs: ADR-0015
Telemetry: writes `.mage/learnings/*.jsonl`.

**mage nudge** -- Boundary nudge adapter. Fired from SessionStart hook on
compact/startup/resume. Computes the digest of the last closed chapter, backlog
tally, and autonomy-scaled mandate, and emits them as `additionalContext` plus
`systemMessage`. Also appends a footprint trend row.
Source: `src/adapters/claude-code/nudge.ts`
Governing ADRs: ADR-0029, ADR-0030, ADR-0039
Telemetry: appends to `.mage/metrics/footprint-trend.jsonl`.

**mage memory-hook** -- Gate-0 capture gate (commandeer tier). On PreToolUse
Write/Edit: denies writes to generated indexes; scrubs and rewrites topic note
writes in-flight. On PostToolUse Write/Edit: emits a capture nudge pointing at
`mage groom`.
Source: `src/adapters/claude-code/memory-hook.ts`
Governing ADRs: ADR-0032, ADR-0035
Telemetry: none.

**mage distill** -- Reads `.mage/learnings/*.jsonl` from the last watermark
forward, segments by compact/session-end boundaries, and emits a DistillManifest.
Plumbing behind `mage:groom` Phase 1.
Source: `src/commands/distill-cmd.ts`, `src/distill/`
Governing ADRs: ADR-0018, ADR-0024
Telemetry: `--seen` advances the per-session watermark.

**mage promote** -- Folds closed `.mage/learnings/` segments from the last
watermark forward into a note-read usage tally and emits graduate proposals.
Plumbing behind `mage:graduate`.
Source: `src/commands/promote-cmd.ts`, `src/grooming/`
Governing ADRs: ADR-0019, ADR-0038
Telemetry: writes `.mage/metrics/tally.json`.

**mage stage** -- Stages a short lesson draft into `.mage/staging/` with
in-flight redaction. Inline-capture path.
Source: `src/commands/stage-cmd.ts`, `src/grooming/staging.ts`
Governing ADRs: ADR-0024
Telemetry: writes `.mage/staging/`.

**mage groom** -- Surfaces/accepts/rejects the staged lesson batch. With
`--accept`, moves drafts into `notes/` and re-indexes. With `--reject`, discards
and records the key.
Source: `src/commands/groom-cmd.ts`
Governing ADRs: ADR-0024
Telemetry: reads/writes `.mage/staging/`.

**mage ingest dir** -- Read-only scan of a directory for importable sources.
Emits a classified manifest: `skill | note | prose | transcript`. Plumbing
behind `mage:learn --from`.
Source: `src/commands/ingest.ts`, `src/ingest.ts`
Governing ADRs: ADR-0034
Telemetry: none.

**mage redact [file]** -- Scans a file or stdin for secrets and PII using
deterministic regex rules. With `--strip`, emits redacted text. With `--staged`,
scans staged git changes (pre-commit gate). With `--check`, report-only mode.
Source: `src/commands/redact.ts`, `src/redact.ts`
Governing ADRs: ADR-0014
Telemetry: none.

**mage flatten** -- Normalizes harness-shaped (Claude Code) notes to mage's flat
schema. `--staged` applies at the commit boundary; `--all` sweeps every note.
Never blocks.
Source: `src/commands/flatten.ts`, `src/adapters/claude-code/flatten.ts`
Governing ADRs: ADR-0035
Telemetry: none.

---

## 2. Skills shipped by the plugin

Skills live under `skills/*/SKILL.md` and are loaded as Claude Code skills.

### mage:guide

Trigger: use when the current repo has `mage/metadata.json`, when inside a hub,
when modifying anything under `mage/`, or when the user invokes `/mage`.
What it reads: `mage/metadata.json`, `INDEX.md`, `_index.*.md`, notes under the
docs root, `CONVENTIONS.md`, decision records under `decisions/`.
What it writes: nothing (read-only orientation skill).
CLI it calls: suggests `mage index`, `mage skills`, and `git` commands (never
runs them).
Source: `skills/guide/SKILL.md`
Governing ADRs: ADR-0006, ADR-0041

### mage:learn

Trigger: when the user invokes `mage:learn`, says "remember", "capture", or
"save" a finding, or immediately after a non-obvious discovery.
What it reads: `mage/INDEX.md`, `mage/notes/`, `mage/metadata.json`,
`_index.*.md`, `CONVENTIONS.md`.
What it writes: one note under `mage/notes/` after user confirmation and a clean
Gate-2 redaction check; may also edit an existing note (MERGE/SUPERSEDE).
CLI it calls: `mage redact draft-file` (Gate 2 before write); in bulk-import mode
`mage ingest dir --json` first; then suggests `mage index`, `mage skills`, and
`git` commands.
Source: `skills/learn/SKILL.md`
Governing ADRs: ADR-0004, ADR-0013, ADR-0014, ADR-0041

### mage:groom

Trigger: session boundaries, after a PreCompact, or when the user says "groom",
"distill", "promote", "mine the learnings", or "what did we learn". Also invoked
by the boundary nudge.
What it reads: `.mage/learnings/*.jsonl` (via `mage distill --json`),
`.mage/staging/` (via `mage groom --json`), `mage/INDEX.md`.
What it writes: notes under `mage/notes/` after Gate-2 redaction and human
confirm (or autonomy waiver); advances distill and promote watermarks via
`--seen`.
CLI it calls: `mage groom --json`, `mage distill --json`, `mage promote --json`,
`mage groom --accept/--reject`, `mage distill --seen`, `mage index`.
Source: `skills/groom/SKILL.md`
Governing ADRs: ADR-0013, ADR-0014, ADR-0018, ADR-0019, ADR-0024, ADR-0029,
ADR-0030

### mage:graduate

Trigger: when the user says "graduate", "make this a skill", or when `mage:groom`
Phase 2 surfaces a proven note with `action: "graduate"`.
What it reads: `mage promote --json` output, the backing note at `target`.
What it writes: `mage-skill-<slug>/SKILL.md` into `.claude/skills/` and
`.agents/skills/`; re-writes the note with a `graduated_skill:` pointer. All
writes go through `mage dream --apply` (the single writer, enforces ceilings).
CLI it calls: `mage promote --json`, `mage dream --apply`.
Source: `skills/graduate/SKILL.md`
Governing ADRs: ADR-0013, ADR-0019, ADR-0038

### mage:optimize

Trigger: when the user says "optimize", "are my skills firing right", "tune my
triggers", or periodically once context-match has enough loads to judge.
What it reads: `mage skills --metrics --json` (the context-match rollup).
What it writes: rewrites the frontmatter `description:` of a generated skill, or
archives a skill (demote). All writes via `mage dream --apply`.
CLI it calls: `mage skills --metrics --json`, `mage dream --apply`,
`mage dream --reject`.
Source: `skills/optimize/SKILL.md`
Governing ADRs: ADR-0013, ADR-0016

---

## 3. Hooks mage installs via connect

`mage connect` writes groups into `.claude/settings.local.json` under the `hooks`
key. Each group is tagged with a stable `id` of the form `mage:...`.
Source: `src/adapters/claude-code/settings.ts` (MAGE_HOOKS constant),
`src/commands/connect.ts`.
Governing ADRs: ADR-0015, ADR-0017, ADR-0029, ADR-0030, ADR-0032, ADR-0035.

### SessionStart -- id: mage:observe:SessionStart

Event: SessionStart.
Records: appends a `session_start` event to `.mage/learnings/`, containing
`session_id`, `cwd`, `repo_root`, `mage_version`, `source`.
Where it writes: `.mage/learnings/<session>.jsonl`.

### SessionStart -- id: mage:nudge:SessionStart

Event: SessionStart.
Records: fires only on source compact/startup/resume. Emits
`additionalContext` (model-only: digest + mandate + optional dream-health tick)
and a terse `systemMessage` (user-visible terminal line). Appends one footprint
trend row.
Where it writes: `.mage/metrics/footprint-trend.jsonl`,
`.mage/.nudge-state.json` (throttle/chapter-shown state).

### UserPromptSubmit -- id: mage:observe:UserPromptSubmit

Event: UserPromptSubmit.
Records: scrubs the prompt text (Gate-1) and appends a `user_prompt` event.
Where it writes: `.mage/learnings/<session>.jsonl`.

### PostToolUse -- id: mage:observe:PostToolUse (no matcher)

Event: PostToolUse.
Records: if `tool_name == "Skill"`, appends a `skill_load` event with the skill
name, args, match snapshot (wing/keywords/paths from the loaded SKILL.md), and
trigger_hash. Otherwise appends a `tool_use` event with structured path
extraction (Read/Write/Edit/NotebookEdit: `file_path`; Glob/Grep: `path`; Bash:
command string as `detail`; WebFetch: URL as `detail`), `ok` flag, and scrubbed
`error_summary` when not ok.
Where it writes: `.mage/learnings/<session>.jsonl`.

### PostToolUseFailure -- id: mage:observe:PostToolUseFailure

Event: PostToolUseFailure.
Records: maps to a `tool_use` event with `ok: false` and the top-level `error`
string as `error_summary`.
Where it writes: `.mage/learnings/<session>.jsonl`.

### PreCompact -- id: mage:observe:PreCompact

Event: PreCompact.
Records: appends a `compact` event with trigger field ("manual" or "auto").
Where it writes: `.mage/learnings/<session>.jsonl`.

### SessionEnd -- id: mage:observe:SessionEnd

Event: SessionEnd.
Records: appends a `session_end` event with optional reason.
Where it writes: `.mage/learnings/<session>.jsonl`.

### Stop -- id: mage:metrics:Stop

Event: Stop.
Records: folds closed skill-load forward windows into the context-match rollup.
Where it writes: `.mage/metrics/rollup.json`.

### Stop -- id: mage:observe:Stop

Event: Stop.
Records: reads the main-session transcript at `transcript_path`, finds the last
assistant message, scrubs it, appends an `assistant_msg` event.
Where it writes: `.mage/learnings/<session>.jsonl`.

### SubagentStop -- id: mage:observe:SubagentStop

Event: SubagentStop.
Records: identical to the Stop arm above but reads the subagent transcript,
capturing autonomous subagent work whose tool calls never reach the main-session
PostToolUse hook.
Where it writes: `.mage/learnings/<session>.jsonl`.

### PreToolUse -- id: mage:memory:PreToolUse (matcher: Write|Edit, commandeer only)

Event: PreToolUse, matcher Write|Edit.
Wired only when CC auto-memory is on and a docs root resolves.
Records/injects: for a flat `.md` file at the docs root -- if it is a generated
index (MEMORY.md, INDEX.md, `_index.*.md`, etc.), emits a `deny` decision that
blocks the write. If it is a topic note, runs `redact()` in-flight on the content
and returns `updatedInput` with secrets replaced (Gate-0); frontmatter schema is
NOT reshaped at write time (that is the durable boundary's job). Subdirectory
writes, non-`.md` files, and paths outside the root pass untouched.
Where it writes: nothing to disk; emits JSON on stdout consumed by CC.

NOTE: PreToolUse denials or redirects fired by OTHER plugins are NOT recorded in
mage's `.mage/learnings/` because the observe hooks listen on PostToolUse, which
does not fire when a PreToolUse hook denied or redirected the call. A denial from
another plugin therefore leaves no trace in mage's event log.

### PostToolUse -- id: mage:memory:PostToolUse (matcher: Write|Edit, commandeer only)

Event: PostToolUse, matcher Write|Edit.
Wired only when CC auto-memory is on and a docs root resolves.
Injects: for a flat topic note write (not a generated index), emits an
`additionalContext` nudge pointing the agent at `mage groom` to review and accept
the capture.
Where it writes: nothing to disk; emits JSON on stdout.

### Stop -- id: mage:flatten:Stop (commandeer only)

Event: Stop.
Records: normalizes any CC-restamped note back to mage's flat schema. Never
blocks; never commits.
Where it writes: edits `.md` files at the docs root in the working tree.

---

## 4. Session-start nudge and digest

Source: `src/adapters/claude-code/nudge.ts`,
`src/adapters/claude-code/nudge-state.ts`,
`src/distill/digest.ts`, `src/distill/reader.ts`.
Governing ADRs: ADR-0029, ADR-0030, ADR-0039.

On each qualifying SessionStart (source compact/startup/resume):

**Footprint trend sample:** measures MEMORY.md byte and line occupancy relative to
CC's cap and appends a row to `.mage/metrics/footprint-trend.jsonl`.

**Digest:** reads the last closed compact-chapter from `.mage/learnings/` using a
watermark in `.mage/.nudge-state.json`. On compact source, renders the
just-closed chapter's failure signals, user corrections, and tool sequences as a
read-only digest. On startup/resume, renders the prior session's final chapter.
The model-only `additionalContext` channel receives the full digest plus an
autonomy mandate. On session entry the agent is instructed to name one genuine
keeper and offer to capture it via `/mage:learn` -- not auto-file, whatever the
autonomy level.

**Backlog tally:** counts staged drafts (`.mage/staging/`), unmined closed
chapters, and graduation-eligible notes. Throttled to once per
`grooming.nudgeThrottleHours` (default 4 hours) across sources, using an mtime
fingerprint of the scratch directory. A compact source bypasses the throttle.

**Autonomy mandate:** reads `grooming.autonomy` from `metadata.json`; templates a
level-appropriate instruction block into `additionalContext`.

**Dream-health tick:** at most once per 7 days, reads the dream report and folds
a rot summary (stale, dangling, orphans) into both the terminal line and the model
context, asking the agent to offer `mage dream`.

State kept: `.mage/.nudge-state.json` (chapter-shown timestamp, last-reminded
timestamp, last-dream timestamp, scratch fingerprint, cached tally).

---

## 5. Generated artifacts

### INDEX.md

What generates it: `mage index` (`src/commands/index-cmd.ts`).
What reads it: `mage:guide`, `mage:learn` (overlap check), `mage:groom`; agents
reading the docs root.
Content: one line per memory-genre note, alphabetically by wing then title.
Includes type, title, keywords, and a relative link. Cross-cutting notes appear
under their own section.

### MEMORY.md

What generates it: `mage index`.
What reads it: Claude Code auto-loads it at session launch via
`autoMemoryDirectory` (the commandeer tier).
Content: a budget-bounded top-K roster of memory-genre notes by rank (usage-proven
first when local tally exists, else recency). Ends with an overflow pointer back
to `INDEX.md`.

### _index.<wing>.md (per-wing index)

What generates it: `mage index` (per-wing slice).
What reads it: `mage:groom` on first sight, agents following links from INDEX.md.
Content: one line per note tagged with that wing.

### Per-wing skills (mage-wing-<wing>/SKILL.md)

What generates them: `mage skills` (`src/commands/skills-cmd.ts`).
What reads them: Claude Code and agent harnesses load them as skills via
`.claude/skills/` and `.agents/skills/`. Each skill's `description:` is the
trigger.
Content: auto-generated SKILL.md with a `Load when...` trigger and a link to the
wing's `_index.<wing>.md`. Marked with `GEN_MARKER` so the single writer knows it
is safe to rewrite.

### Dashboard.md and dashboard.html

What generates them: `mage dashboard`.
What reads them: humans; the HTML cockpit opens in any browser.
Content: KB health summary, proposal queue, note counts by wing, provenance stats.

---

## 6. Observe schema

Source: `src/observe/types.ts`, `src/observe/events.ts`.
Governing ADR: ADR-0015.
Storage: `.mage/learnings/<session-id>.jsonl`, one JSON object per line.
Schema version: `v: 1` on every line. Additive-only evolution; a new optional
field or new type is non-breaking; renaming or removing a field bumps `v`.

Common envelope fields on every event: `v`, `ts` (ISO-8601 UTC), `session`,
`type`.

### session_start

Fields: `harness`, `cwd`, `repo_root` (null if unresolved), `mage_version`,
`source` (e.g. "startup", "resume", "compact").

### user_prompt

Fields: `text` (scrubbed, truncated to 2000 chars).

### assistant_msg

Fields: `text` (scrubbed, truncated to 2000 chars; read from transcript via
Stop/SubagentStop hook).

### skill_load

Fields: `skill` (name), `args` (scrubbed string or null), `match` (snapshot of
`{wing, keywords, paths}` from the loaded SKILL.md; null for foreign skills),
`trigger_hash` (SHA-256 hex of the trimmed description; null for foreign skills).

### tool_use

Fields: `tool` (tool_name verbatim), `paths` (extracted from structured inputs:
`file_path` for Read/Write/Edit/NotebookEdit; `path` for Glob/Grep; [] for Bash
and all others), `detail` (per-tool salient field: Bash command, Grep/Glob
pattern, WebFetch URL; null when paths carries the datum), `ok` (false on error),
`error_summary` (scrubbed, truncated to 200 chars; null when ok).

### compact

Fields: `trigger` ("manual" or "auto").

### session_end

Fields: `reason` (optional string; absent on crash).

---

## 7. Metrics that exist today

### Context-match

Source: `src/metrics/context-match.ts`, `src/metrics/rollup.ts`.
Governing ADR: ADR-0016.
Command: `mage skills --metrics`.

What it measures: for each `skill_load` carrying a `match` snapshot, checks
whether the next 20 tool-use/user-prompt events (forward window) touched the
skill's wing (as a path segment in touched tool paths), keywords (whole-word in
prompt text or tool detail), or paths (glob match; dormant because `match.paths`
is currently []). A load is closed when the window fills or a terminator appears.
Match rate = closed matches / closed loads. Advisory thresholds: reword-suggested
at rate < 0.4, demote-suggested at rate < 0.2 with >= 5 loads.

Where it stores: `.mage/metrics/rollup.json`. Updated by the Stop hook via
`mage skills --metrics --quiet`.

### Footprint

Source: `src/metrics/footprint.ts`.
Governing ADR: ADR-0039.
Command: `mage footprint`.

What it measures: byte and line occupancy of launch surfaces vs. CC's cap; yield
(sessions with tally data, notes tracked, notes ever read -- a note is "read" if
its chapter count in tally >= 1); pointer leverage (measurable/dead/unmeasurable
source links).

Where it stores: `.mage/metrics/footprint-trend.jsonl` (one row per session start,
appended by the nudge hook).

### Keep-rate

Source: `src/grooming/reconcile.ts`.
Governing ADR: ADR-0031.

What it measures: ratio of autonomously-written notes (marked
`provenance.autonomy: approver|overseer`) that the human kept vs. reverted via
`git revert`. Read from git log at the docs root. Advisory signal for whether
higher autonomy is worth enabling.

Where it stores: none persisted; computed on demand by the nudge.

### Note-read fold (graduation gate)

Source: `src/grooming/note-reads.ts`, `src/grooming/tally.ts`.
Governing ADR: ADR-0038.
Command: `mage promote`.

What it measures: per closed compact-chapter, counts distinct notes opened via
Read/Edit tool calls. Chapters in which any mage-own skill loaded are excluded
(self-referential reads must not inflate graduation counts). A note's chapter
count accumulates in the tally. Notes at or above the M threshold with type
procedure/gotcha (or legacy playbook) become graduate proposals.

Where it stores: `.mage/metrics/tally.json` (v4 schema).

---

## 8. Config surfaces

### metadata.json (docs-root or hub root)

Mage reads:
- `schema` ("mage.v2"), `mode` ("in-repo" | "hybrid" | "external"), `project`,
  `hub_repo` (authoritative remote URL), `hub_path` (deprecated fallback),
  `hub_refs[]` (hybrid: array of `{hub_repo, hub_path, project}`).
- `grooming.autonomy` ("operator" | "approver" | "overseer").
- `grooming.nudgeThrottleHours` (backlog-reminder throttle, default 4h).
- `grooming.sensitivity` (capture sensitivity dial).
- `grooming.crownThreshold` (graduation badge threshold).
- `grooming.proposals` (accepted/rejected proposal ledger).
- `redact.ignore` (glob patterns to skip), `redact.allow` (literal allowlist).
- `genres` (map of custom type strings to recall genres).

Hub-root `metadata.json` additional keys: `name`, `projects[]` (`{name, storage,
code_repo_path, code_repo_url}`).

### .claude/settings.local.json (keys mage writes)

- `hooks` -- event-to-hook-groups map, each group tagged `id: "mage:..."`.
- `autoMemoryDirectory` -- set to KB docs root when commandeer tier is active.
  Machine-specific; gitignored.
- `mageStashedAutoMemoryDirectory` -- user's prior value, stashed by connect so
  disconnect can restore it.
- `permissions.additionalDirectories` -- extended with out-of-repo KB roots
  (reach tier). Machine-specific; gitignored.
- `mageOwnedAdditionalDirectories` -- entries mage inserted, so disconnect
  removes only what it added.

### Autonomy levels (ADR-0030)

| Level | Human role | Agent behaviour at a boundary |
|---|---|---|
| operator (default) | HITL per note | stages from digest; human runs mage:groom |
| approver | HITL at batch commit | writes clearly-durable notes without per-note pause; borderline stays staged |
| overseer | HOTL | as approver plus disposes borderline tier, merges into existing notes, graduates eligible notes |

Set by `mage autonomy`. Stored in `metadata.json` under `grooming.autonomy`.

### grooming.proposals

The accept/reject ledger for `mage dream`. Entries record which Proposal JSON
strings were applied or rejected, with autonomy attribution.

---

## 9. Interaction map

For a Claude Code session in a connected repo with commandeer tier active, in
time order:

| Order | Event | What mage touches |
|---|---|---|
| 1 | SessionStart fires | mage observe: appends `session_start` to `.mage/learnings/` |
| 2 | SessionStart fires | mage nudge: renders digest plus backlog mandate; on compact renders just-closed chapter; appends footprint row; updates `.mage/.nudge-state.json` |
| 3 | Session opens | CC auto-loads `MEMORY.md` from docs root (autoMemoryDirectory); per-wing skill SKILL.md descriptions evaluated as triggers by CC |
| 4 | Each user prompt | mage observe (UserPromptSubmit): appends `user_prompt` event |
| 5 | Agent loads a skill | mage observe (PostToolUse, tool=Skill): appends `skill_load` event with match snapshot |
| 6 | Agent issues Write/Edit targeting docs root | mage memory-hook (PreToolUse): denies write to generated indexes; scrubs topic note content in-flight; pass for all other targets |
| 7 | Each tool call completes | mage observe (PostToolUse): appends `tool_use` event |
| 8 | Write/Edit to a topic note completes | mage memory-hook (PostToolUse): emits capture nudge pointing at `mage groom` |
| 9 | Turn ends (Stop) | mage skills --metrics --quiet: updates `.mage/metrics/rollup.json` |
| 10 | Turn ends (Stop) | mage observe: reads last assistant message from transcript, appends `assistant_msg` event |
| 11 | Turn ends (Stop, commandeer) | mage flatten --quiet: normalizes any CC-restamped note to mage's flat schema |
| 12 | Compact boundary | PreCompact: mage observe appends `compact` event |
| 13 | Next SessionStart after compact | steps 1-2 repeat; nudge now renders the just-closed chapter digest |
| 14 | Agent or user runs mage:groom | mage distill --json and mage promote --json run; agent judges clusters; accepted notes written to `mage/notes/`; mage index refreshes INDEX.md and MEMORY.md |
