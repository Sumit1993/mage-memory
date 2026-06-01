import { defineConfig } from "tsup";

// Two separate builds so only the CLI entry gets the shebang banner.
// (tsup's banner option applies per-build, not per-entry.)
export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    bundle: true,
    sourcemap: true,
    clean: true,
    shims: true,
    banner: { js: "#!/usr/bin/env node" },
    outExtension: () => ({ js: ".js" }),
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    bundle: true,
    sourcemap: true,
    dts: true,
    shims: true,
    outExtension: () => ({ js: ".js" }),
  },
]);
