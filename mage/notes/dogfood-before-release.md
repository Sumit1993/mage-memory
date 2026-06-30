---
type: feedback
tags: [mage/release]
created: "2026-06-27"
sources:
  - cc-session:0c762176-4434-4798-8bb2-abd402eed957
provenance:
  repo: mage-memory
  commit: 295298e
---
# Dogfood before release

Every mage release must be used locally (real runtime, not just unit tests) before it ships


For mage (mage-memory), **dogfood every release locally before `npm publish`** — actually
run the new capability against real inputs, don't rely on `pnpm test` alone.

**Why:** unit tests verify logic in isolation, but mage's runtime surface only reveals
bugs when actually run — hook-invoked commands reading real stdin, real `.learnings/`
writes, KB/root resolution from a real `cwd`, redaction on real payloads, file rotation.
`mage observe` (0.0.5) is the sharpest example: it's invoked by host hooks with real
Claude Code hook JSON, so stdin parsing, path extraction, fail-open/fail-closed behavior,
and `Skill`-tool detection are untestable in pure vitest.

**How to apply:** per-release definition of done = (1) `pnpm test`/`typecheck`/`build`
green, (2) smoke the new command against real inputs incl. a planted secret (confirm
redaction) and malformed input (confirm it never crashes the host), (3) run it for real
in this repo — mage dogfoods on its own `mage/` KB; from 0.0.6 (`connect`) this is
automatic, before that wire one temporary hook by hand (which also pre-validates
connect's payload→event mapping), (4) only then tag + publish. Captured in
plan-release-sequence.md "Release discipline". Related: [no-emojis-in-releases](no-emojis-in-releases.md).
