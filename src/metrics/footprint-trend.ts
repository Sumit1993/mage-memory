import { join } from "node:path";
import { readFile, appendFile, mkdir, rename, stat } from "node:fs/promises";
import { metricsPath } from "../paths.js";
import type { BudgetState } from "./footprint.js";

export const TREND_VERSION = 1;
/** Bounded per ADR-0039 §6 — the trend must not grow without limit. */
export const TREND_MAX_ROWS = 200;
export const TREND_MAX_AGE_DAYS = 90;
export const TREND_ROTATE_MAX_BYTES = 1024 * 1024;

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
  return join(metricsPath(docsRoot), "footprint.jsonl");
}

function legacyTrendPath(docsRoot: string): string {
  return join(metricsPath(docsRoot), "footprint.json");
}

function emptyTrend(): FootprintTrend {
  return { v: TREND_VERSION, rows: [] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isTrendRow(r: unknown): r is FootprintTrendRow {
  if (!isRecord(r)) return false;
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

export async function readTrend(docsRoot: string): Promise<FootprintTrend> {
  const jlPath = footprintTrendPath(docsRoot);
  const legPath = legacyTrendPath(docsRoot);

  const rowsBySession = new Map<string, FootprintTrendRow>();
  let totalParsedLines = 0;

  // 1. Fold legacy JSON if it exists
  try {
    const rawLegacy = await readFile(legPath, "utf8");
    const parsed = JSON.parse(rawLegacy);
    if (isRecord(parsed) && Array.isArray(parsed.rows)) {
      for (const r of parsed.rows) {
        if (isTrendRow(r)) {
          rowsBySession.set(r.session, r);
          totalParsedLines++;
        }
      }
    }
  } catch {
    // Missing, corrupt, etc. — ignore
  }

  // 2. Fold JSONL
  let readSuccess = false;
  try {
    const raw = await readFile(jlPath, "utf8");
    readSuccess = true;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      totalParsedLines++;
      try {
        const parsed = JSON.parse(trimmed);
        if (isTrendRow(parsed)) {
          rowsBySession.set(parsed.session, parsed);
        }
      } catch {
        // Skip torn/garbage line
      }
    }
  } catch {
    // Missing file or unreadable
  }

  if (!readSuccess && rowsBySession.size === 0) {
    return emptyTrend();
  }

  // 3. Prune and sort
  const nowMs = Date.now();
  const limitMs = TREND_MAX_AGE_DAYS * 86_400_000;

  let validRows = Array.from(rowsBySession.values()).filter((r) => {
    const d = new Date(r.ts);
    if (Number.isNaN(d.getTime())) return false;
    return nowMs - d.getTime() <= limitMs;
  });

  validRows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  if (validRows.length > TREND_MAX_ROWS) {
    validRows = validRows.slice(validRows.length - TREND_MAX_ROWS);
  }

  // 4. Compaction was removed - readTrend is read-only.

  return { v: TREND_VERSION, rows: validRows };
}

export async function appendTrendRow(docsRoot: string, row: FootprintTrendRow): Promise<void> {
  const mPath = metricsPath(docsRoot);
  try {
    await mkdir(mPath, { recursive: true });
    const jlPath = footprintTrendPath(docsRoot);

    let size = 0;
    try {
      size = (await stat(jlPath)).size;
    } catch {
      // no file yet
    }

    if (size >= TREND_ROTATE_MAX_BYTES) {
      try {
        const archiveDir = join(mPath, ".archive");
        await mkdir(archiveDir, { recursive: true });
        const stamp = `${timestamp()}-${process.pid}`;
        await rename(jlPath, join(archiveDir, `footprint-${stamp}.jsonl`));
      } catch {
        // rotation race / fs error - fail open, keep appending to current file
      }
    }

    await appendFile(jlPath, JSON.stringify(row) + "\n", "utf8");
  } catch {
    // silently fail if unwritable or any other error
  }
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}
