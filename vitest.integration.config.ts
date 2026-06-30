import { defineConfig } from "vitest/config";

// Integration / real-test suite. These exercise the BUILT CLI (dist/cli.js) against a
// real filesystem + git, and — when MAGE_LIVE is set — drive external tools like
// `claude -p` end-to-end. They are slow and partly billed, so they are NEVER part of
// the default `npm test`; run them explicitly:
//
//   npm run test:integration              # deterministic only (no billing) — live tests skip
//   MAGE_LIVE=1 npm run test:integration  # + the billed `claude -p` live tests
//
// See test/integration/README.md for the tiers, the env knobs, and the manifest of
// ad-hoc harnesses still to be folded in.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Real processes + external tools are slow; give them room and run serially so
    // their output stays legible and they never contend for the same temp/git state.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
