// `mage migrate` — upgrade a KB to the current shape (Dec 9 / 0.0.10; +ADR-0025).
//
// Two upgrades, both durable-on-disk and idempotent:
//   1. METADATA SCHEMA. The readers (`readMetadata`/`readHubMetadata`) already accept
//      BOTH schema v1 and v2 and normalize a v1 file to the v2 shape IN MEMORY (mode
//      in-repo+hub_refs ⇒ "hybrid"; hub storage "in-repo" ⇒ "repo-owned"), so nothing
//      is ever broken by an un-migrated file. `mage migrate` makes the upgrade durable:
//      it reads the metadata at (or above) cwd and writes it back through the
//      schema-stamping write helpers.
//   2. STATE-FOLD LAYOUT (ADR-0025). Relocate the pre-fold transient dirs
//      (`.learnings`/`.metrics`/`.staging`) under the single `.mage/` home, and fold a
//      leftover `.redactignore` file into `metadata.redact`. Visits every docs root the
//      KB owns — a code repo's `mage/`, a hub root, and each hub `projects/<name>/`.
//
// Re-running is a quiet no-op. It never commits. FAIL-SAFE: a layout move that hits a
// pre-existing target or any fs error leaves the OLD artifact untouched — a draft or a
// ledger is never lost to a half-migration.

import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "../logger.js";
import {
  LEARNINGS_DIR,
  META_DIR,
  META_FILE,
  METADATA_SCHEMA,
  METRICS_DIR,
  type RedactConfig,
  STAGING_DIR,
  absolutePath,
  exists,
  hubMetadataPath,
  hubProjectDocsRoot,
  looksLikeHub,
  metadataPath,
  readHubMetadata,
  readMetadata,
  stateDir,
  writeHubMetadata,
  writeMetadata,
} from "../paths.js";
import { readRedactIgnoreFile } from "../redactignore.js";

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

/** One state-fold layout move that happened (or was skipped fail-safe). */
export interface LayoutMoveEntry {
  /** Absolute path of the docs root the move occurred at. */
  root: string;
  /** What moved: a relocated dir leaf, or the folded `.redactignore` file. */
  kind: "learnings" | "metrics" | "staging" | "redactignore";
  /**
   * "moved" — the source was relocated/folded; "skipped" — a target already existed
   * or an fs error blocked the move, so the OLD artifact was left in place (fail-safe).
   */
  outcome: "moved" | "skipped";
}

export interface MigrateResult {
  migrated: MigrateEntry[];
  alreadyCurrent: string[];
  /** State-fold layout relocations (ADR-0025); empty when nothing needed moving. */
  layoutMoves: LayoutMoveEntry[];
}

/**
 * The pre-fold dot-dir for each `.mage/` leaf — what the layout migration relocates.
 * Exported as the SINGLE source of the pre-fold dir names: `doctor`'s layout-drift
 * probe derives its `OLD_LAYOUT_DIRS` from the `.from` entries here, so the mover and
 * the probe can never name different sets (`.redactignore` is handled out-of-band on
 * both sides — it is a fold-into-metadata, not a dir relocation).
 */
export const LAYOUT_LEAVES: { from: string; leaf: string; kind: LayoutMoveEntry["kind"] }[] = [
  { from: ".learnings", leaf: LEARNINGS_DIR, kind: "learnings" },
  { from: ".metrics", leaf: METRICS_DIR, kind: "metrics" },
  { from: ".staging", leaf: STAGING_DIR, kind: "staging" },
];

/**
 * Migrate the KB resolved from `dir`:
 *  - a code repo — the nearest ancestor with `mage/metadata.json` (walks up) → its own
 *    metadata + its `mage/` docs root;
 *  - a hub — `dir` itself when it `looksLikeHub` (no walk-up) → its top-level
 *    `metadata.json` + the hub root and every `projects/<name>/` docs root.
 * Each metadata file is rewritten through the schema-stamping write helper iff its
 * on-disk schema is not already current; each docs root has its pre-fold transient
 * dirs relocated under `.mage/` and any leftover `.redactignore` folded into metadata
 * (ADR-0025). Throws only when no KB is found.
 */
