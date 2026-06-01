import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../logger.js";
import {
  PROJECTS_DIR,
  absolutePath,
  exists,
  hubProjectPath,
  looksLikeHub,
  readHubMetadata,
} from "../paths.js";

export interface ListOptions {
  hub?: string;
}

export interface ProjectInfo {
  name: string;
  storage: "hub-owned" | "in-repo" | "unknown";
  path: string;
  codeRepo: string | null;
  fileCount: number;
  /** Last modification time across any file (hub-owned only — in-repo lives elsewhere). */
  lastModified: Date | null;
}

export interface ListResult {
  hub: string;
  projects: ProjectInfo[];
}

/**
 * List the projects this hub knows about. Reads the top-level `metadata.json` registry.
 *
 * `mage status` is the per-machine link-health checker; `list` is just the
 * hub-side enumeration.
 */
export async function list(opts: ListOptions = {}): Promise<ListResult> {
  const hub = absolutePath(opts.hub ?? process.cwd());
  if (!(await looksLikeHub(hub))) {
    throw new Error(`Not a mage: ${hub}`);
  }

  const projects: ProjectInfo[] = [];

  const hubMeta = await readHubMetadata(hub);
  if (hubMeta) {
    // Registry-driven path (v5+ hubs with top-level metadata.json).
    for (const p of hubMeta.projects) {
      const dir = hubProjectPath(hub, p.name);
      const exists_ = p.storage === "hub-owned" ? await exists(dir) : false;
      const { count, lastMs } = p.storage === "hub-owned" && exists_ ? await walk(dir) : { count: 0, lastMs: 0 };
      projects.push({
        name: p.name,
        storage: p.storage,
        path: dir,
        codeRepo: p.code_repo_path,
        fileCount: count,
        lastModified: lastMs > 0 ? new Date(lastMs) : null,
      });
    }
  } else {
    // Legacy hub — walk projects/*/
    const projectsDir = join(hub, PROJECTS_DIR);
    if (await exists(projectsDir)) {
      const entries = await readdir(projectsDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = join(projectsDir, e.name);
        const { count, lastMs } = await walk(dir);
        projects.push({
          name: e.name,
          storage: "unknown",
          path: dir,
          codeRepo: null,
          fileCount: count,
          lastModified: lastMs > 0 ? new Date(lastMs) : null,
        });
      }
    }
  }

  logger.info(`Hub: ${hub}`);
  if (hubMeta) logger.detail(`Registry name: ${hubMeta.name}`);
  logger.detail(`${projects.length} project(s)`);
  logger.blank();

  if (projects.length === 0) {
    logger.detail("(no projects yet — run `mage link <hub-path>` from a code repo to add one)");
    return { hub, projects };
  }

  // Pretty table
  const nameWidth = Math.max(8, ...projects.map((p) => p.name.length));
  const storageWidth = Math.max(9, ...projects.map((p) => p.storage.length));
  const header = `${"PROJECT".padEnd(nameWidth)}  ${"STORAGE".padEnd(storageWidth)}  FILES  LAST MODIFIED`;
  logger.info(header);
  logger.detail("─".repeat(header.length));
  for (const p of projects) {
    const last = p.lastModified ? p.lastModified.toISOString().slice(0, 10) : "—";
    const fileCount = p.storage === "in-repo" ? "—" : String(p.fileCount);
    logger.info(
      `${p.name.padEnd(nameWidth)}  ${p.storage.padEnd(storageWidth)}  ${fileCount.padStart(5)}  ${last}`,
    );
  }

  return { hub, projects };
}

async function walk(dir: string): Promise<{ count: number; lastMs: number }> {
  let count = 0;
  let lastMs = 0;
  async function recurse(d: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".gitkeep") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        await recurse(p);
      } else {
        count++;
        try {
          const s = await stat(p);
          if (s.mtimeMs > lastMs) lastMs = s.mtimeMs;
        } catch {
          /* skip */
        }
      }
    }
  }
  await recurse(dir);
  return { count, lastMs };
}
