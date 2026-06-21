import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { META_DIR, METADATA_SCHEMA, metadataPath, readMetadata } from "../paths.js";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import {
  groomingFieldIsSet,
  readAutonomy,
  readGrooming,
  readSensitivity,
  writeGroomingField,
} from "./config.js";

// ─── edge-case ref + malformed-metadata builder ───────────────────────────────
// For the metadata-absent fail-open, hand-written bogus-schema, and junk-grooming
// (out-of-enum / wrong-type values that can't typecheck as GroomingConfig) cases,
// which can't go through the resolving fixture — a bare repo ref + a raw writer.
const repoRef = (repo: string) => ({ root: join(repo, META_DIR), kind: "repo" as const, repo });

/** Write `<repo>/mage/metadata.json` with an arbitrary (possibly malformed) grooming block. */
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

// ─── readSensitivity — in-repo ────────────────────────────────────────────────

describe("readSensitivity — in-repo dial read", () => {
  it("reads a valid dial from the in-repo metadata", async () => {
    const { resolved } = await withKb({ kind: "repo", grooming: { sensitivity: "high" } });
    expect(await readSensitivity(resolved)).toBe("high");
  });

  it("defaults to normal when no grooming block is present", async () => {
    const { resolved } = await withKb({ kind: "repo" });
    expect(await readSensitivity(resolved)).toBe("normal");
  });

  it("defaults to normal when the metadata file is absent (fail-open)", async () => {
    const repo = await tmpDir("mage-config-");
    expect(await readSensitivity(repoRef(repo))).toBe("normal");
  });

  it("defaults to normal on an out-of-enum value", async () => {
    const repo = await tmpDir("mage-config-");
    await writeRepoMeta(repo, { sensitivity: "aggressive" });
    expect(await readSensitivity(repoRef(repo))).toBe("normal");
  });

  it("defaults to normal when grooming is the wrong shape", async () => {
    const repo = await tmpDir("mage-config-");
    await writeRepoMeta(repo, "high"); // grooming is a string, not an object.
    expect(await readSensitivity(repoRef(repo))).toBe("normal");
  });

  it("fails open to normal on unknown-schema metadata (read throws)", async () => {
    const repo = await tmpDir("mage-config-");
    await mkdir(join(repo, META_DIR), { recursive: true });
    await writeFile(
      metadataPath(repo),
      JSON.stringify({ schema: "bogus.v0", grooming: { sensitivity: "low" } }),
      "utf8",
    );
    expect(await readSensitivity(repoRef(repo))).toBe("normal");
  });
});

// ─── readSensitivity — hub ────────────────────────────────────────────────────

describe("readSensitivity — hub dial read", () => {
  it("reads a valid dial from the hub metadata (from repo)", async () => {
    const { resolved } = await withKb({ kind: "hub", grooming: { sensitivity: "low" } });
    expect(await readSensitivity(resolved)).toBe("low");
  });

  it("defaults to normal when the hub has no grooming block", async () => {
    const { resolved } = await withKb({ kind: "hub" });
    expect(await readSensitivity(resolved)).toBe("normal");
  });

  it("defaults to normal when the hub metadata is absent (fail-open)", async () => {
    const root = await tmpDir("mage-config-");
    expect(await readSensitivity({ root, kind: "hub", repo: root })).toBe("normal");
  });
});

// ─── readAutonomy — fail-open, junk-narrowed, hub-aware (ADR-0030) ─────────────

