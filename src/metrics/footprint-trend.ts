import { join } from "node:path";
import { readFile, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { metricsPath } from "../paths.js";
import type { BudgetState } from "./footprint.js";

export const TREND_VERSION = 1;
/** Bounded per ADR-0039 §6 — the trend must not grow without limit. */
export const TREND_MAX_ROWS = 200;
export const TREND_MAX_AGE_DAYS = 90;

export interface FootprintTrendRow {
  session: string;      // observe session id
  ts: string;           // ISO timestamp
  bytes: number;        // the CAPPED surface bytes
  lines?: number;       // the CAPPED surface lines
  ratio: number;
  state: BudgetState;
  notes: number;        // note count at sample time
}

export interface FootprintTrend {
  v: number;
  rows: FootprintTrendRow[];
}

function footprintTrendPath(docsRoot: string): string {
  return join(metricsPath(docsRoot), "footprint.json");
}

function lockPath(docsRoot: string): string {
  return join(metricsPath(docsRoot), "footprint.json.lock");
}

function emptyTrend(): FootprintTrend {
  return { v: TREND_VERSION, rows: [] };
}

function isTrendRow(r: unknown): r is FootprintTrendRow {
  if (r === null || typeof r !== "object") return false;
  const p = r as Record<string, unknown>;
  return (
    typeof p.session === "string" &&
    typeof p.ts === "string" &&
    typeof p.bytes === "number" &&
    (typeof p.lines === "number" || p.lines === undefined) &&
    typeof p.ratio === "number" &&
    typeof p.state === "string" &&
    typeof p.notes === "number"
  );
}

function normalizeTrend(parsed: unknown): FootprintTrend {
  if (parsed === null || typeof parsed !== "object") return emptyTrend();
  const p = parsed as Partial<FootprintTrend>;
  const v = typeof p.v === "number" ? p.v : TREND_VERSION;
  const rows = Array.isArray(p.rows) ? p.rows.filter(isTrendRow) : [];
  return { v, rows: rows as FootprintTrendRow[] };
}

export async function readTrend(docsRoot: string): Promise<FootprintTrend> {
  let raw: string;
  try {
    raw = await readFile(footprintTrendPath(docsRoot), "utf8");
  } catch {
    return emptyTrend();
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeTrend(parsed);
  } catch {
    return emptyTrend(); // fail-open on malformed JSON
  }
}

export async function appendTrendRow(docsRoot: string, row: FootprintTrendRow): Promise<void> {
  const mPath = metricsPath(docsRoot);
  try {
    await mkdir(mPath, { recursive: true });
  } catch {
    // silently fail if unwritable
  }

  const fileLock = lockPath(docsRoot);
  let locked = false;
  let attempts = 0;
  const myToken = `${process.pid}-${randomUUID()}`;
  while (attempts < 5) {
    try {
      await writeFile(fileLock, myToken, { flag: "wx", encoding: "utf8" });
      locked = true;
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") return;
      try {
        const s = await stat(fileLock);
        if (Date.now() - s.mtimeMs > 30000) {
          const scratchName = `${fileLock}.stale.${Date.now()}.${Math.random().toString(36).slice(2)}`;
          await rename(fileLock, scratchName);
          await rm(scratchName, { force: true });
          // Count the eviction against the budget: this runs on the SessionStart hook
          // path (ADR-0039 §6), so every branch of this loop must be bounded. Skipping
          // the increment here let sustained contention spin without limit.
          attempts++;
          continue;
        }
      } catch {
        // file might be gone
      }
    }
    await new Promise((r) => setTimeout(r, 20));
    attempts++;
  }

  if (!locked) return;

  try {
    const trend = await readTrend(docsRoot);

    const idx = trend.rows.findIndex((r) => r.session === row.session);
    if (idx >= 0) {
      trend.rows[idx] = row;
    } else {
      trend.rows.push(row);
    }

    const nowMs = Date.now();
    const limitMs = TREND_MAX_AGE_DAYS * 86_400_000;

    let validRows = trend.rows.filter((r) => {
      const d = new Date(r.ts);
      if (Number.isNaN(d.getTime())) return false;
      return nowMs - d.getTime() <= limitMs;
    });

    validRows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    if (validRows.length > TREND_MAX_ROWS) {
      validRows = validRows.slice(validRows.length - TREND_MAX_ROWS);
    }

    trend.rows = validRows;
    trend.v = TREND_VERSION;

    const tmpPath = join(mPath, `footprint.json.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`);
    await writeFile(tmpPath, JSON.stringify(trend, null, 2) + "\n", "utf8");
    await rename(tmpPath, footprintTrendPath(docsRoot));
  } catch {
    // silently fail
  } finally {
    try {
      const currentToken = await readFile(fileLock, "utf8");
      if (currentToken === myToken) {
        await rm(fileLock, { force: true });
      }
    } catch {
      // file might be gone or taken over
    }
  }
}
