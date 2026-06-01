import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../logger.js";
import {
  ARCHIVE_DIR,
  type HubMetadata,
  IDENTITY_FILE,
  INDEX_FILE,
  type MageMetadata,
  NOTES_DIR,
  PROJECTS_DIR,
  absolutePath,
  exists,
  hubProjectDocsRoot,
  looksLikeHub,
  readHubMetadata,
  readMetadata,
} from "../paths.js";

export interface VerifyOptions {
  hub?: string;
  codeRepos?: string[];
}

export interface VerifyResult {
  passed: boolean;
  hubChecks: { name: string; ok: boolean; detail?: string }[];
  projectChecks: { project: string; ok: boolean; detail?: string }[];
  linkedRepoChecks: { repo: string; ok: boolean; detail?: string }[];
}

export async function verify(opts: VerifyOptions = {}): Promise<VerifyResult> {
  const hub = absolutePath(opts.hub ?? process.cwd());
  const result: VerifyResult = {
    passed: true,
    hubChecks: [],
    projectChecks: [],
    linkedRepoChecks: [],
  };

  // Pivot: if the path is a code repo (not a hub), redirect to repo-side checks.
  const repoMeta = await readMetadata(hub);
  if (repoMeta && !(await looksLikeHub(hub))) {
    return verifyCodeRepoOnly(hub, repoMeta, opts.codeRepos ?? [], result);
  }

  logger.info("=== Hub structure ===");
  for (const d of [PROJECTS_DIR, NOTES_DIR, ARCHIVE_DIR]) {
    const ok = await exists(join(hub, d));
    result.hubChecks.push({ name: `${d}/`, ok });
    if (ok) logger.success(`${d}/ exists`);
    else {
      logger.error(`${d}/ MISSING`);
      result.passed = false;
    }
  }

  for (const f of [INDEX_FILE, IDENTITY_FILE]) {
    const ok = await exists(join(hub, f));
    result.hubChecks.push({ name: f, ok });
    if (ok) logger.success(`${f} exists`);
    else {
      logger.warn(`${f} missing (recommended but not required)`);
    }
  }

  // Hub-level metadata.json registry.
  const hubMeta = await readHubMetadata(hub);
  if (hubMeta) {
    result.hubChecks.push({
      name: "metadata.json",
      ok: true,
      detail: `${hubMeta.projects.length} project(s) registered`,
    });
    logger.success(`metadata.json (${hubMeta.projects.length} project(s) registered)`);
  } else {
    result.hubChecks.push({
      name: "metadata.json",
      ok: false,
      detail: "missing registry",
    });
    logger.warn("metadata.json MISSING at hub root (run `mage link` from a code repo to bootstrap it)");
  }

  // Zone.Identifier check (Windows file-system metadata leaked into Linux)
  const zoneFiles = await findZoneIdentifierFiles(hub);
  if (zoneFiles === 0) {
    logger.success("no Zone.Identifier files");
    result.hubChecks.push({ name: "no Zone.Identifier files", ok: true });
  } else {
    logger.error(`found ${zoneFiles} Zone.Identifier file(s)`);
    result.hubChecks.push({
      name: "no Zone.Identifier files",
      ok: false,
      detail: `${zoneFiles} found`,
    });
    result.passed = false;
  }

  if (!(await looksLikeHub(hub))) {
    logger.warn("Not a hub directory — skipping project + linked-repo checks.");
    result.passed = false;
    return result;
  }

  // Projects: cross-reference hub registry with on-disk projects/ dirs
  logger.blank();
  logger.info("=== Projects ===");
  if (hubMeta) {
    await verifyProjectsAgainstRegistry(hub, hubMeta, result);
  } else {
    await verifyProjectsByWalking(hub, result);
  }

  // Linked code repos
  if (opts.codeRepos && opts.codeRepos.length > 0) {
    logger.blank();
    logger.info("=== Linked code repos ===");
    for (const repoInput of opts.codeRepos) {
      const repo = absolutePath(repoInput);
      const check = await verifyCodeRepo(repo, hub, hubMeta);
      result.linkedRepoChecks.push(check);
      if (check.ok) logger.success(check.detail ?? repo);
      else {
        logger.error(`${repo}: ${check.detail}`);
        result.passed = false;
      }
    }
  }

  logger.blank();
  if (result.passed) logger.success("All checks passed.");
  else logger.error("Some checks failed.");

  return result;
}

