import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mageVersion } from "./version.js";

// Guards against the `.version("0.0.2")` drift class: the resolver must agree with
// package.json rather than carry a hardcoded literal that goes stale on each bump.
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };

describe("mageVersion", () => {
  it("resolves to the package.json version (no hardcoded drift)", () => {
    expect(mageVersion()).toBe(pkg.version);
  });

  it("returns a non-empty semver-shaped string", () => {
    expect(mageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
