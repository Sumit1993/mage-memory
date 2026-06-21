import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { META_DIR, METADATA_SCHEMA, metadataPath } from "../paths.js";
import { autonomy, coerceAutonomy } from "./autonomy.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** An in-repo KB at `<dir>/mage` with an optional grooming block. */
async function makeKb(grooming?: unknown): Promise<{ dir: string; mage: string }> {
  const dir = await mkdtemp(join(tmpdir(), "mage-autonomy-"));
  made.push(dir);
  const mage = join(dir, META_DIR);
  await mkdir(join(mage, "notes"), { recursive: true });
  const meta: Record<string, unknown> = {
    schema: METADATA_SCHEMA,
    mode: "in-repo",
    project: "t",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: "2026-06-21T00:00:00.000Z",
  };
  if (grooming !== undefined) meta.grooming = grooming;
  await writeFile(metadataPath(dir), `${JSON.stringify(meta, null, 2)}\n`);
  return { dir, mage };
}

async function readGrooming(dir: string): Promise<Record<string, unknown> | undefined> {
  const parsed = JSON.parse(await readFile(metadataPath(dir), "utf8")) as Record<string, unknown>;
  return parsed.grooming as Record<string, unknown> | undefined;
}

describe("coerceAutonomy", () => {
  it("accepts the three levels", () => {
    expect(coerceAutonomy("operator")).toBe("operator");
    expect(coerceAutonomy("approver")).toBe("approver");
    expect(coerceAutonomy("overseer")).toBe("overseer");
  });

  it("throws on junk, listing all three", () => {
    expect(() => coerceAutonomy("autopilot")).toThrow(/operator, approver, overseer/);
  });
});

describe("mage autonomy — get", () => {
  it("prints the default (operator) when unset", async () => {
    const { dir } = await makeKb();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => logs.push(String(m)));
    await autonomy({ dir });
    const out = logs.join("\n");
    expect(out).toContain("autonomy: operator");
    expect(out).toContain("default (unset");
  });

  it("prints the explicitly-set level", async () => {
    const { dir } = await makeKb({ autonomy: "overseer" });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => logs.push(String(m)));
    await autonomy({ dir });
    const out = logs.join("\n");
    expect(out).toContain("autonomy: overseer");
    expect(out).toContain("set in");
  });

  it("throws when no knowledge base is found", async () => {
    const empty = await mkdtemp(join(tmpdir(), "mage-autonomy-nokb-"));
    made.push(empty);
    await expect(autonomy({ dir: empty })).rejects.toThrow(/No mage knowledge base/);
  });
});

describe("mage autonomy — set", () => {
  it("sets the level and preserves other grooming fields", async () => {
    const { dir } = await makeKb({ sensitivity: "high", nudgeThrottleHours: 8 });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await autonomy({ dir, level: "approver" });
    const grooming = await readGrooming(dir);
    expect(grooming).toEqual({ sensitivity: "high", nudgeThrottleHours: 8, autonomy: "approver" });
  });

  it("creates a grooming block when none exists", async () => {
    const { dir } = await makeKb();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await autonomy({ dir, level: "overseer" });
    expect(await readGrooming(dir)).toEqual({ autonomy: "overseer" });
  });

  it("rejects a junk level (validates against the three) without writing", async () => {
    const { dir } = await makeKb({ autonomy: "operator" });
    await expect(autonomy({ dir, level: "autopilot" })).rejects.toThrow(/Unknown autonomy level/);
    expect(await readGrooming(dir)).toEqual({ autonomy: "operator" }); // unchanged
  });
});
