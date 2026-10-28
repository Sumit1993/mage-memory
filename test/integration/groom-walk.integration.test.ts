// DETERMINISTIC integration test (no external tools, no billing): `mage groom` walks the
// notes up the ladder over the BUILT CLI and a real KB (#282). A flat native-memory capture
// at the docs root is listed where it lies; nothing moves into staging.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assertBuilt, initKb, runMage } from "./lib/harness.js";

const CAPTURE =
  "---\nname: user-correction\ndescription: No em dashes.\nmetadata:\n  node_type: memory\n  type: feedback\n---\nNo em dashes in commit messages.\n";

describe("integration: groom walks the ladder (deterministic)", () => {
  beforeAll(() => assertBuilt());

  it("lists a flat root capture with rung null and leaves it in place", async () => {
    const { dir, root } = await initKb();
    await writeFile(join(root, "feedback_dashes.md"), CAPTURE);

    const r = await runMage(["groom", "--json"], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);

    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as {
      notes: Array<{ relPath: string; rung: string | null; problems: string[] }>;
      shown: number;
      total: number;
      staged: number;
    };
    expect(parsed.total).toBe(1);
    expect(parsed.staged).toBe(0);
    expect(parsed.notes[0]).toMatchObject({ relPath: "feedback_dashes.md", rung: null });
    expect(parsed.notes[0]?.problems).toContain("rung is required");

    expect(await readFile(join(root, "feedback_dashes.md"), "utf8")).toBe(CAPTURE);
    expect(existsSync(join(root, ".mage", "staging"))).toBe(false);
  });

  it("prints the human walk and the ladder text", async () => {
    const { dir, root } = await initKb();
    await writeFile(join(root, "feedback_dashes.md"), CAPTURE);

    const r = await runMage(["groom"], { cwd: dir });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("mage groom: 1 of 1 notes to judge (notes without a rung come first).");
    expect(r.stdout).toContain('1. feedback_dashes.md  "feedback_dashes"');
    expect(r.stdout).toContain("mage:ladder\nTake each fact");
    expect(r.stdout).not.toContain("asked once this session");
  });
});
