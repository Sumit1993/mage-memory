// `mage autonomy [level]` — the visible get/set for the opt-in autonomy ladder (ADR-0030).
//
// NO arg → prints the resolved level, its one-line meaning, and where it is set (or the
// default when unset). An arg (operator | approver | overseer) validates, merges into
// `metadata.json → grooming` PRESERVING the other grooming fields (sensitivity,
// nudgeThrottleHours), writes through the schema-stamping writer, and prints the path.
//
// The field is a TRACKED metadata field (ADR-0001: config is files-as-truth; no env var).
// mage never commits (ADR-0013) — the write lands uncommitted in the working tree and the
// human `git add`s it. FAIL-LOUD on no-KB / junk-level (this is an interactive command,
// not a hook): it throws so the CLI surfaces the error and exits non-zero.

import { logger } from "../logger.js";
import { hubMetadataPath, metadataPath, requireDocsRoot } from "../paths.js";
import { groomingFieldIsSet, readAutonomy, writeGroomingField } from "../grooming/config.js";
import { DEFAULT_AUTONOMY, coerceAutonomy, meaningOf } from "../grooming/autonomy-ladder.js";

export interface AutonomyOptions {
  /** The level to set; omit to read the current level. */
  level?: string;
  /** Working directory used to resolve the KB (default: cwd; walks up). */
  dir?: string;
}

/**
 * Get or set the autonomy level for the KB resolved from `dir`. With no `level`, prints the
 * resolved level + meaning + where it is set. With a `level`, validates it (throws listing the
 * three on junk), merges into `grooming` preserving the other fields, writes, and prints the path.
 */
export async function autonomy(opts: AutonomyOptions = {}): Promise<void> {
  const resolved = await requireDocsRoot(opts.dir);

  // ── GET: no level → report the resolved level, its meaning, and where it lives. ──
  if (opts.level === undefined) {
    const level = await readAutonomy(resolved);
    const path = resolved.kind === "hub" ? hubMetadataPath(resolved.repo) : metadataPath(resolved.repo);
    const set = await groomingFieldIsSet(resolved, "autonomy");
    logger.info(`autonomy: ${level}`);
    logger.detail(meaningOf(level));
    logger.detail(set ? `set in ${path}` : `default (unset; absent ⇒ ${DEFAULT_AUTONOMY}) — would be set in ${path}`);
    return;
  }

  // ── SET: validate, then read-merge-write the one field through the config seam (other
  // grooming fields preserved, schema stamped). mage never commits — the write is uncommitted. ──
  const next = coerceAutonomy(opts.level);
  const path = await writeGroomingField(resolved, { autonomy: next });
  logger.success(`autonomy set to ${next} in ${path}; mage never commits; git add it to track`);
}
