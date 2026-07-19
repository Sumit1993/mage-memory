import { describe, expect, it } from "vitest";
import { mkdir, writeFile, chmod, utimes } from "node:fs/promises";
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

  it("re-appending the SAME session id replaces, does not duplicate", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const row1 = makeRow("sess-1", new Date().toISOString());
    row1.bytes = 1000;
    await appendTrendRow(docsRoot, row1);

    const row2 = makeRow("sess-1", new Date().toISOString());
    row2.bytes = 2000; // Updated
    await appendTrendRow(docsRoot, row2);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
    expect(trend.rows[0]?.bytes).toBe(2000);
  });

  it("rows beyond TREND_MAX_ROWS are dropped, newest kept", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");

    const now = Date.now();
    for (let i = 0; i < TREND_MAX_ROWS + 5; i++) {
      const ts = new Date(now + i * 1000).toISOString();
      await appendTrendRow(docsRoot, makeRow(`sess-${i}`, ts));
    }

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(TREND_MAX_ROWS);
    // Should keep the newest (highest index)
    expect(trend.rows[trend.rows.length - 1]?.session).toBe(`sess-${TREND_MAX_ROWS + 4}`);
    expect(trend.rows[0]?.session).toBe(`sess-5`);
  });

  it("rows older than TREND_MAX_AGE_DAYS are pruned", async () => {
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

  it("malformed JSON on disk does NOT throw and is treated as empty", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    await mkdir(metricsDir, { recursive: true });
    
    await writeFile(join(metricsDir, "footprint.json"), "garbage{");

    // Reading should not throw
    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(0);

    // Appending should overwrite garbage
    await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));
    const trendAfter = await readTrend(docsRoot);
    expect(trendAfter.rows.length).toBe(1);
  });

  it("unwritable path does NOT throw", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    await mkdir(metricsDir, { recursive: true });

    // Make metrics dir unwritable
    await chmod(metricsDir, 0o444);

    // Append should silently ignore
    try {
      await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));
    } finally {
      await chmod(metricsDir, 0o755); // restore to allow cleanup
    }

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(0); // wasn't written
  });

  it("two concurrent appendTrendRow calls both complete without throwing, and the file is valid JSON afterwards", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const row1 = makeRow("sess-1", new Date().toISOString());
    const row2 = makeRow("sess-2", new Date().toISOString());
    
    await Promise.all([
      appendTrendRow(docsRoot, row1),
      appendTrendRow(docsRoot, row2),
    ]);

    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBeGreaterThan(0); // at least one succeeded
  });

  it("a pre-existing fresh lockfile causes the sample to be skipped, without throwing", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    await mkdir(join(docsRoot, ".mage", "metrics"), { recursive: true });
    await writeFile(join(docsRoot, ".mage", "metrics", "footprint.json.lock"), "");

    await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));
    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(0);
  });

  it("a stale (>30 s old) lockfile is taken over and the sample is written", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    const metricsDir = join(docsRoot, ".mage", "metrics");
    await mkdir(metricsDir, { recursive: true });
    const lockfile = join(metricsDir, "footprint.json.lock");
    await writeFile(lockfile, "");
    
    // Set mtime to 40 seconds ago
    const staleTime = new Date(Date.now() - 40000);
    await utimes(lockfile, staleTime, staleTime);

    await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));
    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
  });

  it("the file is never left in a corrupt state (write a row, assert readTrend parses)", async () => {
    const dir = await tmpDir("mage-trend-");
    const docsRoot = join(dir, "mage");
    await appendTrendRow(docsRoot, makeRow("sess-1", new Date().toISOString()));
    const trend = await readTrend(docsRoot);
    expect(trend.rows.length).toBe(1);
  });
});
