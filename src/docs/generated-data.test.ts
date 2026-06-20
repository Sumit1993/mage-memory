// Drift guard: the docs site's committed code-derived data (thresholds + hooks +
// the CLI command inventory) must equal what the live constants / buildProgram()
// produce right now. If a threshold, hook, or command changes and `pnpm docs:gen`
// wasn't re-run, this fails — so the docs cannot silently drift from the code.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildGeneratedDocsData, serializeGeneratedDocsData } from "./generated-data.js";

const GENERATED = fileURLToPath(new URL("../../docs/src/generated/mage-data.json", import.meta.url));

describe("docs generated data", () => {
  it("the committed mage-data.json matches the live constants (run `pnpm docs:gen` if this fails)", () => {
    expect(existsSync(GENERATED), `${GENERATED} is missing — run \`pnpm docs:gen\``).toBe(true);
    const committed = readFileSync(GENERATED, "utf8");
    const fresh = serializeGeneratedDocsData(buildGeneratedDocsData());
    expect(committed, "docs/src/generated/mage-data.json is stale — run `pnpm docs:gen`").toBe(fresh);
  });

  it("surfaces the two recurrence gates (K, M) and the boundary nudge", () => {
    const data = buildGeneratedDocsData();
    const symbols = data.thresholds.rows.filter((r) => r.symbol).map((r) => r.symbol);
    expect(symbols).toContain("K");
    expect(symbols).toContain("M");
    expect(data.hooks.some((h) => h.id === "mage:nudge:SessionStart")).toBe(true);
    // Every hook carries an authored purpose (no blank cells in the rendered table).
    expect(data.hooks.every((h) => h.purpose.length > 0)).toBe(true);
  });

  it("inventories the CLI commands derived from buildProgram()", () => {
    const data = buildGeneratedDocsData();
    const byName = new Map(data.commands.map((c) => [c.name, c]));

    // The headline human verbs are all present.
    for (const name of ["init", "connect", "stage", "groom", "doctor"]) {
      expect(byName.has(name), `commands should include ${name}`).toBe(true);
    }

    // Hook-only plumbing is hidden from `mage --help`.
    for (const name of ["observe", "nudge", "promote", "stage", "groom", "redact", "index"]) {
      expect(byName.get(name)?.hidden, `${name} should be hidden`).toBe(true);
    }

    // The human-facing verbs are visible.
    for (const name of ["init", "connect", "doctor"]) {
      expect(byName.get(name)?.hidden, `${name} should be visible`).toBe(false);
    }

    // Every command carries a one-line summary, and every option a flags string.
    expect(data.commands.every((c) => c.summary.length > 0)).toBe(true);
    expect(data.commands.every((c) => c.options.every((o) => o.flags.length > 0))).toBe(true);

    // Structural inventory only — no example prose was authored onto a command.
    expect(data.commands.every((c) => !("examples" in c))).toBe(true);
  });
});
