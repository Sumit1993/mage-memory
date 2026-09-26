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
//   3. 0.0.x CLEARING (#207). Removes state whose only writer retired (#208): the
//      promote tally, the distill watermark, the nudge throttle. Counts, never deletes,
//      staged drafts (groom Phase 0 still reads them) and retired `work/` files.
//      Re-upserts the hook groups in the KB's own `settings.local.json` at the tier it
//      already has, which repoints the memory hook and adds the PreToolUse observe arm.
//      Refreshes the AGENTS.md block through the no-clobber path (#198).
//
// Every step probes the artifact it touches instead of reading a version stamp: the
// three stores (`.mage/`, `settings.local.json`, `AGENTS.md`) have different owners,
// and one stamp would say "migrated" on a clone whose settings were never touched.
//
// Re-running is a quiet no-op. It never commits. FAIL-SAFE: a layout move that hits a
// pre-existing target or any fs error leaves the OLD artifact untouched — a draft or a
// ledger is never lost to a half-migration.

import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  type AgentsMdOptions,
  type AgentsMdWriteResult,
  keptWarning,
  writeAgentsMd,
} from "../agents-md.js";
import {
  MAGE_ID_PREFIX,
  hasCommandeerHooks,
  isMageGroup,
  readClaudeSettings,
  resolveSettingsTarget,
  upsertMageHooks,
  writeClaudeSettings,
} from "../adapters/claude-code/settings.js";
import { distillWatermarkPath } from "../distill/watermark.js";
import { PROMOTE_FILE } from "../grooming/tally.js";
import { logger } from "../logger.js";
import {
  LEARNINGS_DIR,
  META_DIR,
  META_FILE,
  METADATA_SCHEMA,
  METRICS_DIR,
  type RedactConfig,
  type MageMetadata,
  STAGING_DIR,
  WORK_DIR,
  absolutePath,
  exists,
  hubMetadataPath,
  looksLikeHub,
  metadataPath,
  metricsPath,
  outOfRepoKbTargets,
  ownedDocsRoots,
  readHubMetadata,
  readMetadata,
  stagingPath,
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

/** One retired state file the clearing step looked for (#207). */
export interface ClearedEntry {
  root: string;
  kind: "promote-tally" | "distill-watermark" | "nudge-throttle";
  /** "removed"; "absent" — nothing there; "skipped" — an fs error left it in place. */
  outcome: "removed" | "absent" | "skipped";
}

/** The hook re-upsert in the KB's own `settings.local.json` (#207). */
export interface HooksEntry {
  path: string;
  outcome: "written" | "unchanged" | "not-connected" | "malformed";
  /** Whether `mage:observe:PreToolUse` was already there, was added, or does not apply. */
  observeArm: "present" | "added" | "n/a";
}

export interface MigrateResult {
  migrated: MigrateEntry[];
  alreadyCurrent: string[];
  /** State-fold layout relocations (ADR-0025); empty when nothing needed moving. */
  layoutMoves: LayoutMoveEntry[];
  /** Retired state files, one entry per kind per docs root. */
  cleared: ClearedEntry[];
  /** Pending groom drafts per docs root; counted, never deleted. */
  staged: { root: string; drafts: number }[];
  /** Files under a retired `work/` dir per docs root; counted, never moved. */
  work: { root: string; files: number }[];
  /** Null when no KB root carries a settings file to re-upsert. */
  hooks: HooksEntry | null;
  /** Null when the AGENTS.md block could not be targeted (hub path unknown) or its write failed. */
  agentsMd: AgentsMdWriteResult | null;
  /** Why the AGENTS.md write failed, when it was targeted and threw. */
  agentsMdError?: string;
  /** A hub's registered projects, each of which needs its own `mage migrate`. */
  projectsToVisit: string[];
}

const OBSERVE_PRETOOLUSE_ID = `${MAGE_ID_PREFIX}observe:PreToolUse`;

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
  const clearRoots: string[] = [];
  let settingsRoot: string | null = null;
  let agentsTarget: { root: string; opts: AgentsMdOptions | null } | null = null;
  const projectsToVisit: string[] = [];

  // 1. Nearest code-repo metadata (walk up), if any.
  const codeRepo = await findCodeRepo(start);
  if (codeRepo) {
    const path = metadataPath(codeRepo);
    const meta = await readMetadata(codeRepo); // normalizes v1 → v2 in memory
    if (meta) {
      clearRoots.push(join(codeRepo, META_DIR));
      settingsRoot = codeRepo;
      agentsTarget = { root: codeRepo, opts: repoAgentsOptions(meta, codeRepo) };
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
      const roots = await ownedDocsRoots({ root: start, kind: "hub", repo: start });
      clearRoots.push(...roots);
      settingsRoot ??= start;
      agentsTarget ??= { root: start, opts: { kind: "hub", docsRel: "." } };
      // Commandeer lives in each linked code repo's settings.local.json, which this
      // run cannot reach (#212): name each project so the operator runs it there.
      projectsToVisit.push(...hub.projects.map((p) => p.name).filter(Boolean));
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

  // 3. 0.0.x clearing (#207). Never throws past this point.
  const cleared: ClearedEntry[] = [];
  const staged: MigrateResult["staged"] = [];
  const work: MigrateResult["work"] = [];
  for (const root of clearRoots) {
    await clearRetiredState(root, cleared);
    staged.push({ root, drafts: await countFiles(stagingPath(root), (n) => n.endsWith(".md")) });
    work.push({ root, files: await countFiles(join(root, WORK_DIR), () => true, true) });
  }
  const hooks = settingsRoot ? await reupsertHooks(settingsRoot) : null;
  let agentsMd: AgentsMdWriteResult | null = null;
  let agentsMdError: string | undefined;
  if (agentsTarget?.opts) {
    agentsMd = await writeAgentsMd(agentsTarget.root, agentsTarget.opts).catch((err: unknown) => {
      agentsMdError = err instanceof Error ? err.message : String(err);
      return null;
    });
  }

  return {
    migrated,
    alreadyCurrent,
    layoutMoves,
    cleared,
    staged,
    work,
    hooks,
    agentsMd,
    ...(agentsMdError ? { agentsMdError } : {}),
    projectsToVisit,
  };
}

/**
 * The AGENTS.md template a code repo's metadata selects, or null when a hybrid or
 * external repo's hub path cannot be resolved (the block is then left untouched).
 */
function repoAgentsOptions(meta: MageMetadata, codeRepo: string): AgentsMdOptions | null {
  if (meta.mode === "in-repo") return { kind: "repo", mode: "in-repo", docsRel: META_DIR };
  const target = outOfRepoKbTargets(meta, codeRepo)[0]?.root;
  const hubPath =
    target ?? (meta.mode === "external" ? meta.hub_path : meta.hub_refs[0]?.hub_path) ?? null;
  const project = meta.mode === "external" ? meta.project : meta.hub_refs[0]?.project;
  if (!hubPath || !project) return null;
  return { kind: "repo", mode: meta.mode, docsRel: META_DIR, hubPath, project };
}

/** The retired state files at one docs root and their only (now retired) writers. */
function retiredStateFiles(root: string): { kind: ClearedEntry["kind"]; path: string }[] {
  return [
    // `mage promote` (#208). MEMORY.md's roster falls back to recency without it.
    { kind: "promote-tally", path: join(metricsPath(root), PROMOTE_FILE) },
    // `mage distill` (#208).
    { kind: "distill-watermark", path: distillWatermarkPath(root) },
    // The SessionStart backlog throttle, gone from the nudge since #210.
    { kind: "nudge-throttle", path: join(metricsPath(root), "nudge-throttle.json") },
  ];
}

async function clearRetiredState(root: string, out: ClearedEntry[]): Promise<void> {
  for (const { kind, path } of retiredStateFiles(root)) {
    if (!(await exists(path))) {
      out.push({ root, kind, outcome: "absent" });
      continue;
    }
    try {
      await rm(path);
      out.push({ root, kind, outcome: "removed" });
    } catch {
      out.push({ root, kind, outcome: "skipped" });
    }
  }
}

/** Files under `dir` whose name passes `keep`; 0 for a missing dir. Never throws. */
async function countFiles(
  dir: string,
  keep: (name: string) => boolean,
  recursive = false,
): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true, recursive }).catch(() => []);
  return entries.filter((e) => e.isFile() && keep(e.name)).length;
}

