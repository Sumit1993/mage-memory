import { mkdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { BacklogTally } from "../../grooming/backlog.js";
import { learningsPath } from "../../paths.js";
import { tmpDir } from "../../../test/fixtures/kb.js";
import {
  cacheTally,
  cachedTally,
  elapsedSince,
  elapsedSinceDream,
  markDreamShown,
  markReminded,
  scratchFingerprint,
} from "./nudge-state.js";

const tmpRoot = (): Promise<string> => tmpDir("mage-nudge-state-");

const TALLY: BacklogTally = { staged: 3, unmined: 1, unminedCapped: false, graduable: 0 };

describe("scratchFingerprint", () => {
  it('is "" when no scratch exists yet (never gate → always recompute)', async () => {
    expect(await scratchFingerprint(await tmpRoot())).toBe("");
  });

  it("is non-empty once `.learnings/` exists", async () => {
    const root = await tmpRoot();
    await mkdir(learningsPath(root), { recursive: true });
    expect(await scratchFingerprint(root)).not.toBe("");
  });
});

describe("tally cache — cacheTally / cachedTally", () => {
  it("round-trips a tally pinned to its fingerprint", async () => {
    const root = await tmpRoot();
    await cacheTally(root, "fp-1", TALLY);
    expect(await cachedTally(root, "fp-1")).toEqual(TALLY);
  });

  it("misses when the fingerprint differs (scratch changed)", async () => {
    const root = await tmpRoot();
    await cacheTally(root, "fp-1", TALLY);
    expect(await cachedTally(root, "fp-2")).toBeNull();
  });

  it('never gates on an empty fingerprint', async () => {
    const root = await tmpRoot();
    await cacheTally(root, "fp-1", TALLY);
    expect(await cachedTally(root, "")).toBeNull();
  });

  it("misses on a fresh root (no state file)", async () => {
    expect(await cachedTally(await tmpRoot(), "fp-1")).toBeNull();
  });
});

describe("throttle clock — elapsedSince / markReminded", () => {
  it("a never-reminded root has always elapsed (fail-open)", async () => {
    expect(await elapsedSince(await tmpRoot(), 60_000)).toBe(true);
  });

  it("a just-reminded root has not elapsed within the window", async () => {
    const root = await tmpRoot();
    await markReminded(root);
    expect(await elapsedSince(root, 60_000)).toBe(false);
  });

  it("a zero window is always elapsed", async () => {
    const root = await tmpRoot();
    await markReminded(root);
    expect(await elapsedSince(root, 0)).toBe(true);
  });
});

describe("dream-health clock — elapsedSinceDream / markDreamShown", () => {
  it("a never-scanned root has always elapsed (fail-open)", async () => {
    expect(await elapsedSinceDream(await tmpRoot(), 60_000)).toBe(true);
  });

  it("a just-scanned root has not elapsed within the window", async () => {
    const root = await tmpRoot();
    await markDreamShown(root);
    expect(await elapsedSinceDream(root, 60_000)).toBe(false);
  });
});

describe("the three concerns don't clobber each other", () => {
  it("markReminded preserves the cached tally", async () => {
    const root = await tmpRoot();
    await cacheTally(root, "fp-1", TALLY);
    await markReminded(root);
    expect(await cachedTally(root, "fp-1")).toEqual(TALLY);
  });

  it("cacheTally preserves the reminder clock", async () => {
    const root = await tmpRoot();
    await markReminded(root);
    await cacheTally(root, "fp-1", TALLY);
    expect(await elapsedSince(root, 60_000)).toBe(false);
  });

  it("the backlog clock and the dream clock are independent", async () => {
    const root = await tmpRoot();
    await markReminded(root); // stamp backlog only
    expect(await elapsedSince(root, 60_000)).toBe(false); // backlog throttled
    expect(await elapsedSinceDream(root, 60_000)).toBe(true); // dream untouched
    await markDreamShown(root); // stamp dream only
    expect(await elapsedSince(root, 60_000)).toBe(false); // backlog still preserved
    expect(await elapsedSinceDream(root, 60_000)).toBe(false); // dream now throttled
  });

  it("markDreamShown preserves the cached tally", async () => {
    const root = await tmpRoot();
    await cacheTally(root, "fp-1", TALLY);
    await markDreamShown(root);
    expect(await cachedTally(root, "fp-1")).toEqual(TALLY);
  });
});
