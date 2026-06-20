import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceWatermark,
  distillWatermarkPath,
  DISTILL_VERSION,
  readWatermark,
  writeWatermark,
  type DistillWatermark,
} from "./watermark.js";

// ─── tmp fixture plumbing ─────────────────────────────────────────────────────

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-distill-wm-"));
  made.push(dir);
  return dir;
}

// ─── readWatermark — fail-open on missing/corrupt ─────────────────────────────

describe("readWatermark — fresh empty on missing/corrupt (fail-open)", () => {
  it("returns a fresh empty watermark when no file exists", async () => {
    const dir = await tmp();
    expect(await readWatermark(dir)).toEqual({ v: DISTILL_VERSION, cursors: {} });
  });

  it("returns a fresh empty watermark when the file is corrupt JSON", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".mage", "metrics"), { recursive: true });
    await writeFile(distillWatermarkPath(dir), "{ not json", "utf8");
    expect(await readWatermark(dir)).toEqual({ v: DISTILL_VERSION, cursors: {} });
  });

  it("drops a non-number cursor record (fail-open to empty cursors)", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".mage", "metrics"), { recursive: true });
    await writeFile(
      distillWatermarkPath(dir),
      JSON.stringify({ v: 1, cursors: { s: "oops" } }),
      "utf8",
    );
    expect(await readWatermark(dir)).toEqual({ v: DISTILL_VERSION, cursors: {} });
  });

  it("defaults a missing version to DISTILL_VERSION but keeps valid cursors", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".mage", "metrics"), { recursive: true });
    await writeFile(distillWatermarkPath(dir), JSON.stringify({ cursors: { s: 3 } }), "utf8");
    expect(await readWatermark(dir)).toEqual({ v: DISTILL_VERSION, cursors: { s: 3 } });
  });
});

// ─── writeWatermark — round-trip + JSON shape ─────────────────────────────────

describe("writeWatermark — round-trip + trailing newline", () => {
  it("round-trips a written watermark", async () => {
    const dir = await tmp();
    const wm: DistillWatermark = { v: DISTILL_VERSION, cursors: { "sess-a": 4, "sess-b": 0 } };
    await writeWatermark(dir, wm);
    expect(await readWatermark(dir)).toEqual(wm);
  });

  it("creates .metrics/ and writes pretty JSON with a trailing newline", async () => {
    const dir = await tmp();
    await writeWatermark(dir, { v: DISTILL_VERSION, cursors: { s: 2 } });
    const raw = await readFile(distillWatermarkPath(dir), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  "); // pretty-printed (2-space indent).
  });
});

// ─── advanceWatermark — PURE, never-regress ───────────────────────────────────

describe("advanceWatermark — pure never-regress advance", () => {
  it("sets a fresh session's cursor", () => {
    const wm: DistillWatermark = { v: DISTILL_VERSION, cursors: {} };
    expect(advanceWatermark(wm, "s", 5)).toEqual({ v: DISTILL_VERSION, cursors: { s: 5 } });
  });

  it("never regresses below an existing higher cursor (Math.max)", () => {
    const wm: DistillWatermark = { v: DISTILL_VERSION, cursors: { s: 10 } };
    expect(advanceWatermark(wm, "s", 3).cursors.s).toBe(10);
  });

  it("advances forward when the new offset is higher", () => {
    const wm: DistillWatermark = { v: DISTILL_VERSION, cursors: { s: 3 } };
    expect(advanceWatermark(wm, "s", 8).cursors.s).toBe(8);
  });

  it("does not mutate the input (immutable — new object + new cursors)", () => {
    const wm: DistillWatermark = { v: DISTILL_VERSION, cursors: { s: 3 } };
    const out = advanceWatermark(wm, "s", 8);
    expect(wm.cursors.s).toBe(3); // input untouched.
    expect(out).not.toBe(wm);
    expect(out.cursors).not.toBe(wm.cursors);
  });

  it("leaves other sessions' cursors intact", () => {
    const wm: DistillWatermark = { v: DISTILL_VERSION, cursors: { a: 1, b: 2 } };
    const out = advanceWatermark(wm, "a", 5);
    expect(out.cursors).toEqual({ a: 5, b: 2 });
  });
});