async function verifyCodeRepoOnly(
  repo: string,
  meta: MageMetadata,
  extraRepos: string[],
  result: VerifyResult,
): Promise<VerifyResult> {
  logger.info("=== Code repo (not a hub) ===");
  logger.detail(`${repo} has mage/metadata.json with mode=${meta.mode}.`);
  if (meta.mode === "external") {
    logger.detail(
      `Tip: this is an external-mode code repo. To verify the hub it links to, run \`mage verify --hub ${meta.hub_path}\`.`,
    );
  } else {
    logger.detail("`mage verify --hub` expects a hub root; pivoting to repo-side checks.");
    logger.detail("Tip: `mage status <repo...>` is the canonical per-machine check for code repos.");
  }
  logger.blank();

  for (const path of [repo, ...extraRepos.map(absolutePath)]) {
    const m = path === repo ? meta : await readMetadata(path);
    if (!m) {
      result.linkedRepoChecks.push({ repo: path, ok: false, detail: "missing mage/metadata.json" });
      logger.error(`${path}: missing mage/metadata.json`);
      result.passed = false;
      continue;
    }
    const detail =
      m.mode === "external"
        ? `${path}: mode=external → hub at ${m.hub_path} (project=${m.project})`
        : `${path}: mode=in-repo (project=${m.project})${m.hub_refs.length > 0 ? `, ${m.hub_refs.length} hub_refs` : ""}`;
    result.linkedRepoChecks.push({ repo: path, ok: true, detail });
    logger.success(detail);
  }

  logger.blank();
  if (result.passed) logger.success("Code repo metadata is consistent.");
  else logger.error("Some checks failed.");
  return result;
}

async function verifyProjectsAgainstRegistry(
  hub: string,
  hubMeta: HubMetadata,
  result: VerifyResult,
): Promise<void> {
  for (const p of hubMeta.projects) {
    if (p.storage === "hub-owned") {
      const docsRoot = hubProjectDocsRoot(hub, p.name);
      if (await exists(docsRoot)) {
        result.projectChecks.push({ project: p.name, ok: true, detail: "hub-owned, dir exists" });
        logger.success(`${p.name}  (hub-owned)`);
      } else {
        result.projectChecks.push({
          project: p.name,
          ok: false,
          detail: `hub-owned but ${docsRoot} missing`,
        });
        logger.error(`${p.name}  (hub-owned) — ${docsRoot} MISSING`);
        result.passed = false;
      }
    } else {
      // in-repo storage — notes aren't here; metadata says they're at code_repo_path.
      const codeRepoExists = await exists(p.code_repo_path);
      const state = codeRepoExists ? "code repo reachable" : "code repo path missing on this machine";
      result.projectChecks.push({
        project: p.name,
        ok: codeRepoExists,
        detail: `in-repo at ${p.code_repo_path} — ${state}`,
      });
      if (codeRepoExists) {
        logger.success(`${p.name}  (in-repo at ${p.code_repo_path})`);
      } else {
        logger.warn(`${p.name}  (in-repo at ${p.code_repo_path}) — path not reachable here`);
      }
    }
  }
}

async function verifyProjectsByWalking(hub: string, result: VerifyResult): Promise<void> {
  // Registry-less hub fallback: walk projects/* and count files.
  const projectsDir = join(hub, PROJECTS_DIR);
  if (!(await exists(projectsDir))) return;
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 0) {
    logger.detail("(no projects yet — run `mage link` to add some)");
    return;
  }
  for (const d of dirs) {
    const count = await countFiles(join(projectsDir, d.name));
    result.projectChecks.push({ project: d.name, ok: count > 0 });
    if (count > 0) logger.success(`${d.name}  (${count} file(s))`);
    else logger.warn(`${d.name}  empty`);
  }
}

async function verifyCodeRepo(
  repo: string,
  hub: string,
  hubMeta: HubMetadata | null,
): Promise<{ repo: string; ok: boolean; detail?: string }> {
  const meta = await readMetadata(repo);
  if (!meta) {
    return { repo, ok: false, detail: "missing mage/metadata.json" };
  }
  // Cross-check: is this repo registered in the hub's metadata?
  if (hubMeta) {
    const inRegistry = hubMeta.projects.find((p) => p.name === meta.project);
    if (!inRegistry) {
      return {
        repo,
        ok: false,
        detail: `code-repo says project='${meta.project}' but not found in hub registry`,
      };
    }
  }
  return checkCodeRepoMode(repo, meta, hub);
}

function checkCodeRepoMode(
  repo: string,
  meta: MageMetadata,
  hub: string,
): { repo: string; ok: boolean; detail?: string } {
  if (meta.mode === "external") {
    if (meta.hub_path !== hub) {
      return {
        repo,
        ok: false,
        detail: `mode=external but hub_path=${meta.hub_path} ≠ verifying hub ${hub}`,
      };
    }
    return { repo, ok: true, detail: `${repo} → external hub @ ${hub} (project=${meta.project})` };
  }
  // in-repo (possibly with hub_refs)
  const linkedHere = meta.hub_refs.some((r) => r.hub_path === hub);
  if (!linkedHere && meta.hub_refs.length > 0) {
    return {
      repo,
      ok: true,
      detail: `${repo}: in-repo mode, ${meta.hub_refs.length} hub_refs (none point at ${hub})`,
    };
  }
  return { repo, ok: true, detail: `${repo}: in-repo mode (project=${meta.project})` };
}

async function findZoneIdentifierFiles(root: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.name.includes("Zone.Identifier")) {
        count++;
      }
    }
  }
  await walk(root);
  return count;
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  async function walk(d: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".gitkeep") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else count++;
    }
  }
  await walk(dir);
  return count;
}