export async function mageMigrate(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const start = absolutePath(opts.dir ?? process.cwd());
  const migrated: MigrateEntry[] = [];
  const alreadyCurrent: string[] = [];
  const layoutMoves: LayoutMoveEntry[] = [];

  // 1. Nearest code-repo metadata (walk up), if any.
  const codeRepo = await findCodeRepo(start);
  if (codeRepo) {
    const path = metadataPath(codeRepo);
    const meta = await readMetadata(codeRepo); // normalizes v1 → v2 in memory
    if (meta) {
      // State fold first: relocate dirs + PARSE any leftover `.redactignore` into the
      // in-memory metadata, so the single schema-stamping write below also persists the
      // merged `redact` field (one write, never a stale schema). The source file is
      // parsed-but-not-deleted here and removed only AFTER the metadata write resolves
      // (parse-then-write-then-delete) so a failed write can never lose the allowlist.
      const docsRoot = join(codeRepo, META_DIR);
      const fold = await parseRedactIgnore(docsRoot);
      const merged = mergeRedact(meta.redact, fold?.config);
      const next = merged === meta.redact ? meta : { ...meta, redact: merged };
      await migrateLayoutDirs(docsRoot, layoutMoves);

      if (next.schema === METADATA_SCHEMA && next === meta) {
        alreadyCurrent.push(path);
      } else {
        await writeMetadata(codeRepo, next);
        if (next.schema !== METADATA_SCHEMA) {
          migrated.push({ path, from: next.schema, to: METADATA_SCHEMA });
        }
      }
      // Metadata is durably written (or already current) — now it is safe to drop the
      // source file. A delete failure leaves a harmless, idempotently re-foldable file.
      if (fold) await deleteFoldedRedactIgnore(docsRoot, fold.filePath, layoutMoves);
    }
  }

  // 2. A hub at the start dir, if any (a repo is never also a hub).
  if (await looksLikeHub(start)) {
    const path = hubMetadataPath(start);
    const hub = await readHubMetadata(start);
    if (hub) {
      // The hub owns its root docs AND each `projects/<name>/`. Relocate dirs at every
      // one; PARSE any `.redactignore` found at any of them into the hub's single
      // metadata (project docs roots carry no metadata.json of their own). Each source
      // file is parsed-but-not-deleted and removed only AFTER the hub write resolves —
      // this bounds loss to zero across all N projects even if the hub write fails.
      const roots = [start, ...hubProjectRoots(start, hub.projects)];
      const folds: ParsedRedactIgnore[] = [];
      let folded: RedactConfig | undefined;
      for (const root of roots) {
        const fold = await parseRedactIgnore(root);
        if (fold) {
          folds.push(fold);
          folded = mergeRedact(folded, fold.config);
        }
        await migrateLayoutDirs(root, layoutMoves);
      }
      const merged = mergeRedact(hub.redact, folded);
      const next = merged === hub.redact ? hub : { ...hub, redact: merged };

      if (next.schema === METADATA_SCHEMA && next === hub) {
        alreadyCurrent.push(path);
      } else {
        await writeHubMetadata(start, next);
        if (next.schema !== METADATA_SCHEMA) {
          migrated.push({ path, from: next.schema, to: METADATA_SCHEMA });
        }
      }
      // The hub metadata is durably written (or already current) — only now drop each
      // remembered source file. A per-file delete failure leaves a harmless, idempotently
      // re-foldable file; loss across the N projects is bounded to zero.
      for (const fold of folds) {
        await deleteFoldedRedactIgnore(dirname(fold.filePath), fold.filePath, layoutMoves);
      }
    }
  }

  if (migrated.length === 0 && alreadyCurrent.length === 0 && layoutMoves.length === 0) {
    throw new Error(`No mage knowledge base found at or above ${start}. Nothing to migrate.`);
  }
  return { migrated, alreadyCurrent, layoutMoves };
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

/** Every hub-owned project's flat docs root (`<hub>/projects/<name>/`). */
function hubProjectRoots(hub: string, projects: { name: string }[]): string[] {
  const roots: string[] = [];
  for (const p of projects) {
    if (!p.name) continue;
    try {
      roots.push(hubProjectDocsRoot(hub, p.name));
    } catch {
      // assertSafeName rejected a hostile project name — skip it, never throw.
    }
  }
  return roots;
}

/**
 * Relocate the pre-fold transient dirs at `docsRoot` under `.mage/` (ADR-0025):
 * `.learnings`→`.mage/learnings`, `.metrics`→`.mage/metrics`, `.staging`→`.mage/staging`.
 * A MOVE (`fs.rename`), never a delete-then-recreate. IDEMPOTENT — a source that is
 * absent is skipped silently, so a re-run is a no-op. FAIL-SAFE — if the `.mage/<leaf>`
 * target already exists (a partial prior run) OR any fs error occurs, the source is
 * LEFT in place and the skip is recorded; a draft/ledger is never overwritten or lost.
 */
async function migrateLayoutDirs(docsRoot: string, moves: LayoutMoveEntry[]): Promise<void> {
  for (const { from, leaf, kind } of LAYOUT_LEAVES) {
    const src = join(docsRoot, from);
    if (!(await exists(src))) continue; // idempotent: nothing to move.
    const dest = join(stateDir(docsRoot), leaf);
    if (await exists(dest)) {
      // Target already present (partial prior run / manual move) — do NOT merge-destroy.
      moves.push({ root: docsRoot, kind, outcome: "skipped" });
      continue;
    }
    try {
      await mkdir(stateDir(docsRoot), { recursive: true });
      await rename(src, dest);
      moves.push({ root: docsRoot, kind, outcome: "moved" });
    } catch {
      // Any fs error (rename across devices, permissions, race) — leave the old dir
      // untouched. A failed move must never lose the source.
      moves.push({ root: docsRoot, kind, outcome: "skipped" });
    }
  }
}

/** A parsed-but-not-yet-deleted `.redactignore`: its config + the source file path. */
interface ParsedRedactIgnore {
  config: RedactConfig;
  /** Absolute path of the source `.redactignore` file (deleted only AFTER the write). */
  filePath: string;
}

/**
 * PARSE ONLY a leftover `<docsRoot>/.redactignore` into a {@link RedactConfig},
 * remembering the source file path — it does NOT delete the file. The caller merges
 * the config into metadata, DURABLY WRITES the metadata, and only THEN deletes the
 * source (see {@link deleteFoldedRedactIgnore}). Returns undefined when no file is
 * present; never throws (ADR-0025: the allowlist must be sealed in metadata before the
 * file is dropped, so a failed write can never lose it).
 */
async function parseRedactIgnore(docsRoot: string): Promise<ParsedRedactIgnore | undefined> {
  const config = await readRedactIgnoreFile(docsRoot).catch(() => null);
  if (!config) return undefined;
  return { config, filePath: join(docsRoot, ".redactignore") };
}

/**
 * Delete a `.redactignore` source AFTER its allowlist is durably folded into metadata,
 * recording the outcome. FAIL-SAFE — on a delete error the file is LEFT in place and
 * recorded as "skipped": a leftover file is harmless (re-parsing the same allowlist
 * re-merges to the same set, so the next run is idempotent), whereas deleting before
 * the write could lose the only copy. Never throws.
 */
async function deleteFoldedRedactIgnore(
  docsRoot: string,
  filePath: string,
  moves: LayoutMoveEntry[],
): Promise<void> {
  try {
    await rm(filePath);
    moves.push({ root: docsRoot, kind: "redactignore", outcome: "moved" });
  } catch {
    // The allowlist is already safe in metadata; a leftover file just re-folds to the
    // same set next run. Record the skip, never throw.
    moves.push({ root: docsRoot, kind: "redactignore", outcome: "skipped" });
  }
}

/**
 * Union two redact allowlists, deduping `ignore` globs and `allow` literals. Returns
 * `base` UNCHANGED (same reference) when `add` contributes nothing — lets the caller
 * detect "no change" by identity and skip a needless metadata rewrite. Order-stable:
 * base entries first, then new ones.
 */
function mergeRedact(base?: RedactConfig, add?: RedactConfig): RedactConfig | undefined {
  if (!add) return base;
  const ignore = dedupe(base?.ignore, add.ignore);
  const allow = dedupe(base?.allow, add.allow);
  if (ignore === undefined && allow === undefined) return base;
  const merged: RedactConfig = {};
  if (ignore) merged.ignore = ignore;
  if (allow) merged.allow = allow;
  return merged;
}

/**
 * Union two string lists (base then add), deduped + order-stable. Returns undefined
 * when the result is empty (so an absent field stays absent, not `[]`). Always a fresh
 * array when non-empty (never aliases `base`), so callers can treat it as owned.
 */
function dedupe(base?: string[], add?: string[]): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(base ?? []), ...(add ?? [])]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Print a human summary of a migration run. */
export function reportMigrate(result: MigrateResult): void {
  const moved = result.layoutMoves.filter((m) => m.outcome === "moved");
  const skipped = result.layoutMoves.filter((m) => m.outcome === "skipped");

  if (result.migrated.length === 0 && moved.length === 0) {
    logger.success(`Already current (${METADATA_SCHEMA}, ${STATE_DIR_NOTE}); nothing to migrate.`);
  } else {
    for (const m of result.migrated) {
      logger.success(`Migrated ${m.path} (${m.from} → ${m.to})`);
    }
    for (const m of moved) {
      logger.success(`Moved ${m.kind} under .mage/ at ${m.root}`);
    }
    for (const p of result.alreadyCurrent) {
      logger.detail(`Already current: ${p}`);
    }
  }

  for (const s of skipped) {
    logger.detail(
      `Skipped ${s.kind} at ${s.root} (target exists or fs error — old artifact left in place)`,
    );
  }

  if (result.migrated.length > 0 || moved.length > 0) {
    logger.blank();
    logger.info("Review the diff and commit yourself (mage never commits):");
    logger.detail(
      '  git add metadata.json mage/metadata.json 2>/dev/null; git commit -m "chore: migrate mage state to .mage/ + metadata.redact"',
    );
  }
}

/** Shown in the "already current" line to name the layout the fold targets. */
const STATE_DIR_NOTE = ".mage/ layout";
