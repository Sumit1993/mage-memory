import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadataPath } from "../paths.js";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { autonomy } from "./autonomy.js";

afterEach(() => {
  vi.restoreAllMocks();
});

async function readGrooming(dir: string): Promise<Record<string, unknown> | undefined> {
  const parsed = JSON.parse(await readFile(metadataPath(dir), "utf8")) as Record<string, unknown>;
  return parsed.grooming as Record<string, unknown> | undefined;
}

describe("mage autonomy — get", () => {
  it("prints the default (operator) when unset", async () => {
    const { dir } = await withKb();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => logs.push(String(m)));
    await autonomy({ dir });
    const out = logs.join("\n");
    expect(out).toContain("autonomy: operator");
    expect(out).toContain("default (unset");
  });

  it("prints the explicitly-set level", async () => {
    const { dir } = await withKb({ grooming: { autonomy: "overseer" } });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => logs.push(String(m)));
    await autonomy({ dir });
    const out = logs.join("\n");
    expect(out).toContain("autonomy: overseer");
    expect(out).toContain("set in");
  });

  it("throws when no knowledge base is found", async () => {
    const empty = await tmpDir("mage-autonomy-nokb-");
    await expect(autonomy({ dir: empty })).rejects.toThrow(/No mage knowledge base/);
  });
});

describe("mage autonomy — set", () => {
  it("sets the level and preserves other grooming fields", async () => {
    const { dir } = await withKb({ grooming: { sensitivity: "high", nudgeThrottleHours: 8 } });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await autonomy({ dir, level: "approver" });
    const grooming = await readGrooming(dir);
    expect(grooming).toEqual({ sensitivity: "high", nudgeThrottleHours: 8, autonomy: "approver" });
  });

  it("creates a grooming block when none exists", async () => {
    const { dir } = await withKb();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await autonomy({ dir, level: "overseer" });
    expect(await readGrooming(dir)).toEqual({ autonomy: "overseer" });
  });

  it("rejects a junk level (validates against the three) without writing", async () => {
    const { dir } = await withKb({ grooming: { autonomy: "operator" } });
    await expect(autonomy({ dir, level: "autopilot" })).rejects.toThrow(/Unknown autonomy level/);
    expect(await readGrooming(dir)).toEqual({ autonomy: "operator" }); // unchanged
  });
});
