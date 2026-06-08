// distill's per-session offset watermark (ADR-0018 §3). The bookmark that keeps
// distill idempotent: `Record<session, offset>` of events already dispositioned,
// living in `<docsRoot>/.metrics/distill.json` (gitignored, derived, the sibling
// of the context-match rollup). Mirrors rollup.ts exactly — fail-open read, a
// never-regress `Math.max` advance, pretty-JSON write with a trailing newline.
//
// `mage distill --json` is a PURE READ; ONLY `mage distill --seen` writes here,
// AFTER the human keeps/skips a batch. An interrupted run never advances, so a
// re-run safely re-offers (the skill's overlap-check dedupes already-written
// notes). The reader fails open on a missing/corrupt file so a bad watermark
// just re-offers everything — never throws to a host hook.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { METRICS_DIR } from "../paths.js";

// ─── consts ────────────────────────────────────────────────────────────────────

/** The single watermark file, sibling of the context-match rollup in `.metrics/`. */
export const DISTILL_FILE = "distill.json";
/** Bump when the on-disk watermark shape changes (a fresh empty file re-stamps). */
export const DISTILL_VERSION = 1;

// ─── types ─────────────────────────────────────────────────────────────────────

/** The persisted bookmark: per-session offset of events already dispositioned. */
export interface DistillWatermark {
  v: number;
  cursors: Record<string, number>;
}

/** A fresh, empty watermark at the current version. */
function emptyWatermark(): DistillWatermark {
  return { v: DISTILL_VERSION, cursors: {} };
}

// ─── path ──────────────────────────────────────────────────────────────────────

/** The on-disk watermark path under a docs root. */
export function distillWatermarkPath(docsRoot: string): string {
  return join(docsRoot, METRICS_DIR, DISTILL_FILE);
}

// ─── readWatermark — fail-open on missing/corrupt ───────────────────────────────

/**
 * Read the persisted watermark. Missing file (ENOENT) or corrupt JSON → a fresh
 * empty watermark. This is reachable from a host hook (nudged at session-end), so
 * it must NEVER throw — a bad file just re-offers everything.
 */
export async function readWatermark(docsRoot: string): Promise<DistillWatermark> {
  let raw: string;
  try {
    raw = await readFile(distillWatermarkPath(docsRoot), "utf8");
  } catch {
    return emptyWatermark(); // missing (ENOENT) or unreadable → fresh.
  }
  try {
    return normalizeWatermark(JSON.parse(raw) as unknown);
  } catch {
    return emptyWatermark(); // corrupt JSON → fail-open to fresh.
  }
}

/** Coerce a parsed value into a well-shaped watermark, defaulting absent fields. */
function normalizeWatermark(parsed: unknown): DistillWatermark {
  if (parsed === null || typeof parsed !== "object") return emptyWatermark();
  const p = parsed as Partial<DistillWatermark>;
  return {
    v: typeof p.v === "number" ? p.v : DISTILL_VERSION,
    cursors: isNumberRecord(p.cursors) ? p.cursors : {},
  };
}

/** True iff `v` is a plain object whose values are all numbers (drops junk cursors). */
function isNumberRecord(v: unknown): v is Record<string, number> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((n) => typeof n === "number");
}

// ─── writeWatermark ─────────────────────────────────────────────────────────────

/** Persist the watermark (creating `.metrics/`), pretty-printed with trailing NL. */
export async function writeWatermark(docsRoot: string, wm: DistillWatermark): Promise<void> {
  await mkdir(join(docsRoot, METRICS_DIR), { recursive: true });
  await writeFile(distillWatermarkPath(docsRoot), JSON.stringify(wm, null, 2) + "\n", "utf8");
}

// ─── advanceWatermark — PURE, never-regress ─────────────────────────────────────

/**
 * Advance one session's cursor to `offset`, never regressing — the watermark is a
 * stable growing prefix (the rollup's `Math.max` rule). A re-disposition of an
 * already-passed batch is a no-op. PURE: the input is never mutated; a NEW
 * watermark object (with a NEW cursors record) is returned.
 */
export function advanceWatermark(
  wm: DistillWatermark,
  session: string,
  offset: number,
): DistillWatermark {
  const prev = wm.cursors[session] ?? 0;
  return {
    v: wm.v,
    cursors: { ...wm.cursors, [session]: Math.max(prev, offset) },
  };
}
