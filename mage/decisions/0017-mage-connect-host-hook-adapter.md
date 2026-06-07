---
type: decision
tags: [mage/decisions]
created: "2026-06-06"
updated: "2026-06-06"
last_reviewed: "2026-06-06"
status: active
provenance:
  repo: mage-memory
  work: grill-connect-metrics
sources:
  - src/commands/observe.ts
  - src/commands/init.ts
  - src/gitignore.ts
  - ~/.claude/settings.json
---

# 0017 — `mage connect`: the host hook adapter (capture is opt-in)

A 2026-06-06 grill resolved release **0.0.6**: how `mage observe`
([ADR-0015](0015-mage-observe-capture-schema.md)) actually gets fired by a host, and
how the read-only context-match metrics ([ADR-0016](0016-context-match-confidence-ladder-applier.md))
are computed and surfaced. This realizes [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)'s
per-harness "adapter-installer" (mined from agentmemory's `connect`), Claude Code first.

## Decision

1. **`mage connect` is an explicit command; capture is NOT bundled with the skills
   plugin.** mage already ships skills as a Claude Code plugin, and a plugin can
   auto-register hooks via `hooks/hooks.json` — but that would turn observation *on*
   the moment someone installs mage's *skills*, conflating "I want `/learn`" with "I
   want mage recording my whole session." Auto-capture must be a conscious opt-in
   ([ADR-0013](0013-procedure-skills-self-grooming-loop.md) §4). So observe hooks stay
   **out** of the plugin; `mage connect` is the consent gate. (mage ships as an npm
   `bin`, so the wired command is a clean `mage observe` — no `${CLAUDE_PLUGIN_ROOT}`.)

2. **Default write target = `.claude/settings.local.json` (per-repo, personal,
   gitignored); `--user` writes `~/.claude/settings.json`.** Wiring into the *committed*
   `.claude/settings.json` would force capture on every teammate who pulls the repo —
   the same over-reach as auto-plugin-hooks. `settings.local.json` is Claude Code's
   gitignored personal layer, so capture is per-person and scoped to the repo holding
   the KB (where `.learnings/` lives). `--user` is the "capture everywhere I work"
   escape hatch. Consequence: connect is **per-repo by default** (run once per repo, or
   `--user` once).

3. **Safe merge via an `id:"mage:*"` marker; `mage disconnect` removes them.** Claude
   Code preserves custom `id`/`description` keys on hook entries (verified against a
   live `settings.json`). Every mage-written entry carries `id:"mage:<command>:<event>"`.
   - **connect** is read-modify-write: parse the file (or `{}`), **replace-by-id** each
     mage entry in `hooks[<event>]` (append if absent), **preserving every non-mage
     entry and every other top-level key**. Idempotent — re-running never duplicates.
   - **disconnect** strips all `id:"mage:*"` entries, prunes emptied arrays / an emptied
     `hooks` object.
   - **Safety:** missing file → create minimal; **malformed JSON → refuse with a clear
     error, never clobber**; **back up to `settings.local.json.bak`** before writing.
   - Reuses the idempotent-merge ethos already proven in `gitignore.ts`'s `ensureGitignored`.

4. **Dual-mode CLI (human-interactive / agent-one-go), via a shared helper.** Mirroring
   `init.ts`: each decision has a flag that skips its prompt; `--yes`/`-y` takes
   defaults; otherwise `@inquirer/prompts`. Generalized into a rule and a shared
   `resolveInteractive(opts)` applied to `init`/`link`/`unlink`/`connect`/`disconnect`:
   > **Non-TTY ⇒ non-interactive.** In non-interactive mode every decision resolves to
   > an explicit flag or a documented safe default; if a decision has neither, **fail
   > with a clear error naming the flag** — never hang, never silently guess a
   > consequential choice.
   So `mage connect --yes` always completes in one go; a bare `mage connect` prompts.

5. **mage ignores ECC entirely — no double-observe interlock.** [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)'s
   "the homunculus hooks must be disabled" is **amended**: running mage's observe and
   ECC's observer in parallel is **harmless** — separate files, separate formats,
   separate consumers; mage adds zero cost to ECC. The redundancy at the *durable*
   layer is already resolved by the **feeder model** ([ADR-0005](0005-one-canonical-memory-others-are-feeders.md)/[ADR-0013 §5](0013-procedure-skills-self-grooming-loop.md):
   ingest ECC via `mage learn --from`), which is better than presuming to disable
   another tool. connect does **no detection, no notice, no flag** — full ignore.

6. **The hook block** connect writes (all `id:"mage:*"`):

   | Event | Command |
   |---|---|
   | SessionStart · UserPromptSubmit · PostToolUse · **PostToolUseFailure** · PreCompact · SessionEnd | `mage observe` |
   | Stop | `mage skills --metrics --quiet` (rollup fold) |

   `PostToolUseFailure` is included (0.0.5 M3 — capture failures). The schema stays
   harness-neutral; other harnesses become **additive input adapters** (ADR-0009),
   never reopening this block.

7. **Read-only context-match metrics live under `mage skills`.** Context-match is a
   *skill* metric, so the skills command is its lifecycle home:
   - `mage skills` → (re)generate wing skills (unchanged).
   - **`mage skills --metrics`** → read-only report (`skill · loads · match-rate ·
     ok|reword-suggested|demote-suggested`), `--json` for agents. **Flags only — never
     acts** (acting is 0.0.8).
   - **Persistence (rollup, Option B):** a gitignored `mage/.metrics/context-match.json`
     (per `skill::trigger_hash`) is folded **incrementally each turn** by the `Stop`
     hook (`--metrics --quiet`). Folding before the raw `.learnings` events purge (~30d)
     is what lets the signal survive the purge cliff and **accumulate the history 0.0.8
     optimize needs** — on-demand recompute would lose it. Folding writes only the
     gitignored cache (no catalog mutation, no commit), so it stays "read-only" w.r.t.
     the KB.

8. **0.0.6 also fixes the 0.0.5 keyword-derivation noise at capture** (observe's
   `wingKeywords`): drop pure-numerics, a small ADR-boilerplate stoplist, and sub-3-char
   tokens, so `skill_load.match.keywords` is a usable predicate. **"dream tuning" is
   dropped** from 0.0.6 — the read-only "flag low-match skills" need is met by
   `mage skills --metrics`, and dream-as-applier is 0.0.8.

## Considered options

- **Plugin `hooks/hooks.json` auto-register** — rejected: capture-on-skill-install
  conflates consent; Claude-Code-only, so we'd still need `connect` for portability.
- **Write to committed `.claude/settings.json`** — rejected: forces capture + `.learnings`
  on every teammate. `settings.local.json` keeps it personal.
- **Detect + disable ECC (the ADR-0009 interlock)** — rejected: double-observe is
  harmless and disabling another tool is presumptuous; the feeder model consolidates
  better. Kept "full ignore."
- **On-demand metrics recompute (no rollup)** — rejected: loses loads that purge between
  runs; Option B's per-session fold preserves the history optimize will gate on.
- **A dedicated `mage metrics` command** — folded into `mage skills --metrics` instead
  (skills is the skill-lifecycle home; fewer top-level verbs).
- **`init`/`link`/`unlink` left on `--yes`-only** — rejected: leaves them hang-prone for
  agents; the shared `resolveInteractive` makes every command agent-safe.

## Consequences

- New human-tier verbs **`connect`/`disconnect`**; `mage skills` gains a read-only
  `--metrics` mode; a shared `resolveInteractive` helper threads through 5 commands.
- [ADR-0009](0009-no-runtime-automation-rides-host-hooks.md)'s interlock consequence is
  amended (coexist, don't disable).
- New gitignored derived artifact `mage/.metrics/context-match.json` (never committed,
  ADR-0016 §2).
- Capture is per-repo opt-in by default; the `.jsonl` schema stays the harness-neutral
  convergence layer (Codex/OpenCode adapters are additive, ADR-0009).
- CONVENTIONS §10 (command tiers) updated; the `Stop` metrics-fold is a new tier-1
  hook-fired plumbing path.

## Relations

- realizes [ADR-0009 — no runtime; automation rides host hooks](0009-no-runtime-automation-rides-host-hooks.md) — the per-harness adapter-installer; amends its double-observe interlock
- fires [ADR-0015 — mage observe capture schema](0015-mage-observe-capture-schema.md)
- surfaces [ADR-0016 — context-match, the confidence ladder, and the single applier](0016-context-match-confidence-ladder-applier.md) — read-only metrics + the rollup fold
- feeders_from [ADR-0005 — one canonical memory; others are feeders](0005-one-canonical-memory-others-are-feeders.md) — ECC consolidates via ingest, not disable
- sequenced_by [release sequence](../notes/plan-release-sequence.md)
