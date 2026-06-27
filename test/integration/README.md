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
  (Proven 2026-06-27 on claude 2.1.195.)
- `memory-deny.live.test.ts` — **live.** Proves Gate-0's deny arm holds — a real agent
  told to edit `MEMORY.md` cannot inject into the mage-owned index.
- `release-smoke.integration.test.ts` — **deterministic.** The hermetic pre-publish
  smoke checks: `--version`, the human/plumbing `--help` split, the shipped skills set,
  `distill --json` validity, hook fail-open on malformed stdin, `doctor` cleanliness,
  and the Gate-2 staged-secret block.

## Adding a live test

Gate the body with `requireLive(ctx)` at the top so it skips (never fails) when not
opted in:

```ts
it("does a real thing", async (ctx) => {
  if (!(await requireLive(ctx))) return;
  // … drive claude, assert on the filesystem …
});
```

## Manifest — ad-hoc harnesses (`~/ai-context/…`)

Where each ad-hoc harness landed. Not every harness is a *test* — two are a monitor
and a research artifact, and forcing them into hermetic tests would misrepresent them.

| Harness | What it is | Status |
|---|---|---|
| `mage-gate0-spike/` | live native-write → Gate-0 scrub → MEMORY.md recall | **ported** → `gate0.live.test.ts` (proven on claude 2.1.195) |
| `mage-spike-memory-deny/` | Gate-0 **denies** a write to a generated index | **ported** → `memory-deny.live.test.ts` (proven on claude 2.1.195) |
| `mage-dogfood-0.0.10.sh` | pre-publish release smoke | **ported (hermetic parts)** → `release-smoke.integration.test.ts`. The live-KB read-only probes (doctor over your real repos) stay in the script — they depend on machine state. |
| `mage-soak/` | a **cron monitor**: a read-only digest of organic lesson capture across your *live* KBs over time, vs a stamped baseline | **not a hermetic test** — left as a monitor. Its read-only-CLI invariants are already covered by unit tests. |
| `mage-prove-20260619/` (`faultline-*.mjs`) | a **research harness**: replays log corpora to *measure* whether a proposed trigger fires (rates + samples for human scoring) — no pass/fail | **not a regression test** — left as a research artifact. |

> The scratchpad soak (`…/scratchpad/soak-ingest.sh`) is **superseded** by
> `inbox-ingest.integration.test.ts` and can be deleted.
