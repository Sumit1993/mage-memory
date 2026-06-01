---
type: decision
tags: [mage/decisions]
created: "2026-06-01"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: mage-memory
  commit: 1ec8225
sources:
  - https://github.com/rohitg00/agentmemory
---

# 0009 — No runtime of our own; automation rides the host agent's hooks + the agent's reasoning

mage has **no server, daemon, or runtime of its own** (ADR-0001/0003/0005/0007 — files-as-truth). Yet it wants to *automate* what is today user-invoked (`/learn`, `/dream`): capture durable insight without the human typing a command. The question this answers is *how a runtime-less tool automates anything.* The answer: **it doesn't run — it rides.** Automation borrows two things mage already sits inside: the **host agent's hook system** (for triggers + deterministic side-effects) and the **agent's own reasoning** (for judgment). Nothing runs in the background; mage has no background.

The dividing line is **determinism**: anything mechanical (firing on an event, staging raw observations, counting recurrence) is a deterministic `mage` CLI step a hook can invoke; anything requiring judgment (distilling a transcript into a note, confirming a promotion) stays an agent **skill**. Never smuggle a reasoner into the CLI, and never expect a hook to reason.

## How auto-capture works under this stance

1. **Stage (deterministic).** A `PostToolUse` / `Stop` hook invokes `mage observe`, which appends raw observations (tool, file, error, decision) to `.learnings/<session>.jsonl` — the git-ignored scratch dir already in the design. Zero LLM.
2. **Distill (judgment).** A `PreCompact` / `SessionEnd` hook *nudges* the agent ("distill `.learnings/` via `/learn` before context is lost"), or the awareness skill instructs proactive capture. The agent — not mage — reads the scratch + session and drafts notes (capture-by-pointer). `PreCompact` is the high-value moment: capture before the host discards context.
3. **Promote (gate, loosening over time).** Starts human-confirm; graduates to **auto-promote** when a pattern recurs ≥2× at confidence ≥ threshold — the homunculus ladder named in [ADR-0005](0005-one-canonical-memory-others-are-feeders.md) / [ADR-0006](0006-two-layer-recall-per-wing-skills.md).

## Delivery: per-harness adapters (mined from agentmemory's `connect`)

There is **no universal hook standard.** Mining agentmemory's approach ([ADR-0007](0007-mine-agentmemory-design-not-depend.md)): it supports ~15 agents by writing **N per-agent adapters**, each translating one capture model into that harness's native config — Claude Code `settings.json` hooks, Codex `.codex/config.toml` + lifecycle hooks, OpenCode `opencode.json` + a plugin `.ts`, etc. mage adopts the **adapter-installer** half of `connect` (not the server-sharing half — mage has no server to share): `mage connect <agent>` writes each host's native hook config, wiring hooks to `mage observe` instead of a daemon. **Ship Claude Code first; add adapters as demand appears.**

A graceful-degradation ladder follows. mage's baseline differs by storage choice — files need no running process, where agentmemory's assumes its `:3111` daemon; different defaults from different designs, not a ranking:

```
Tier 0  portable files + AGENTS.md   every agent, even plain grep   (have)
Tier 1  per-wing skills              mage skills → .claude/.agents  (have)
Tier 2  MCP recall accelerator       MCP-speaking agents            (v0.2, optional)
Tier 3  auto-capture hooks           mage connect <agent>, per host (the bespoke tier)
```

**MCP standardizes recall, not capture.** Even if mage adds the v0.2 MCP accelerator, that makes *recall* cross-agent; auto-*capture* still needs per-harness hooks. (agentmemory needs both MCP and per-agent plugins for exactly this reason.)

## Considered options

- **Build our own daemon / observe-loop** (agentmemory's model) — rejected: re-introduces the server ADR-0007 explicitly refused and inverts files-as-truth.
- **Manual-only forever** (`/learn`, `/dream` user-invoked) — rejected: doesn't scale as the base grows; automation is a stated goal once trust builds.
- **Ride host hooks + agent reasoning** (chosen) — runtime-less automation, portable notes, host-specific capture.

## Consequences

- Automation is **host-specific** (per-harness adapters); the *notes* stay portable, the *capture* does not. An honest, deliberate split — agents without an adapter fall back to manual `/learn`, losing nothing durable.
- **No double-observe:** if mage's loop is enabled, the homunculus PreToolUse/PostToolUse hooks must be disabled ([ADR-0005](0005-one-canonical-memory-others-are-feeders.md) / [ADR-0007](0007-mine-agentmemory-design-not-depend.md)).
- The deterministic/judgment line is now load-bearing: it governs `/learn`, `/dream`, and auto-capture alike — it is *the* thing that makes mage not agentmemory.
- Unblocks the roadmap's opt-in auto-capture observe-loop, scheduled `/dream`, and capture-before-compaction — all as host-hook applications, not new runtimes.

## Relations

- depends_on [ADR-0001 — memory-first product](0001-memory-first-product-supersedes-specshub.md)
- depends_on [ADR-0007 — mine agentmemory's design, don't depend](0007-mine-agentmemory-design-not-depend.md)
- builds_on [ADR-0005 — one canonical memory; feeders + promotion ladder](0005-one-canonical-memory-others-are-feeders.md)
- see_also [ADR-0010 — durable memory, not a coordination layer](0010-durable-memory-not-coordination-layer.md)
- detailed_by [agentmemory mining map](../notes/agentmemory-mining-map.md)
- informs [mage roadmap](../notes/roadmap.md)
