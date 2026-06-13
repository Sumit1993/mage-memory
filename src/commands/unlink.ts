import { confirm } from "@inquirer/prompts";
import { rm } from "node:fs/promises";
import { logger } from "../logger.js";
import {
  type MageMetadata,
  absolutePath,
  exists,
  hubMetadataPath,
  hubProjectPath,
  metadataPath,
  readHubMetadata,
  readMetadata,
  writeHubMetadata,
  writeMetadata,
} from "../paths.js";

export interface UnlinkOptions {
  /** Code repo to unlink (default: cwd). */
  codeRepo?: string;
  /** Specific hub to unlink from. If absent: unlink from the primary hub (external mode) or the only hub_ref (in-repo). */
  hub?: string;
  /** For hub-owned slots: also delete the hub-side `projects/<project>/` dir. */
  deleteHubSide?: boolean;
  /** Skip prompts. */
  yes?: boolean;
}

export interface UnlinkResult {
  codeRepo: string;
  hub: string;
  project: string;
  hubSideDeleted: boolean;
}

/**
 * Remove a mage linkage. Updates BOTH the code-repo metadata and the
 * hub-side registry. Never auto-executes git operations — only suggests
 * commits in both repos.
 */
export async function unlink(opts: UnlinkOptions = {}): Promise<UnlinkResult> {
  const codeRepo = absolutePath(opts.codeRepo ?? process.cwd());
  const meta = await readMetadata(codeRepo);
  if (!meta) {
    throw new Error(
      `No mage metadata found at ${metadataPath(codeRepo)}. Nothing to unlink.`,
    );
  }

  const targetHub = await resolveTargetHub(meta, opts);
  if (!targetHub) {
    throw new Error(
      `No hub to unlink. mode=${meta.mode}, hub_refs.length=${meta.hub_refs.length}. ` +
        `To remove mage from this repo entirely, delete ${metadataPath(codeRepo)}.`,
    );
  }

  logger.blank();
  logger.info("Unlinking:");
  logger.detail(`code repo: ${codeRepo}`);
  logger.detail(`hub:       ${targetHub}`);
  logger.detail(`project:   ${meta.project}`);
  logger.blank();

  // 1. Update hub-side registry
  let hubSideDeleted = false;
  if (await exists(targetHub)) {
    const hubMeta = await readHubMetadata(targetHub);
    if (hubMeta) {
      const wasHubOwned =
        hubMeta.projects.find((p) => p.name === meta.project)?.storage === "hub-owned";
      const newProjects = hubMeta.projects.filter((p) => p.name !== meta.project);
      if (newProjects.length < hubMeta.projects.length) {
        await writeHubMetadata(targetHub, { ...hubMeta, projects: newProjects });
        logger.success(`Removed '${meta.project}' from ${hubMetadataPath(targetHub)}`);
      } else {
        logger.warn(`Project '${meta.project}' not found in hub registry. Continuing.`);
      }

      if (wasHubOwned) {
        const projDir = hubProjectPath(targetHub, meta.project);
        if (await exists(projDir)) {
          const shouldDelete =
            opts.deleteHubSide ||
            (!opts.yes &&
              (await confirm({
                message: `Delete hub-owned project dir ${projDir}? (Files inside will be lost.)`,
                default: false,
              })));
          if (shouldDelete) {
            await rm(projDir, { recursive: true, force: true });
            logger.success(`Deleted ${projDir}`);
            hubSideDeleted = true;
          } else {
            logger.detail(`Kept ${projDir} (delete manually if desired)`);
          }
        }
      }
    } else {
      logger.warn(`Hub at ${targetHub} has no metadata.json — skipping hub-side update.`);
    }
  } else {
    logger.warn(`Hub path ${targetHub} does not exist on this machine — skipping hub-side update.`);
  }

  // 2. Update code-repo metadata
  const newMeta = removeHubFromCodeRepoMetadata(meta, targetHub);
  if (newMeta === null) {
    await rm(metadataPath(codeRepo));
    logger.success(`Removed ${metadataPath(codeRepo)} (no remaining hubs)`);
  } else {
    await writeMetadata(codeRepo, newMeta);
    logger.success(`Updated ${metadataPath(codeRepo)}`);
  }

  logger.blank();
  logger.success(`Unlinked '${meta.project}' from hub at ${targetHub}.`);
  logger.blank();
  logger.info("Suggested commits (run yourself):");
  logger.detail(`  git -C ${codeRepo} add mage`);
  logger.detail(`  git -C ${codeRepo} commit -m "chore: unlink from mage at ${targetHub}"`);
  logger.blank();
  logger.detail(
    `  git -C ${targetHub} add metadata.json${hubSideDeleted ? ` projects/${meta.project}` : ""}`,
  );
  logger.detail(`  git -C ${targetHub} commit -m "chore: deregister project '${meta.project}'"`);

  return {
    codeRepo,
    hub: targetHub,
    project: meta.project,
    hubSideDeleted,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function resolveTargetHub(meta: MageMetadata, opts: UnlinkOptions): Promise<string | null> {
  if (opts.hub) return absolutePath(opts.hub);
  if (meta.mode === "external" && meta.hub_path) return meta.hub_path;
  if (meta.hub_refs.length === 1) {
    const ref = meta.hub_refs[0];
    if (ref) return ref.hub_path;
  }
  if (meta.hub_refs.length > 1) {
    throw new Error(
      `Multiple hub_refs present (${meta.hub_refs.length}). Specify which one with --hub <path>.`,
    );
  }
  return null;
}

function removeHubFromCodeRepoMetadata(
  meta: MageMetadata,
  targetHub: string,
): MageMetadata | null {
  // Unlinking the external (hub-owned) link: hub_path/hub_repo clear. If hub_refs
  // remain, the repo keeps hub registrations ⇒ hybrid; else nothing is left to
  // point at, so the metadata is removed (null). schema is stamped by writeMetadata.
  if (meta.mode === "external" && meta.hub_path === targetHub) {
    if (meta.hub_refs.length === 0) return null;
    return { ...meta, mode: "hybrid", hub_path: null, hub_repo: null };
  }
  const newRefs = meta.hub_refs.filter((r) => r.hub_path !== targetHub);
  // A locally-storing KB (in-repo OR hybrid) that loses its last hub_ref becomes a
  // bare in-repo KB. (mode arrives normalized: a v1 hybrid reads back as "hybrid".)
  if (meta.mode !== "external" && newRefs.length === 0) {
    return { ...meta, mode: "in-repo", hub_refs: [] };
  }
  return { ...meta, hub_refs: newRefs };
}
