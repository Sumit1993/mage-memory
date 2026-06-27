import { defineConfig } from "vitest/config";

// Default test suite: fast, hermetic unit + fixture tests under src/ and test/.
// Integration tests (real built CLI, real git, and some that drive EXTERNAL TOOLS
// like `claude -p`, which is billed) live under test/integration/ and are excluded
// here — run them on demand with `npm run test:integration` (see test/integration/README.md).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "docs/**", "test/integration/**"],
  },
});
