// Link-integrity checks for `mage doctor` (0.0.9 setup-integrity). A code repo and
// its hub keep TWO cross-references — the code repo's `mage/metadata.json.hub_path`
// (forward) and the hub registry's `projects[].code_repo_path` (back). A move
// breaks one or both SILENTLY: captures then route to a dead path, or hub→repo
// tools (the soak digest, `dream`) can't find the repo. `mage connect` never
// touches these — only `mage link` (or this repair) does.
//
// What `--fix` can safely auto-repair: the hub's stale BACK-reference when run from
// the code repo (the repo knows its own true location). What it can only DETECT: a
// moved HUB (the code repo's hub_path is stale and we don't know the new location)
// or a missing project registration — both need an explicit `mage link <hub>`.

import { dirname, join } from "node:path";
import type { DoctorCheck, DoctorOptions } from "../commands/doctor.js";
import {
  META_DIR,
  META_FILE,
  absolutePath,
  exists,
  looksLikeHub,
  readHubMetadata,
  readMetadata,
  writeHubMetadata,
} from "../paths.js";

const CHECK = "link integrity";

/**
 * Append the link-integrity check. Two shapes, by where doctor runs:
 *  - from a linked EXTERNAL code repo → validate forward (hub reachable + project
 *    registered) and back (hub's code_repo_path matches); `--fix` heals a stale
 *    back-reference.
 *  - from a HUB → flag any project whose code repo has moved/vanished (advisory:
 *    it may simply not be cloned on this machine).
 * In-repo (no hub) and non-KB dirs append nothing.
 */
export async function pushLinkChecks(checks: DoctorCheck[], opts: DoctorOptions): Promise<void> {
  const startDir = absolutePath(opts.cwd ?? process.cwd());

  const codeRepo = await findCodeRepo(startDir);
  if (codeRepo) {
    const meta = await readMetadata(codeRepo).catch(() => null);
    if (meta?.mode === "external") {
      await checkExternalLink(checks, opts, codeRepo, meta.hub_path, meta.project);
    }
    return; // in-repo: no hub link to validate.
  }

  if (await looksLikeHub(startDir)) {
    await checkHubBackrefs(checks, startDir);
  }
}

/** Nearest ancestor of `startDir` carrying a code-repo `mage/metadata.json`. */
async function findCodeRepo(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    if (await exists(join(dir, META_DIR, META_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Validate (and optionally repair) an external code repo's two-way hub link. */
async function checkExternalLink(
  checks: DoctorCheck[],
  opts: DoctorOptions,
  codeRepo: string,
  hubPath: string | null,
  project: string,
): Promise<void> {
  if (!hubPath || !(await looksLikeHub(hubPath))) {
    checks.push({
      name: CHECK,
      ok: false,
      detail: `hub_path ${hubPath ?? "(missing)"} is not a reachable hub (moved?) — re-run \`mage link <hub>\``,
    });
    return;
  }

  const hubMeta = await readHubMetadata(hubPath).catch(() => null);
  const entry = hubMeta?.projects?.find((p) => p.name === project);
  if (!hubMeta || !entry) {
    checks.push({
      name: CHECK,
      ok: false,
      detail: `project '${project}' is not registered in hub ${hubPath} — re-run \`mage link\``,
    });
    return;
  }

  if (entry.code_repo_path === codeRepo) {
    checks.push({ name: CHECK, ok: true, detail: `external link to '${hubMeta.name}' (project '${project}') consistent` });
    return;
  }

  // Stale BACK-reference: this repo moved. We know the truth (codeRepo), so heal it.
  if (opts.fix) {
    const repaired = {
      ...hubMeta,
      projects: hubMeta.projects.map((p) => (p.name === project ? { ...p, code_repo_path: codeRepo } : p)),
    };
    await writeHubMetadata(hubPath, repaired);
    checks.push({
      name: CHECK,
      ok: true,
      detail: `repaired hub back-reference for '${project}': ${entry.code_repo_path} -> ${codeRepo}`,
    });
    return;
  }

  checks.push({
    name: CHECK,
    ok: false,
    detail:
      `hub back-reference for '${project}' is stale (records ${entry.code_repo_path}, repo is ${codeRepo}) — ` +
      "run `mage doctor --fix`",
  });
}

/** From a hub: flag any registered project whose code repo has moved/vanished. */
async function checkHubBackrefs(checks: DoctorCheck[], hub: string): Promise<void> {
  const hubMeta = await readHubMetadata(hub).catch(() => null);
  const projects = hubMeta?.projects ?? [];
  if (projects.length === 0) return;

  const missing: string[] = [];
  for (const p of projects) {
    if (!p.code_repo_path || !(await exists(p.code_repo_path))) {
      missing.push(`${p.name} (${p.code_repo_path || "unset"})`);
    }
  }

  if (missing.length === 0) {
    checks.push({ name: CHECK, ok: true, detail: `${projects.length} project code repo(s) present` });
    return;
  }

  checks.push({
    name: CHECK,
    ok: false,
    // Advisory: a code repo may simply not be cloned on this machine.
    optional: true,
    detail:
      `project code repo(s) missing/moved: ${missing.join(", ")} — ` +
      "re-run `mage link` from the moved repo (or `mage doctor --fix` there)",
  });
}
