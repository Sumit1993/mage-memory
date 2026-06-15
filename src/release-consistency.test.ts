// Release-artifact consistency guard. A version bump touches MORE than
// package.json — the Claude Code plugin manifest, the marketplace listing, the
// README status badge, and the CHANGELOG all carry the version. As of 0.0.11
// release-please owns these bumps (it rewrites them all from one source on every
// release PR), but this test stays as a CI backstop: it fails on a PARTIAL bump,
// a stale badge, or a missing CHANGELOG entry, whether the bump came from
// release-please or a hand edit. See mage/notes/release-bump-touches-many-artifacts.md.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Repo root — this test lives at <root>/src/release-consistency.test.ts.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const readJson = (p: string): Record<string, unknown> => JSON.parse(read(p)) as Record<string, unknown>;

// The single source of truth: the npm package version (the one that actually publishes).
const VERSION = readJson("package.json").version as string;

describe("release artifact consistency — guards the version-bump surface", () => {
  it("package.json carries a clean semver version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the Claude Code plugin manifest matches package.json", () => {
    expect(readJson(".claude-plugin/plugin.json").version).toBe(VERSION);
  });

  it("the marketplace listing matches package.json", () => {
    const market = readJson(".claude-plugin/marketplace.json") as {
      plugins?: Array<{ name?: string; version?: string }>;
    };
    const mage = (market.plugins ?? []).find((p) => p.name === "mage");
    expect(mage?.version).toBe(VERSION);
  });

  it("the README status badge matches package.json", () => {
    const m = read("README.md").match(/badge\/status-([\d.]+)-/);
    expect(m?.[1]).toBe(VERSION);
  });

  it("CHANGELOG.md has a dated heading for the current version", () => {
    // Accept both the legacy Keep-a-Changelog form (`## [x] - 2026-06-14`) and
    // the release-please node form (`## [x](compare-url) (2026-06-14)`).
    const escaped = VERSION.replace(/\./g, "\\.");
    expect(read("CHANGELOG.md")).toMatch(new RegExp(`##\\s*\\[${escaped}\\][^\\n]*\\d{4}-\\d{2}-\\d{2}`));
  });
});
