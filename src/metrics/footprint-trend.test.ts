import { describe, expect, it } from "vitest";
import { mkdir, writeFile, chmod, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpDir } from "../../test/fixtures/kb.js";
import {
  appendTrendRow,
  readTrend,
  TREND_MAX_AGE_DAYS,
  TREND_MAX_ROWS,
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

  it("compaction triggers past the threshold and the file afterwards is valid and equivalent", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS * 2 + 5; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-${i}`, ts));
    }

    const metricsDir = join(docsRoot, ".mage", "metrics");
    const path = join(metricsDir, "footprint.jsonl");

    // the above loops create 405 lines. readTrend should trigger compaction and keep only 200 rows.
    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(TREND_MAX_ROWS);

    // Verify compaction occurred: file lines should equal TREND_MAX_ROWS
    const rawAfter = await readFile(path, "utf8");
    const linesAfter = rawAfter.split("\n").filter((l) => l.trim().length > 0);
    expect(linesAfter.length).toBe(TREND_MAX_ROWS);
    
    // Valid and equivalent
    const trendAfterCompaction = await readTrend(docsRoot);
    expect(trendAfterCompaction.rows.length).toBe(TREND_MAX_ROWS);
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
