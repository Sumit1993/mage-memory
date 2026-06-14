import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEMOTE_MATCH_RATE,
  LOW_MATCH_RATE,
  MIN_LOADS_FOR_SUGGESTION,
} from "../metrics/context-match.js";
import {
  hubMetadataPath,
  META_DIR,
  METADATA_SCHEMA,
  metadataPath,
} from "../paths.js";
import {
  BASE_THRESHOLDS,
  DEFAULT_SENSITIVITY,
  readSensitivity,
  thresholdsFor,
  type Sensitivity,
} from "./thresholds.js";

// ─── tmp fixture plumbing ─────────────────────────────────────────────────────

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-promote-"));
  made.push(dir);
  return dir;
}

/** Write `<repo>/mage/metadata.json` with an optional grooming block. */
async function writeRepoMeta(repo: string, grooming?: unknown): Promise<void> {
  await mkdir(join(repo, META_DIR), { recursive: true });
  const meta: Record<string, unknown> = {
    schema: METADATA_SCHEMA,
    mode: "in-repo",
    project: "p",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: "2026-06-08T00:00:00.000Z",
  };
  if (grooming !== undefined) meta.grooming = grooming;
  await writeFile(metadataPath(repo), JSON.stringify(meta, null, 2), "utf8");
}

/** Write `<root>/metadata.json` (hub) with an optional grooming block. */
async function writeHubMeta(root: string, grooming?: unknown): Promise<void> {
  const meta: Record<string, unknown> = {
    schema: METADATA_SCHEMA,
    name: "hub",
    created_at: "2026-06-08T00:00:00.000Z",
    projects: [],
  };
  if (grooming !== undefined) meta.grooming = grooming;
  await writeFile(hubMetadataPath(root), JSON.stringify(meta, null, 2), "utf8");
}

// ─── BASE_THRESHOLDS — single-sources the rate-floors ─────────────────────────

describe("BASE_THRESHOLDS — finalizes the provisional 0.0.6 numbers", () => {
  it("uses the @normal recurrence gates and the new 0.0.8 constants", () => {
    expect(BASE_THRESHOLDS.promoteSessions).toBe(3);
    expect(BASE_THRESHOLDS.graduateSessions).toBe(8);
    expect(BASE_THRESHOLDS.noteSizeCap).toBe(6000);
    expect(BASE_THRESHOLDS.editBudget).toBe(3);
    expect(BASE_THRESHOLDS.promotionBudget).toBe(5);
  });

  it("reuses context-match.ts's rate-floors (never forks the numbers)", () => {
    expect(BASE_THRESHOLDS.rewordRate).toBe(LOW_MATCH_RATE);
    expect(BASE_THRESHOLDS.demoteRate).toBe(DEMOTE_MATCH_RATE);
    expect(BASE_THRESHOLDS.minLoads).toBe(MIN_LOADS_FOR_SUGGESTION);
  });

  it("defaults the dial to normal", () => {
    expect(DEFAULT_SENSITIVITY).toBe("normal");
  });
});

// ─── thresholdsFor — scales ONLY the recurrence gates ─────────────────────────

describe("thresholdsFor — the dial scales only promote/graduate sessions", () => {
  it("normal returns the BASE values", () => {
    expect(thresholdsFor("normal")).toEqual(BASE_THRESHOLDS);
  });

  it("high lowers the gates (easier to surface)", () => {
    const t = thresholdsFor("high");
    expect(t.promoteSessions).toBe(2);
    expect(t.graduateSessions).toBe(6);
  });

  it("low raises the gates (harder to surface)", () => {
    const t = thresholdsFor("low");
    expect(t.promoteSessions).toBe(4);
    expect(t.graduateSessions).toBe(11);
  });

  it("never scales the rate-floors / minLoads / editBudget / sizeCap", () => {
    for (const s of ["low", "normal", "high"] as Sensitivity[]) {
      const t = thresholdsFor(s);
      expect(t.rewordRate).toBe(BASE_THRESHOLDS.rewordRate);
      expect(t.demoteRate).toBe(BASE_THRESHOLDS.demoteRate);
      expect(t.minLoads).toBe(BASE_THRESHOLDS.minLoads);
      expect(t.editBudget).toBe(BASE_THRESHOLDS.editBudget);
      expect(t.noteSizeCap).toBe(BASE_THRESHOLDS.noteSizeCap);
    }
  });

  it("returns a NEW object — never mutates BASE_THRESHOLDS", () => {
    const before = { ...BASE_THRESHOLDS };
    const t = thresholdsFor("high");
    t.promoteSessions = 999;
    expect(BASE_THRESHOLDS).toEqual(before);
  });
});

// ─── readSensitivity — in-repo ────────────────────────────────────────────────

describe("readSensitivity — in-repo dial read", () => {
  it("reads a valid dial from the in-repo metadata", async () => {
    const repo = await tmp();
    await writeRepoMeta(repo, { sensitivity: "high" });
    const got = await readSensitivity({ root: join(repo, META_DIR), kind: "in-repo", repo });
    expect(got).toBe("high");
  });

  it("defaults to normal when no grooming block is present", async () => {
    const repo = await tmp();
    await writeRepoMeta(repo);
    const got = await readSensitivity({ root: join(repo, META_DIR), kind: "in-repo", repo });
    expect(got).toBe("normal");
  });

  it("defaults to normal when the metadata file is absent (fail-open)", async () => {
    const repo = await tmp();
    const got = await readSensitivity({ root: join(repo, META_DIR), kind: "in-repo", repo });
    expect(got).toBe("normal");
  });

  it("defaults to normal on an out-of-enum value", async () => {
    const repo = await tmp();
    await writeRepoMeta(repo, { sensitivity: "aggressive" });
    const got = await readSensitivity({ root: join(repo, META_DIR), kind: "in-repo", repo });
    expect(got).toBe("normal");
  });

  it("defaults to normal when grooming is the wrong shape", async () => {
    const repo = await tmp();
    await writeRepoMeta(repo, "high"); // grooming is a string, not an object.
    const got = await readSensitivity({ root: join(repo, META_DIR), kind: "in-repo", repo });
    expect(got).toBe("normal");
  });

  it("fails open to normal on unknown-schema metadata (read throws)", async () => {
    const repo = await tmp();
    await mkdir(join(repo, META_DIR), { recursive: true });
    await writeFile(
      metadataPath(repo),
      JSON.stringify({ schema: "bogus.v0", grooming: { sensitivity: "low" } }),
      "utf8",
    );
    const got = await readSensitivity({ root: join(repo, META_DIR), kind: "in-repo", repo });
    expect(got).toBe("normal");
  });
});

// ─── readSensitivity — hub ────────────────────────────────────────────────────

describe("readSensitivity — hub dial read", () => {
  it("reads a valid dial from the hub metadata (root, not repo)", async () => {
    const root = await tmp();
    await writeHubMeta(root, { sensitivity: "low" });
    const got = await readSensitivity({ root, kind: "hub", repo: root });
    expect(got).toBe("low");
  });

  it("defaults to normal when the hub has no grooming block", async () => {
    const root = await tmp();
    await writeHubMeta(root);
    const got = await readSensitivity({ root, kind: "hub", repo: root });
    expect(got).toBe("normal");
  });

  it("defaults to normal when the hub metadata is absent (fail-open)", async () => {
    const root = await tmp();
    const got = await readSensitivity({ root, kind: "hub", repo: root });
    expect(got).toBe("normal");
  });
});
