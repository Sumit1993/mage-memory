import { describe, expect, it } from "vitest";
import { mkdir, writeFile, chmod, appendFile, readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
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
    const metricsDir = join(docsRoot, ".mage", "metrics");
    await mkdir(metricsDir, { recursive: true });

    await chmod(metricsDir, 0o444);

    try {
      await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));
    } finally {
      await chmod(metricsDir, 0o755);
    }

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(0);
  });

  

  
  it("readTrend never writes", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS * 2 + 5; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-${i}`, ts));
    }

    const metricsDir = join(docsRoot, ".mage", "metrics");
    const path = join(metricsDir, "footprint.jsonl");

    const statBefore = await stat(path);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(TREND_MAX_ROWS);

    const statAfter = await stat(path);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    expect(statAfter.size).toBe(statBefore.size);
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
});