describe("readAutonomy — the opt-in autonomy ladder read", () => {
  it("reads each valid level from in-repo metadata", async () => {
    for (const level of ["operator", "approver", "overseer"] as const) {
      const { resolved } = await withKb({ kind: "repo", grooming: { autonomy: level } });
      expect(await readAutonomy(resolved)).toBe(level);
    }
  });

  it("defaults to operator when no grooming block is present", async () => {
    const { resolved } = await withKb({ kind: "repo" });
    expect(await readAutonomy(resolved)).toBe("operator");
  });

  it("defaults to operator when the metadata file is absent (fail-open)", async () => {
    const repo = await tmpDir("mage-config-");
    expect(await readAutonomy(repoRef(repo))).toBe("operator");
  });

  it("defaults to operator on an out-of-enum value", async () => {
    const repo = await tmpDir("mage-config-");
    await writeRepoMeta(repo, { autonomy: "autopilot" });
    expect(await readAutonomy(repoRef(repo))).toBe("operator");
  });

  it("fails open to operator on unknown-schema metadata (read throws)", async () => {
    const repo = await tmpDir("mage-config-");
    await mkdir(join(repo, META_DIR), { recursive: true });
    await writeFile(
      metadataPath(repo),
      JSON.stringify({ schema: "bogus.v0", grooming: { autonomy: "overseer" } }),
      "utf8",
    );
    expect(await readAutonomy(repoRef(repo))).toBe("operator");
  });

  it("reads the level from hub metadata and respects it per-KB", async () => {
    const { resolved } = await withKb({ kind: "hub", grooming: { autonomy: "approver" } });
    expect(await readAutonomy(resolved)).toBe("approver");
  });

  // ADR-0030 regression: for a hub-owned / external-mode KB the READ path must match
  // `mage autonomy`'s WRITE path. There root !== repo (root = <hub>/projects/<name>/,
  // repo = <hub>), and the level is written into the HUB's own metadata at repo — so reading
  // root (a file the writer never touches) would silently no-op the set. Prove the round-trip.
  it("round-trips a hub-set level when root !== repo (external mode)", async () => {
    const { resolved } = await withKb({
      kind: "project",
      grooming: { autonomy: "overseer", sensitivity: "high" },
    });
    expect(resolved.root).not.toBe(resolved.repo); // genuinely external (the bug's precondition)
    expect(await readAutonomy(resolved)).toBe("overseer");
    expect(await readSensitivity(resolved)).toBe("high");
  });
});

// ─── readGrooming — one read, every field narrowed ────────────────────────────

describe("readGrooming — the deep one-read view", () => {
  it("narrows all three fields together from a single read", async () => {
    const { resolved } = await withKb({
      kind: "repo",
      grooming: { sensitivity: "high", autonomy: "overseer", nudgeThrottleHours: 8 },
    });
    expect(await readGrooming(resolved)).toEqual({
      sensitivity: "high",
      autonomy: "overseer",
      nudgeThrottleHours: 8,
    });
  });

  it("defaults every field when no grooming block is present", async () => {
    const { resolved } = await withKb({ kind: "repo" });
    expect(await readGrooming(resolved)).toEqual({
      sensitivity: "normal",
      autonomy: "operator",
      nudgeThrottleHours: undefined,
    });
  });

  it("drops a non-number throttle window to undefined", async () => {
    const repo = await tmpDir("mage-config-");
    await writeRepoMeta(repo, { nudgeThrottleHours: "soon" });
    expect((await readGrooming(repoRef(repo))).nudgeThrottleHours).toBeUndefined();
  });
});

// ─── writeGroomingField / groomingFieldIsSet — the write side of the seam ──────

describe("writeGroomingField — read-merge-write preserving siblings", () => {
  it("sets a field and preserves the other grooming fields", async () => {
    const { resolved, repo } = await withKb({
      kind: "repo",
      grooming: { sensitivity: "high", nudgeThrottleHours: 8 },
    });
    const path = await writeGroomingField(resolved, { autonomy: "approver" });
    expect(path).toBe(metadataPath(repo));
    expect((await readMetadata(repo))?.grooming).toEqual({
      sensitivity: "high",
      nudgeThrottleHours: 8,
      autonomy: "approver",
    });
  });

  it("creates a grooming block when none exists", async () => {
    const { resolved, repo } = await withKb({ kind: "repo" });
    await writeGroomingField(resolved, { autonomy: "overseer" });
    expect((await readMetadata(repo))?.grooming).toEqual({ autonomy: "overseer" });
  });

  it("throws when the resolved KB has no metadata file", async () => {
    const repo = await tmpDir("mage-config-");
    await expect(writeGroomingField(repoRef(repo), { autonomy: "approver" })).rejects.toThrow(
      /No metadata at/,
    );
  });
});

describe("groomingFieldIsSet — explicit-vs-default", () => {
  it("is true only when the field is present on disk", async () => {
    const { resolved } = await withKb({ kind: "repo", grooming: { autonomy: "approver" } });
    expect(await groomingFieldIsSet(resolved, "autonomy")).toBe(true);
    expect(await groomingFieldIsSet(resolved, "sensitivity")).toBe(false);
  });

  it("is false (fail-open) when no metadata exists", async () => {
    const repo = await tmpDir("mage-config-");
    expect(await groomingFieldIsSet(repoRef(repo), "autonomy")).toBe(false);
  });
});
