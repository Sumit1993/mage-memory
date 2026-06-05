import { stat } from "node:fs/promises";
import { logger } from "../logger.js";
import { absolutePath } from "../paths.js";
import { type IngestKind, type IngestSource, scanIngestSources } from "../ingest.js";

export interface IngestCmdOptions {
  /** Emit the manifest as JSON to stdout (machine-readable, consumed by the skill). */
  json?: boolean;
}

/** Stable display order for the grouped human summary. */
const KIND_ORDER: IngestKind[] = [
  "skill",
  "note",
  "prose",
  "transcript",
  "feeder-ecc",
  "feeder-native",
];

/**
 * Enumerate + classify the ingestable sources under `dir` (read-only, ADR-0013).
 * This is the deterministic manifest the `mage:learn --from <dir>` skill consumes
 * before distilling — this command NEVER writes notes/skills. With `--json` it
 * prints `JSON.stringify(sources)` to stdout for the skill; otherwise it logs a
 * grouped, human-readable summary (counts per kind + the relPaths). Returns the
 * sources so callers can use them programmatically.
 */
export async function ingestCmd(
  dir: string,
  opts: IngestCmdOptions,
): Promise<IngestSource[]> {
  const root = absolutePath(dir);
  await assertDirExists(root, dir);
  const sources = await scanIngestSources(root);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(sources)}\n`);
    return sources;
  }

  report(dir, sources);
  return sources;
}

/** Validate that `dir` exists and is a directory; throw a friendly error otherwise. */
async function assertDirExists(root: string, original: string): Promise<void> {
  let s: import("node:fs").Stats;
  try {
    s = await stat(root);
  } catch {
    throw new Error(`No such directory: ${original}`);
  }
  if (!s.isDirectory()) {
    throw new Error(`Not a directory: ${original}`);
  }
}

// ─── human report ────────────────────────────────────────────────────────────

/** Log a grouped summary: total + per-kind counts, each with its relPaths. */
function report(dir: string, sources: IngestSource[]): void {
  logger.info(`mage ingest — ${sources.length} ingestable source(s) under ${dir} (read-only)`);
  logger.blank();
  if (sources.length === 0) {
    logger.detail("Nothing ingestable here.");
    return;
  }
  for (const kind of KIND_ORDER) {
    const group = sources.filter((s) => s.kind === kind);
    if (group.length === 0) continue;
    logger.step(`${kind} (${group.length})`);
    for (const s of group) logger.detail(`${s.relPath}${titleSuffix(s)}`);
  }
}

/** A trailing ` — <title>` annotation when a source carries one. */
function titleSuffix(s: IngestSource): string {
  return s.title ? ` — ${s.title}` : "";
}
