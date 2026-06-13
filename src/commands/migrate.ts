// `mage migrate` — upgrade a KB's metadata to the current schema (Dec 9 / 0.0.10).
//
// The readers (`readMetadata`/`readHubMetadata`) already accept BOTH schema v1 and
// v2 and normalize a v1 file to the v2 shape IN MEMORY (mode in-repo+hub_refs ⇒
// "hybrid"; hub storage "in-repo" ⇒ "repo-owned"), so nothing is ever broken by an
// un-migrated file. `mage migrate` makes the upgrade durable on disk: it reads the
// metadata at (or above) cwd and writes it back through the schema-stamping write
// helpers. Idempotent — re-running a v2 KB is a quiet no-op. It never commits.

import { dirname, join } from "node:path";
import { logger } from "../logger.js";
import {
  META_DIR,
  META_FILE,
  METADATA_SCHEMA,
  absolutePath,
  exists,
  hubMetadataPath,
  looksLikeHub,
  metadataPath,
  readHubMetadata,
  readMetadata,
  writeHubMetadata,
  writeMetadata,
} from "../paths.js";

export interface MigrateOptions {
  /** Working directory to resolve the KB from (default: cwd). */
  dir?: string;
}

/** One metadata file that was upgraded. */
export interface MigrateEntry {
  path: string;
  from: string;
  to: string;
}

export interface MigrateResult {
  migrated: MigrateEntry[];
  alreadyCurrent: string[];
}

/**
 * Migrate the metadata file(s) for the KB resolved from `dir`:
 *  - a code repo — the nearest ancestor with `mage/metadata.json` (walks up) → its
 *    own metadata;
 *  - a hub — `dir` itself when it `looksLikeHub` (no walk-up) → its top-level
 *    `metadata.json`.
 * Each is rewritten through the schema-stamping write helper iff its on-disk
 * schema is not already current. Throws only when no KB is found.
 */
export async function mageMigrate(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const start = absolutePath(opts.dir ?? process.cwd());
  const migrated: MigrateEntry[] = [];
  const alreadyCurrent: string[] = [];

  // 1. Nearest code-repo metadata (walk up), if any.
  const codeRepo = await findCodeRepo(start);
  if (codeRepo) {
    const path = metadataPath(codeRepo);
    const meta = await readMetadata(codeRepo); // normalizes v1 → v2 in memory
    if (meta) {
      if (meta.schema === METADATA_SCHEMA) {
        alreadyCurrent.push(path);
      } else {
        await writeMetadata(codeRepo, meta);
        migrated.push({ path, from: meta.schema, to: METADATA_SCHEMA });
      }
    }
  }

  // 2. A hub at the start dir, if any (a repo is never also a hub).
  if (await looksLikeHub(start)) {
    const path = hubMetadataPath(start);
    const hub = await readHubMetadata(start);
    if (hub) {
      if (hub.schema === METADATA_SCHEMA) {
        alreadyCurrent.push(path);
      } else {
        await writeHubMetadata(start, hub);
        migrated.push({ path, from: hub.schema, to: METADATA_SCHEMA });
      }
    }
  }

  if (migrated.length === 0 && alreadyCurrent.length === 0) {
    throw new Error(
      `No mage knowledge base found at or above ${start}. Nothing to migrate.`,
    );
  }
  return { migrated, alreadyCurrent };
}

/** Walk up from `start` to the nearest dir holding `mage/metadata.json`. */
async function findCodeRepo(start: string): Promise<string | null> {
  let dir = start;
  for (;;) {
    if (await exists(join(dir, META_DIR, META_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Print a human summary of a migration run. */
export function reportMigrate(result: MigrateResult): void {
  if (result.migrated.length === 0) {
    logger.success(`Metadata already current (${METADATA_SCHEMA}); nothing to migrate.`);
    return;
  }
  for (const m of result.migrated) {
    logger.success(`Migrated ${m.path} (${m.from} → ${m.to})`);
  }
  for (const p of result.alreadyCurrent) {
    logger.detail(`Already current: ${p}`);
  }
  logger.blank();
  logger.info("Review the diff and commit yourself (mage never commits):");
  logger.detail("  git add metadata.json mage/metadata.json 2>/dev/null; git commit -m \"chore: migrate mage metadata to v2\"");
}
