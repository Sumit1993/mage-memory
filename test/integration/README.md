# Integration / real-test suite

Tests that exercise the **built CLI** end-to-end against a real filesystem and git,
and — opt-in — drive **external tools** (`claude -p`). These are deliberately kept out
of the default `npm test` (unit + fixture tests), because they are slow and partly
**billed**.

## Tiers

| Tier | What it touches | Cost | When it runs |
|---|---|---|---|
| **deterministic** (`*.integration.test.ts`) | the built `dist/cli.js`, a real temp KB (git + `mage init`) | free | every `npm run test:integration` |
| **live** (`*.live.test.ts`) | an external tool — `claude -p` headless | **billed** | only with `MAGE_LIVE=1` **and** the `claude` CLI present; otherwise each live test skips itself |

## Run

```bash
# deterministic only (no billing) — live tests skip themselves:
npm run test:integration

# + the billed live tests (drives real `claude -p`):
MAGE_LIVE=1 npm run test:integration
```

The `test:integration` script builds the CLI first, so the suite always exercises
current code. `npm test` (the default) never runs anything here.

### Env knobs

- `MAGE_LIVE=1` — opt into the billed live tests.
- `MAGE_CLAUDE_BIN=/path/to/claude` — the Claude Code CLI to drive (default `claude`).

## Layout

- `lib/harness.ts` — shared helpers: `runMage` (run the built CLI), `initKb` (a real
  temp KB), `wireCommandeer` (Gate-0 settings pointing at the built CLI), and the live
  gate (`requireLive`, `runClaude`).
- `inbox-ingest.integration.test.ts` — **deterministic.** The full ADR-0032 capture
  loop: recall → groom ingest → covered-archive → backstop scrub → accept → `notes/`
  (provenance + `cc-session`) → idempotent re-run. The durable form of the throwaway
  `scratchpad/soak-ingest.sh`.
- `gate0.live.test.ts` — **live.** Drives `claude -p` to prove Gate-0 scrubs a real
  native-memory write before disk, and that `MEMORY.md` is auto-loaded for recall.

## Adding a live test

Gate the body with `requireLive(ctx)` at the top so it skips (never fails) when not
opted in:

```ts
it("does a real thing", async (ctx) => {
  if (!(await requireLive(ctx))) return;
  // … drive claude, assert on the filesystem …
});
```

## Manifest — ad-hoc harnesses to fold in next

Custom harnesses currently living under `~/ai-context/` (and referenced in notes),
to migrate into this suite as durable, gated tests. Listed so they aren't lost.

| Harness (`~/ai-context/…`) | Proves | Target here |
|---|---|---|
| `mage-gate0-spike/` | live native-write → Gate-0 scrub → MEMORY.md recall | **ported** → `gate0.live.test.ts` |
| `mage-spike-memory-deny/deny-memory.sh` | Gate-0 **denies** a write to a generated index (`MEMORY.md`) | live test: assert the agent is blocked from editing `MEMORY.md` |
| `mage-soak/` (`soak-digest.sh`, `soak-report.mjs`, `soak-baseline.json`) | multi-KB distill/digest soak vs a baseline | deterministic soak over recorded `.learnings` fixtures |
| `mage-prove-20260619/` (`faultline-*.mjs`, `ops-corpus-replay.mjs`) | faultline detector replayed over real session logs | deterministic replay test over a checked-in log corpus |
| `mage-dogfood-0.0.10.sh` | release smoke (planted-secret + malformed-input) on the packed tarball | a `pack → install → smoke` deterministic test |

> The scratchpad soak (`…/scratchpad/soak-ingest.sh`) is **superseded** by
> `inbox-ingest.integration.test.ts` and can be deleted.
