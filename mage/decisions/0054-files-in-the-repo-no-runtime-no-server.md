---
type: decision
tags: [mage/decisions]
status: accepted
created: "2026-09-10"
last_reviewed: "2026-09-10"
keywords: [layout, mage-dir, dot-mage, transient-state, no-runtime, no-server, offline, no-telemetry, harness, obsidian]
---

# 0054 — Files in the repo, no runtime, no server, nothing leaves the machine
## Decision
The knowledge base is a visible `mage/` directory of markdown: `notes/`, `decisions/`, later `guards/`.
Obsidian opens it; the graph is not a goal. All machine-written transient state lives under one gitignored
`.mage/` (learnings, metrics, proposals, the ledger); new runtime state never gets a new top-level entry.
mage has no server, daemon or model: automation rides the host harness's hooks, which are deterministic, and
the agent's own judgement. Views such as `INDEX.md` and `Dashboard.md` are generated files, never served.
Nothing is sent off the machine: the network egress is `doctor`'s opt-in connectivity probe and, only when the
operator or a hook invokes it, reads and writes to the user's own forge with the user's own credentials (the
findings puller, a proposal pull request). One harness, Claude Code, with its note shape isolated in
`src/adapters/claude-code/`; no adapter interface until a second harness forces one.
## Why
Files are the truth and git is the durability; a server is a second thing to run, back up and trust. Usage data
that stays local is a positioning win. An adapter for a harness that does not exist has one caller.
## Forbids
Durable content under a hidden directory. A second home for transient state. A watcher or daemon. A hosted
service in the core. Usage or content sent anywhere by default. A background network call. A `HarnessAdapter`
interface before the second harness.
## Example
`ls mage/` shows `INDEX.md MEMORY.md decisions/ notes/`; `ls .mage/` shows `learnings/ metrics/`, both
gitignored. `grep -n fetch src/commands/doctor.ts` finds the one probe, at line 189, behind an opt-in flag.
## Relations
Absorbs 0003, 0008, 0009, 0020, 0021, 0025, 0036. Enforced by `src/paths.ts:17` (`META_DIR`), `:39`
(`STATE_DIR`), `src/scan.ts:38` (never scans `.mage/`), `src/commands/doctor.ts:189` (the only network call),
`package.json` (no server dependency). Opt-in telemetry is a later decision: #228.
