---
type: note
tags: [mage/build]
created: "2026-06-27"
sources:
  - cc-session:1cf44183-6e81-4dcf-aa74-f14a813cc4a6
provenance:
  repo: mage-memory
  commit: 295298e
---
# Mage integration test framework

mage has an opt-in integration/real-test suite (test/integration/) for the built CLI + external tools (claude -p); live tests are cost-gated


mage-memory now has a tiered test layout (built 2026-06-27, ADR-0032 Phase 11):

- **Default** — `npm test` (`vitest run`, via `vitest.config.ts`) = fast unit/fixture
  tests under `src/` + `test/`. `test/integration/**` is EXCLUDED, so the default run
  and CI stay fast + free (1100 tests as of this date).
- **Integration** — `npm run test:integration` (`vitest.integration.config.ts`, builds
  first, serial, long timeouts) drives the real `dist/cli.js` against a temp git KB.
  - DETERMINISTIC (`*.integration.test.ts`) — no external tools, no billing; always runs.
    `inbox-ingest.integration.test.ts` is the durable port of the capture-loop soak.
  - LIVE (`*.live.test.ts`) — drives `claude -p`; **BILLED**. Each SKIPS itself unless
    `MAGE_LIVE=1` AND `claude` is present (`MAGE_CLAUDE_BIN` overrides the binary).
    `gate0.live.test.ts` proves Gate-0 scrubs a real native-memory write + MEMORY.md recall.

**PROVEN live 2026-06-27 on claude 2.1.195**: all 3 live tests pass — Gate-0 scrubs a
real `claude -p` native-memory write (raw email never on disk), MEMORY.md recall, and
Gate-0 DENY (agent told to edit MEMORY.md can't inject into the mage-owned index).

**GOTCHA (cost me a 180s timeout):** `claude -p "<prompt>"` BLOCKS waiting on stdin if
the child's stdin pipe stays open — a memory-writing session hung past 180s and got
SIGTERM'd. Fix: spawn with `stdio: ["ignore", "pipe", "pipe"]` (stdin = EOF), or
`< /dev/null` on the CLI. With stdin closed the session completes in ~50-120s.
Also: gate a live agent test on the on-disk artifact, NOT claude's exit code (a
headless session can exit non-zero benignly).

**Why:** the user wants a real/integration framework covering external tools, run
optionally because of cost. **How to apply:** write live tests gated with
`requireLive(ctx)` from `test/integration/lib/harness.ts` (`runMage`, `initKb`,
`wireCommandeer`, `runClaude`). The README has a MANIFEST of ad-hoc `~/ai-context/`
harnesses still to fold in (memory-deny spike, mage-soak digest, faultline-prove,
dogfood smoke). See [mage-032-gate0-built](mage-032-gate0-built.md).
