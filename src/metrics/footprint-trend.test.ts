import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile, appendFile, readFile, stat, readdir, utimes } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    appendFile: vi.fn(actual.appendFile),
    readFile: vi.fn(actual.readFile),
    rm: vi.fn(actual.rm),
  };
});
import { tmpDir } from "../../test/fixtures/kb.js";
import {
  appendTrendRow,
  readTrend,
  TREND_MAX_AGE_DAYS,
  TREND_MAX_ROWS,
  TREND_ROTATE_MAX_BYTES,
  type FootprintTrendRow,
} from "./footprint-trend.js";

function makeRow(session: string, ts: string): FootprintTrendRow {
  return {
    session,
    ts,
    bytes: 1000,
    ratio: 0.1,
    state: "ok",
    notes: 10,
  };
}

describe("footprint-trend", () => {
  // These fs wrappers are partial mocks delegating to the real implementation, so a
  // `mockRejectedValueOnce` a test does not consume would leak into the next one.
  // `mockReset` restores the implementation passed to `vi.fn(actual.x)` — do NOT
  // re-set it from the module import, which is the mock itself.
  afterEach(() => {
    vi.mocked(fsPromises.appendFile).mockReset();
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.rm).mockReset();
  });

  it("append creates the file and round-trips a row", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const row = makeRow("sess-1", new Date().toISOString());
    row.lines = 150;
    await appendTrendRow(docsRoot, row);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]).toEqual(row);
    expect(trend.rows[0]?.lines).toBe(150);
  });

  it("two concurrent appendTrendRow calls with different sessions -> BOTH rows present", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const row1 = makeRow("sess-1", new Date().toISOString());
    const row2 = makeRow("sess-2", new Date().toISOString());
    
    await Promise.all([
      appendTrendRow(docsRoot, row1),
      appendTrendRow(docsRoot, row2),
    ]);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(2);
    expect(trend.rows.map((r) => r.session)).toContain("sess-1");
    expect(trend.rows.map((r) => r.session)).toContain("sess-2");
  });

  it("re-appending the same session id -> readTrend returns one row, the later one", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const row1 = makeRow("sess-1", new Date().toISOString());
    row1.bytes = 1000;
    await appendTrendRow(docsRoot, row1);

    const row2 = makeRow("sess-1", new Date().toISOString());
    row2.bytes = 2000;
    await appendTrendRow(docsRoot, row2);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]?.bytes).toBe(2000);
  });

  it("a corrupt/truncated line in the middle of the file is skipped; surrounding rows survive", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    await mkdir(metricsDir, { recursive: true });
    
    const row1 = makeRow("sess-1", new Date().toISOString());
    const row2 = makeRow("sess-2", new Date().toISOString());
    
    await writeFile(join(metricsDir, "footprint.jsonl"), JSON.stringify(row1) + "\n");
    await appendFile(join(metricsDir, "footprint.jsonl"), "garbage{" + "\n");
    await appendFile(join(metricsDir, "footprint.jsonl"), JSON.stringify(row2) + "\n");

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(2);
    expect(trend.rows.map((r) => r.session)).toContain("sess-1");
    expect(trend.rows.map((r) => r.session)).toContain("sess-2");
  });

  it("rows older than TREND_MAX_AGE_DAYS are pruned at fold", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const now = Date.now();
    const oldTs = new Date(now - (TREND_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    const okTs = new Date(now - (TREND_MAX_AGE_DAYS - 1) * 86_400_000).toISOString();

    await appendTrendRow(docsRoot, makeRow("sess-old", oldTs));
    await appendTrendRow(docsRoot, makeRow("sess-ok", okTs));

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]?.session).toBe("sess-ok");
  });

  it("more than TREND_MAX_ROWS -> newest TREND_MAX_ROWS kept", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS + 5; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-${i}`, ts));
    }

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(TREND_MAX_ROWS);
    expect(trend.rows[trend.rows.length - 1]?.session).toBe(`sess-${TREND_MAX_ROWS + 4}`);
    expect(trend.rows[0]?.session).toBe(`sess-5`);
  });

  it("missing file -> empty trend, no throw", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(0);
  });

  it("unwritable path -> appendTrendRow does not throw", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    vi.mocked(fsPromises.appendFile).mockRejectedValueOnce(new Error("EACCES"));

    await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(0);
  });

  it("readTrend never writes", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    const archiveDir = join(metricsDir, ".archive");
    await mkdir(archiveDir, { recursive: true });

    const archiveRow = makeRow("sess-archive", new Date().toISOString());
    const archivePath = join(archiveDir, "footprint-20230101-120000.jsonl");
    await writeFile(archivePath, JSON.stringify(archiveRow) + "\n");

    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS * 2 + 5; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-${i}`, ts));
    }

    const path = join(metricsDir, "footprint.jsonl");

    const statBefore = await stat(path);
    const archiveStatBefore = await stat(archivePath);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(TREND_MAX_ROWS);

    const statAfter = await stat(path);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    expect(statAfter.size).toBe(statBefore.size);
    
    const archiveStatAfter = await stat(archivePath);
    expect(archiveStatAfter.mtimeMs).toBe(archiveStatBefore.mtimeMs);
    expect(archiveStatAfter.size).toBe(archiveStatBefore.size);
  });

  it("Append during read is not lost", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    // Fill so old code would compact
    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS * 2 + 5; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-${i}`, ts));
    }

    // Interleave: read the file contents, append a new row, then call readTrend
    // (We simulate the old compaction race by running them concurrently, or just sequentially as instructed)
    const readPromise = readTrend(docsRoot);
    await appendTrendRow(docsRoot, makeRow("race-row", new Date(now + 9999999).toISOString()));
    await readPromise;

    // The appended row should be present in the file and a subsequent read
    const finalTrend = await readTrend(docsRoot);
    expect(finalTrend.rows.map(r => r.session)).toContain("race-row");
  });

  it("Rotation triggers past TREND_ROTATE_MAX_BYTES", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    const path = join(metricsDir, "footprint.jsonl");

    // Write a large file directly to simulate hitting the rotate threshold
    await mkdir(metricsDir, { recursive: true });
    
    // Create a row that is ~150B
    const dummyRow = JSON.stringify(makeRow("dummy", new Date().toISOString())) + "\n";
    // Write enough bytes to exceed TREND_ROTATE_MAX_BYTES (1MB)
    const repeats = Math.ceil((TREND_ROTATE_MAX_BYTES + 100) / dummyRow.length);
    await writeFile(path, dummyRow.repeat(repeats), "utf8");

    // Now append one more row. This should trigger rotation.
    await appendTrendRow(docsRoot, makeRow("trigger-rotate", new Date().toISOString()));

    // The live file should now only contain the new row
    const liveContents = await readFile(path, "utf8");
    expect(liveContents).toContain("trigger-rotate");
    expect(liveContents.length).toBeLessThan(TREND_ROTATE_MAX_BYTES);

    // The archive dir should exist and have a file
    const archiveDir = join(metricsDir, ".archive");
    const archives = await readdir(archiveDir);
    expect(archives.length).toBe(1);
    expect(archives[0]).toMatch(/^footprint-.*\.jsonl$/);
  });

  it("Rotation does not throw when the archive dir does not yet exist", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    const path = join(metricsDir, "footprint.jsonl");
    await mkdir(metricsDir, { recursive: true });

    // Make live file exceed threshold
    const dummyRow = JSON.stringify(makeRow("dummy", new Date().toISOString())) + "\n";
    const repeats = Math.ceil((TREND_ROTATE_MAX_BYTES + 100) / dummyRow.length);
    await writeFile(path, dummyRow.repeat(repeats), "utf8");

    // Make sure archive dir DOES NOT exist
    // (mkdir with recursive: true handles it, but this tests the execution path)

    // Append should succeed and not throw
    await expect(appendTrendRow(docsRoot, makeRow("new-row", new Date().toISOString()))).resolves.toBeUndefined();

    // Verify it rotated
    const archives = await readdir(join(metricsDir, ".archive"));
    expect(archives.length).toBe(1);
  });
  it("a legacy footprint.json is folded in rather than crashing", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    await mkdir(metricsDir, { recursive: true });

    const rowLegacy = makeRow("sess-legacy", new Date().toISOString());
    const legacyDoc = { v: 1, rows: [rowLegacy] };
    await writeFile(join(metricsDir, "footprint.json"), JSON.stringify(legacyDoc));

    const rowNew = makeRow("sess-new", new Date().toISOString());
    await appendTrendRow(docsRoot, rowNew);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(2);
    expect(trend.rows.map((r) => r.session)).toContain("sess-legacy");
    expect(trend.rows.map((r) => r.session)).toContain("sess-new");
  });

  it("rows living only in an archive appear in readTrend output", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const archiveDir = join(docsRoot, ".mage", "metrics", ".archive");
    await mkdir(archiveDir, { recursive: true });

    const row = makeRow("sess-archive", new Date().toISOString());
    await writeFile(join(archiveDir, "footprint-20230101-120000.jsonl"), JSON.stringify(row) + "\n");

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]?.session).toBe("sess-archive");
  });

  it("live rows win over archive rows for the same session id", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const archiveDir = join(docsRoot, ".mage", "metrics", ".archive");
    await mkdir(archiveDir, { recursive: true });

    const archiveRow = makeRow("sess-conflict", new Date().toISOString());
    archiveRow.bytes = 1000;
    await writeFile(join(archiveDir, "footprint-20230101-120000.jsonl"), JSON.stringify(archiveRow) + "\n");

    const liveRow = makeRow("sess-conflict", new Date().toISOString());
    liveRow.bytes = 2000;
    await appendTrendRow(docsRoot, liveRow);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]?.bytes).toBe(2000);
  });

  it("archives are not read once the retained window is already satisfied by the live file", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const archiveDir = join(docsRoot, ".mage", "metrics", ".archive");
    await mkdir(archiveDir, { recursive: true });

    const archiveRow = makeRow("sess-archive", new Date().toISOString());
    await writeFile(join(archiveDir, "footprint-20230101-120000.jsonl"), JSON.stringify(archiveRow) + "\n");

    vi.mocked(fsPromises.readFile).mockClear();

    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-live-${i}`, ts));
    }

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(TREND_MAX_ROWS);
    expect(trend.rows.map((r) => r.session)).not.toContain("sess-archive");
    
    const archiveReads = vi.mocked(fsPromises.readFile).mock.calls.filter(call => call[0].toString().includes("footprint-20230101-120000.jsonl"));
    expect(archiveReads.length).toBe(0);
  });

  it("archives older than TREND_MAX_AGE_DAYS are deleted by appendTrendRow", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const archiveDir = join(docsRoot, ".mage", "metrics", ".archive");
    await mkdir(archiveDir, { recursive: true });

    const archiveRow = makeRow("sess-old", new Date().toISOString());
    const oldFile = join(archiveDir, "footprint-20230101-120000.jsonl");
    await writeFile(oldFile, JSON.stringify(archiveRow) + "\n");
    
    const oldDate = new Date(Date.now() - (TREND_MAX_AGE_DAYS + 1) * 86_400_000);
    await utimes(oldFile, oldDate, oldDate);

    await appendTrendRow(docsRoot, makeRow("sess-new", new Date().toISOString()));

    const archives = await readdir(archiveDir);
    expect(archives).not.toContain("footprint-20230101-120000.jsonl");
  });

  it("a fresh archive is not deleted", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const archiveDir = join(docsRoot, ".mage", "metrics", ".archive");
    await mkdir(archiveDir, { recursive: true });

    const archiveRow = makeRow("sess-fresh", new Date().toISOString());
    const freshFile = join(archiveDir, "footprint-fresh.jsonl");
    await writeFile(freshFile, JSON.stringify(archiveRow) + "\n");

    await appendTrendRow(docsRoot, makeRow("sess-new", new Date().toISOString()));

    const archives = await readdir(archiveDir);
    expect(archives).toContain("footprint-fresh.jsonl");
  });

  it("purge failure does not throw", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const archiveDir = join(docsRoot, ".mage", "metrics", ".archive");
    await mkdir(archiveDir, { recursive: true });

    vi.mocked(fsPromises.rm).mockRejectedValueOnce(new Error("Fake RM Error"));
    
    const oldFile = join(archiveDir, "footprint-20230102-120000.jsonl");
    await writeFile(oldFile, "dummy");
    const oldDate = new Date(Date.now() - (TREND_MAX_AGE_DAYS + 1) * 86_400_000);
    await utimes(oldFile, oldDate, oldDate);

    await expect(appendTrendRow(docsRoot, makeRow("sess-new", new Date().toISOString()))).resolves.toBeUndefined();
  });
});
