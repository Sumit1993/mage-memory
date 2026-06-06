// Single source of mage's own package version, resolved at runtime. Used by the
// CLI `--version` flag AND stamped into `observe` session_start events, so both must
// report the same number — hardcoding either drifts (the `.version("0.0.2")` bug).

import { createRequire } from "node:module";

/**
 * mage's own package version, or "0.0.0" if unreadable. Resolution is bundler-safe:
 * the `npm_package_version` env first (set under npm/pnpm scripts), then the nearest
 * `package.json` named `mage-memory` — whether running from `src/` (`../`) or the
 * flattened `dist/` bundle (`../`). The name check avoids picking up a dependency's
 * `package.json`.
 */
export function mageVersion(): string {
  const fromEnv = process.env.npm_package_version;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  const require = createRequire(import.meta.url);
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = require(rel) as { name?: string; version?: string };
      if (pkg.name === "mage-memory" && typeof pkg.version === "string") return pkg.version;
    } catch {
      /* try the next candidate path */
    }
  }
  return "0.0.0";
}