/**
 * Re-upsert mage's hook groups in `root`'s `settings.local.json` at the tier it already
 * has: commandeer present stays present, absent stays absent, and `autoMemoryDirectory`
 * is never touched. A KB that was never connected is left alone, since connect is the
 * one opt-in setup act (ADR-0055). Only ever the local file, never `~/.claude`.
 */
async function reupsertHooks(root: string): Promise<HooksEntry> {
  const { path } = resolveSettingsTarget({ cwd: root });
  const read = await readClaudeSettings(path).catch(() => null);
  if (!read || read.malformed) {
    return { path, outcome: read?.malformed ? "malformed" : "not-connected", observeArm: "n/a" };
  }
  const groups = Object.values(read.settings?.hooks ?? {}).flat();
  if (!read.settings || !groups.some((g) => isMageGroup(g))) {
    return { path, outcome: "not-connected", observeArm: "n/a" };
  }
  const hadArm = (read.settings.hooks?.PreToolUse ?? []).some(
    (g) => g.id === OBSERVE_PRETOOLUSE_ID,
  );
  const { settings } = upsertMageHooks(read.settings, {
    commandeer: hasCommandeerHooks(read.settings),
  });
  const observeArm = hadArm ? "present" : "added";
  if (JSON.stringify(settings) === JSON.stringify(read.settings)) {
    return { path, outcome: "unchanged", observeArm };
  }
  try {
    await writeClaudeSettings(path, settings);
    return { path, outcome: "written", observeArm };
  } catch {
    return { path, outcome: "malformed", observeArm: "n/a" };
  }
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
  const removed = result.cleared.filter((c) => c.outcome === "removed");
  const agents = result.agentsMd?.agents;
  const changed =
    result.migrated.length > 0 ||
    moved.length > 0 ||
    removed.length > 0 ||
    result.hooks?.outcome === "written" ||
    agents === "created" ||
    agents === "written";

  if (!changed) {
    logger.success(`Already current (${METADATA_SCHEMA}, ${STATE_DIR_NOTE}); nothing to migrate.`);
  } else {
    for (const m of result.migrated) {
      logger.success(`Migrated ${m.path} (${m.from} → ${m.to})`);
    }
    for (const m of moved) {
      logger.success(`Moved ${m.kind} under .mage/ at ${m.root}`);
    }
    for (const c of removed) {
      logger.success(`Removed ${c.kind} at ${c.root} (${RETIRED_BY[c.kind]})`);
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
  for (const c of result.cleared.filter((e) => e.outcome === "skipped")) {
    logger.detail(`Skipped ${c.kind} at ${c.root} (fs error — left in place)`);
  }
  for (const { root, drafts } of result.staged.filter((e) => e.drafts > 0)) {
    logger.info(`staging: ${drafts} draft(s) pending at ${root} — run \`mage groom\``);
  }
  for (const { root, files } of result.work.filter((e) => e.files > 0)) {
    logger.warn(
      `work/ is retired (ADR-0050): ${files} file(s) left in place at ${root}; links in notes and decisions are not rewritten`,
    );
  }

  const h = result.hooks;
  if (h?.outcome === "not-connected") {
    logger.detail("hooks: not connected here — run `mage connect`");
  } else if (h?.outcome === "malformed") {
    logger.warn(`hooks: ${h.path} is not valid JSON — left as is`);
  } else if (h) {
    logger.detail(`hooks: ${h.outcome} (${h.path}); observe arm: ${h.observeArm}`);
  }

  if (result.agentsMd) {
    const kept = keptWarning(result.agentsMd);
    if (kept) {
      logger.warn(kept);
      logger.detail(
        "  mage migrate never overwrites it. To take the current block, move any text of your own below <!-- END mage -->, delete the block, and run mage migrate again.",
      );
    } else {
      logger.detail(`AGENTS.md: ${result.agentsMd.agents}`);
    }
  } else if (result.agentsMdError) {
    logger.warn(`AGENTS.md left as is: ${result.agentsMdError}`);
  } else {
    logger.warn("AGENTS.md left as is: hub path unknown — run `mage link`");
  }

  for (const name of result.projectsToVisit) {
    logger.detail(`run \`mage migrate\` in the code repo for ${name}`);
  }

  const commitPaths = committedChanges(result);
  if (commitPaths.length > 0) {
    logger.blank();
    logger.info("Review the diff and commit yourself (mage never commits):");
    logger.detail(`  git add -- ${commitPaths.join(" ")} && git commit -m "chore: migrate mage state"`);
  }
}

const RETIRED_BY: Record<ClearedEntry["kind"], string> = {
  "promote-tally": "its writer retired in #208",
  "distill-watermark": "its writer retired in #208",
  "nudge-throttle": "the nudge dropped it in #210",
};

/** The committed files this run changed and that exist, relative to cwd; the rest is gitignored state. */
function committedChanges(result: MigrateResult): string[] {
  const agents = result.agentsMd;
  const paths = result.migrated.map((m) => m.path);
  if (agents && (agents.agents === "created" || agents.agents === "written")) {
    paths.push(agents.path, join(dirname(agents.path), "CLAUDE.md"));
  }
  return paths.filter((p) => existsSync(p)).map((p) => relative(process.cwd(), p) || p);
}

/** Shown in the "already current" line to name the layout the fold targets. */
const STATE_DIR_NOTE = ".mage/ layout";
