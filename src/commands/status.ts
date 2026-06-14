import { logger } from "../logger.js";
import {
  METADATA_SCHEMA,
  absolutePath,
  codeRepoDocsRoot,
  exists,
  hubProjectDocsRoot,
  looksLikeHub,
  readHubMetadata,
  readMetadata,
} from "../paths.js";

export interface StatusOptions {
  /** Code repos to check. Required (status doesn't auto-discover). */
  codeRepos: string[];
}

export interface RepoStatus {
  codeRepo: string;
  metadata: { ok: boolean; detail?: string };
  docsRoot: { ok: boolean; detail?: string };
  hubReachable: { ok: boolean; detail?: string };
  schemaCurrent: { ok: boolean; detail?: string };
  overall: "ok" | "warning" | "error";
}

export interface StatusResult {
  passed: boolean;
  repos: RepoStatus[];
}

/**
 * Per-machine health check for each linked code repo. Checks metadata
 * presence + parse, docs-root reachability (depends on mode), hub reachability
 * (external mode), and schema version.
 */
export async function status(opts: StatusOptions): Promise<StatusResult> {
  const result: StatusResult = { passed: true, repos: [] };

  // Hub-aware (Decision 11B): an argument that is a HUB expands to its registered
  // project code repos, so `mage status <hub>` rolls up the whole fleet's liveness
  // instead of (wrongly) treating the hub root as a code repo.
  const repos = await expandHubs(opts.codeRepos);

  for (const repoInput of repos) {
    const repo = absolutePath(repoInput);
    const rs = await statusOne(repo);
    result.repos.push(rs);
    if (rs.overall === "error") result.passed = false;
  }

  for (const r of result.repos) {
    logger.blank();
    logger.info(r.codeRepo);
    renderCheck("metadata", r.metadata);
    renderCheck("docs root", r.docsRoot);
    renderCheck("hub reachable", r.hubReachable);
    renderCheck("schema current", r.schemaCurrent);
    const overallSym = r.overall === "ok" ? "✓" : r.overall === "warning" ? "⚠" : "✗";
    logger.detail(`  → overall: ${overallSym} ${r.overall}`);
  }

  logger.blank();
  if (result.passed) logger.success("All repos OK.");
  else logger.error("Some repos have issues.");
  return result;
}

/**
 * Expand any hub argument to its registered project code repos (Decision 11B). A
 * non-hub argument passes through unchanged. A hub with no projects (or unreadable
 * metadata) contributes nothing but a warning — `status` then has nothing to check
 * for it, which is the honest signal. Order is preserved; non-hub args first-class.
 */
async function expandHubs(inputs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const input of inputs) {
    const abs = absolutePath(input);
    if (!(await looksLikeHub(abs))) {
      out.push(abs);
      continue;
    }
    const meta = await readHubMetadata(abs).catch(() => null);
    const projects = meta?.projects ?? [];
    if (projects.length === 0) {
      logger.warn(`Hub ${abs} has no registered projects — nothing to check.`);
      continue;
    }
    logger.info(`Hub ${abs}: checking ${projects.length} registered project(s).`);
    for (const p of projects) {
      if (p.code_repo_path) out.push(p.code_repo_path);
    }
  }
  return out;
}

async function statusOne(repo: string): Promise<RepoStatus> {
  const rs: RepoStatus = {
    codeRepo: repo,
    metadata: { ok: false },
    docsRoot: { ok: false },
    hubReachable: { ok: false },
    schemaCurrent: { ok: false },
    overall: "error",
  };

  // 1. Metadata
  let meta: Awaited<ReturnType<typeof readMetadata>>;
  try {
    meta = await readMetadata(repo);
  } catch (err) {
    rs.metadata = { ok: false, detail: (err as Error).message };
    return rs;
  }
  if (!meta) {
    rs.metadata = { ok: false, detail: "missing mage/metadata.json" };
    return rs;
  }
  rs.metadata = {
    ok: true,
    detail: `mode=${meta.mode}, project=${meta.project}${meta.hub_refs.length > 0 ? `, hub_refs=${meta.hub_refs.length}` : ""}`,
  };

  // 2. Docs root reachability
  if (meta.mode === "in-repo" || meta.mode === "hybrid") {
    const dr = codeRepoDocsRoot(repo);
    if (await exists(dr)) rs.docsRoot = { ok: true, detail: `repo KB (${meta.mode}) at ${dr}` };
    else rs.docsRoot = { ok: false, detail: `expected ${dr} but missing` };
  } else if (meta.mode === "external") {
    if (!meta.hub_path) {
      rs.docsRoot = { ok: false, detail: "mode=external but hub_path is null" };
    } else {
      const dr = hubProjectDocsRoot(meta.hub_path, meta.project);
      if (await exists(dr)) rs.docsRoot = { ok: true, detail: `hub-owned at ${dr}` };
      else rs.docsRoot = { ok: false, detail: `expected ${dr} but missing` };
    }
  }

  // 3. Hub reachability (external mode AND/OR each hub_ref)
  const hubsToCheck: { path: string; label: string }[] = [];
  if (meta.mode === "external" && meta.hub_path) {
    hubsToCheck.push({ path: meta.hub_path, label: "primary" });
  }
  for (const ref of meta.hub_refs) {
    hubsToCheck.push({ path: ref.hub_path, label: `hub_ref:${ref.project}` });
  }
  if (hubsToCheck.length === 0) {
    rs.hubReachable = { ok: true, detail: `(no hubs — ${meta.mode})` };
  } else {
    const missing: string[] = [];
    for (const h of hubsToCheck) {
      if (!(await exists(h.path))) missing.push(`${h.label}=${h.path}`);
    }
    if (missing.length === 0) {
      rs.hubReachable = {
        ok: true,
        detail: hubsToCheck.map((h) => `${h.label}=${h.path}`).join(", "),
      };
    } else {
      rs.hubReachable = { ok: false, detail: `missing on this machine: ${missing.join(", ")}` };
    }
  }

  // 4. Schema current
  if (meta.schema === METADATA_SCHEMA) {
    rs.schemaCurrent = { ok: true, detail: meta.schema };
  } else {
    rs.schemaCurrent = {
      ok: false,
      detail: `schema is ${meta.schema}; current is ${METADATA_SCHEMA}`,
    };
  }

  // Overall
  if (rs.metadata.ok && rs.docsRoot.ok && rs.hubReachable.ok) {
    rs.overall = rs.schemaCurrent.ok ? "ok" : "warning";
  } else {
    rs.overall = "error";
  }
  return rs;
}

function renderCheck(label: string, check: { ok: boolean; detail?: string }): void {
  const sym = check.ok ? "✓" : "✗";
  const padded = `${label}:`.padEnd(18);
  logger.detail(`  ${sym} ${padded} ${check.detail ?? ""}`);
}
