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
import {
  type GroomingConfig,
  absolutePath,
  hubMetadataPath,
  metadataPath,
  readHubMetadata,
  readMetadata,
  resolveDocsRoot,
  writeHubMetadata,
  writeMetadata,
} from "../paths.js";
import { readAutonomy } from "../grooming/thresholds.js";
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
  const resolved = await resolveDocsRoot(absolutePath(opts.dir ?? process.cwd()));
  if (!resolved) {
    throw new Error(
      `No mage knowledge base found at or above ${absolutePath(opts.dir ?? process.cwd())}. ` +
        "Run `mage init` or `mage link` first.",
    );
  }

  // ── GET: no level → report the resolved level, its meaning, and where it lives. ──
  if (opts.level === undefined) {
    const level = await readAutonomy(resolved);
    const path = resolved.kind === "hub" ? hubMetadataPath(resolved.repo) : metadataPath(resolved.repo);
    const set = await isExplicitlySet(resolved);
    logger.info(`autonomy: ${level}`);
    logger.detail(meaningOf(level));
    logger.detail(set ? `set in ${path}` : `default (unset; absent ⇒ ${DEFAULT_AUTONOMY}) — would be set in ${path}`);
    return;
  }

  // ── SET: validate, merge into grooming preserving other fields, write, report. ──
  const next = coerceAutonomy(opts.level);
  if (resolved.kind === "hub") {
    const hub = await readHubMetadata(resolved.repo);
    if (!hub) throw new Error(`No hub metadata at ${hubMetadataPath(resolved.repo)}.`);
    const grooming: GroomingConfig = { ...hub.grooming, autonomy: next };
    await writeHubMetadata(resolved.repo, { ...hub, grooming });
    logger.success(`autonomy set to ${next} in ${hubMetadataPath(resolved.repo)}; mage never commits; git add it to track`);
  } else {
    const meta = await readMetadata(resolved.repo);
    if (!meta) throw new Error(`No metadata at ${metadataPath(resolved.repo)}.`);
    const grooming: GroomingConfig = { ...meta.grooming, autonomy: next };
    await writeMetadata(resolved.repo, { ...meta, grooming });
    logger.success(`autonomy set to ${next} in ${metadataPath(resolved.repo)}; mage never commits; git add it to track`);
  }
}

/** True iff `grooming.autonomy` is explicitly present on disk (vs. the unset default). */
async function isExplicitlySet(resolved: { root: string; kind: "repo" | "hub"; repo: string }): Promise<boolean> {
  try {
    const meta = resolved.kind === "hub" ? await readHubMetadata(resolved.repo) : await readMetadata(resolved.repo);
    return meta?.grooming?.autonomy !== undefined;
  } catch {
    return false;
  }
}
