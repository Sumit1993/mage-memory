import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { writeAgentsMd } from "../agents-md.js";
import { getRemoteOriginUrl } from "../git.js";
import { logger } from "../logger.js";
import { connect, type ConnectResult } from "./connect.js";
import {
  type MageMetadata,
  type HubMetadata,
  type HubProject,
  METADATA_SCHEMA,
  absolutePath,
  codeRepoDocsRoot,
  exists,
  hubMetadataPath,
  hubProjectDocsRoot,
  looksLikeHub,
  metadataPath,
  readHubMetadata,
  readMetadata,
  writeHubMetadata,
  writeMetadata,
} from "../paths.js";
export type Storage = "hub-owned" | "repo-owned";

export interface LinkOptions {
  /** Code repo to link (default: cwd). */
  codeRepo?: string;
  /** Project name (default: basename(code-repo)). */
  project?: string;
  /** Override auto-detected storage. */
  storage?: Storage;
  /** Skip prompts. */
  yes?: boolean;
  /** Wire capture hooks after link (Decision 5). Default true; `--no-connect` sets false. */
  connect?: boolean;
}

export interface LinkResult {
  codeRepo: string;
  hub: string;
  project: string;
  storage: Storage;
  hubMetadataAction: "created" | "updated" | "appended-project";
  /** What `connect` wired, when auto-connect ran (Decision 5); absent if skipped. */
  connectResult?: ConnectResult;
}

/**
 * Link a code repo to an existing hub.
 *
 * Auto-detection of storage based on whether the code repo has populated
 * `mage/`:
 *   - empty/absent  → storage="hub-owned" (scenario 2): code repo has no local docs;
 *                     the hub owns them. We create the empty stub at
 *                     `<hub>/projects/<project>/mage/`.
 *   - has content   → storage="repo-owned" (scenario 4 / hybrid): code repo already has
 *                     local docs; the hub just registers awareness via metadata.
 *                     No `<hub>/projects/<project>/` directory is created.
 *
 * Either way, both metadata.json files are updated and the user is given
 * explicit commit suggestions for both repos.
 */
export async function link(hubPathInput: string, opts: LinkOptions = {}): Promise<LinkResult> {
  const hub = absolutePath(hubPathInput);
  const codeRepo = absolutePath(opts.codeRepo ?? process.cwd());
  const project = opts.project ?? basename(codeRepo);

  // ─── preflight ─────────────────────────────────────────────────────────
  if (!(await exists(codeRepo))) {
    throw new Error(`Code repo path does not exist: ${codeRepo}`);
  }
  if (!(await exists(hub))) {
    throw new Error(`Hub path does not exist: ${hub}`);
  }
  if (!(await looksLikeHub(hub))) {
    throw new Error(
      `Not a mage hub: ${hub}\n` +
        "  (a hub directory has a projects/ dir and a top-level metadata.json registry)\n" +
        "  Run `mage init --hub <name>` to create one.",
    );
  }

  // ─── 11E: project-name guardrail ───────────────────────────────────────
  // A renamed repo links under its basename and silently creates a divergent
  // project instead of matching the hub's registered name (friction E). Warn when
  // the name was auto-derived (no --project) and matches no registered project.
  const earlyHubMeta = await readHubMetadata(hub);
  if (!opts.project && earlyHubMeta && earlyHubMeta.projects.length > 0) {
    const names = earlyHubMeta.projects.map((p) => p.name);
    if (!names.includes(project)) {
      logger.warn(
        `Project '${project}' (from the repo basename) is not registered in this hub ` +
          `(registered: ${names.join(", ")}). If it should map to an existing project, ` +
          `re-run with \`--project <name>\`. Continuing as a new project '${project}'.`,
      );
    }
  }

  // ─── auto-detect storage ───────────────────────────────────────────────
  // Priority order for detection:
  //   1. Existing metadata stores locally (mode=in-repo or hybrid) → storage=repo-owned
  //   2. Existing metadata.json declares mode=external → storage=hub-owned
  //      (the existing external linkage gets superseded by the new one)
  //   3. No metadata.json + content in mage/ → storage=repo-owned (the user
  //      created docs but didn't run init — treat as scenario-4 onboarding)
  //   4. No metadata.json + empty mage/ → storage=hub-owned (fresh link;
  //      the hub will own the docs)
  const docsRoot = codeRepoDocsRoot(codeRepo);
  const docsRootContent = await listContentOrEmpty(docsRoot);
  const existingMeta = await readMetadata(codeRepo);
  let detectedStorage: Storage;
  let detectionReason: string;
  if (existingMeta && existingMeta.mode !== "external") {
    // Stores locally (mode=in-repo or hybrid) ⇒ the repo keeps its docs.
    detectedStorage = "repo-owned";
    detectionReason = `existing metadata stores locally (mode=${existingMeta.mode})`;
  } else if (existingMeta?.mode === "external") {
    detectedStorage = "hub-owned";
    detectionReason = "existing metadata declares mode=external (new hub supersedes)";
  } else {
    const hasInRepoContent = docsRootContent.filter((n) => n !== "metadata.json").length > 0;
    detectedStorage = hasInRepoContent ? "repo-owned" : "hub-owned";
    detectionReason = hasInRepoContent
      ? "mage/ contains content (no metadata yet)"
      : "no mage/ content found";
  }
  const storage: Storage = opts.storage ?? detectedStorage;
  if (opts.storage && opts.storage !== detectedStorage) {
    logger.warn(
      `Override: --storage ${opts.storage} (auto-detect would have picked '${detectedStorage}': ${detectionReason}).`,
    );
  }

  logger.blank();
  logger.info("Linking:");
  logger.detail(`code repo:  ${codeRepo}`);
  logger.detail(`hub:        ${hub}`);
  logger.detail(`project:    ${project}`);
  logger.detail(
    `storage:    ${storage}${opts.storage ? "" : `  (auto-detected: ${detectionReason})`}`,
  );
  logger.blank();

  // ─── update hub-side registry ──────────────────────────────────────────
  const { hubMeta, hubMetadataAction } = await upsertHubProject(hub, {
    project,
    storage,
    codeRepo,
    existing: earlyHubMeta,
  });

  // ─── refresh the code-repo AGENTS.md for the resulting shape ───────────
  if (storage === "hub-owned") {
    // hub-owned = external: the hub owns this project's docs.
    await mkdir(hubProjectDocsRoot(hub, project), { recursive: true });
    logger.success(`Created empty stub: projects/${project}/`);
    // Route this code repo's agents to the hub's per-project entry (ADR-0011 §6).
    await writeAgentsMd(codeRepo, { kind: "repo", mode: "external", docsRel: "mage", hubPath: hub, project });
    logger.detail(`Wrote ${codeRepo}/AGENTS.md (external → ${hub}/_index.${project}.md)`);
  } else {
    // repo-owned = hybrid: the repo keeps its local docs AND registers with this
    // hub. The AGENTS.md was written as a plain in-repo block at `mage init`; refresh
    // it to the hybrid template so agents are told both stores exist (Decision 11A —
    // previously the hybrid block was reachable-by-type but no caller emitted it).
    await writeAgentsMd(codeRepo, { kind: "repo", mode: "hybrid", docsRel: "mage", hubPath: hub, project });
    logger.detail(`Refreshed ${codeRepo}/AGENTS.md (hybrid — local KB + hub ref)`);
  }

  // ─── write/update code-repo-side metadata ──────────────────────────────
  const hubRepoUrl = (await getRemoteOriginUrl(hub)) ?? hub;
  await upsertCodeRepoMetadata(codeRepo, {
    project,
    storage,
    hubPath: hub,
    hubRepoUrl,
  });

  logger.blank();
  logger.success(`Linked code repo '${project}' to hub '${hubMeta.name}'.`);
  logger.blank();
  logger.info("Suggested commits (run yourself; mage never auto-commits):");
  // Both shapes now refresh AGENTS.md + CLAUDE.md (external block for hub-owned, the
  // hybrid block for repo-owned), so stage them in either case.
  logger.detail(`  git -C ${codeRepo} add mage AGENTS.md CLAUDE.md`);
  logger.detail(`  git -C ${codeRepo} commit -m "feat: link to mage '${hubMeta.name}' (project=${project}, storage=${storage})"`);
  logger.blank();
  logger.detail(`  git -C ${hub} add metadata.json${storage === "hub-owned" ? ` projects/${project}/` : ""}`);
  logger.detail(`  git -C ${hub} commit -m "register project '${project}' (storage=${storage})"`);

  // Auto-connect (Decision 5), best-effort: the link is already written, so a connect
  // failure (e.g. a malformed settings.local.json) must NOT fail link — warn + continue.
  // For a hub-owned link the capture SINKS live inside the hub repo, so announce that
  // cross-repo gitignore write (friction G).
  let connectResult: ConnectResult | undefined;
  if (opts.connect !== false) {
    if (storage === "hub-owned") {
      logger.info(
        `Capture sinks for '${project}' live inside the hub repo (${hub}) and will be gitignored there.`,
      );
    }
    logger.info("Wiring capture hooks (pass --no-connect to skip)…");
    try {
      connectResult = await connect({ cwd: codeRepo, yes: opts.yes, gitHook: true });
    } catch (err) {
      logger.warn(
        `Link recorded, but auto-connect failed: ${(err as Error).message} — ` +
          "run `mage connect` to wire capture hooks.",
      );
    }
  }

  return { codeRepo, hub, project, storage, hubMetadataAction, connectResult };
}

// ─── hub-side metadata upsert ───────────────────────────────────────────

interface UpsertHubProjectArgs {
  project: string;
  storage: Storage;
  codeRepo: string;
  /** The hub registry already read by the caller (avoids a second read). */
  existing?: HubMetadata | null;
}

async function upsertHubProject(
  hub: string,
  args: UpsertHubProjectArgs,
): Promise<{ hubMeta: HubMetadata; hubMetadataAction: LinkResult["hubMetadataAction"] }> {
  const codeRepoUrl = (await getRemoteOriginUrl(args.codeRepo)) ?? args.codeRepo;
  const newEntry: HubProject = {
    name: args.project,
    storage: args.storage,
    code_repo_path: args.codeRepo,
    code_repo_url: codeRepoUrl,
  };

  const existing = args.existing ?? (await readHubMetadata(hub));

  if (!existing) {
    // Legacy hub (no top-level metadata.json) — bootstrap it.
    const hubMeta: HubMetadata = {
      schema: METADATA_SCHEMA,
      name: basename(hub),
      created_at: nowIso(),
      projects: [newEntry],
    };
    await writeHubMetadata(hub, hubMeta);
    logger.success(`Created ${hubMetadataPath(hub)} (bootstrapped hub registry)`);
    return { hubMeta, hubMetadataAction: "created" };
  }

  // Update existing registry.
  const idx = existing.projects.findIndex((p) => p.name === args.project);
  if (idx >= 0) {
    existing.projects[idx] = newEntry;
    await writeHubMetadata(hub, existing);
    logger.success(`Updated existing project '${args.project}' in ${hubMetadataPath(hub)}`);
    return { hubMeta: existing, hubMetadataAction: "updated" };
  }
  existing.projects.push(newEntry);
  await writeHubMetadata(hub, existing);
  logger.success(`Appended project '${args.project}' to ${hubMetadataPath(hub)}`);
  return { hubMeta: existing, hubMetadataAction: "appended-project" };
}

// ─── code-repo-side metadata upsert ─────────────────────────────────────

interface UpsertCodeMetaArgs {
  project: string;
  storage: Storage;
  hubPath: string;
  hubRepoUrl: string;
}

async function upsertCodeRepoMetadata(
  codeRepo: string,
  args: UpsertCodeMetaArgs,
): Promise<MageMetadata> {
  const existing = await readMetadata(codeRepo);
  let meta: MageMetadata;

  if (!existing) {
    // Fresh link: code repo has never been mage-initialized.
    if (args.storage === "repo-owned") {
      // This shouldn't happen — if code repo has local content, it should have been
      // init'd already. Defensive: bootstrap as a hybrid (local docs + this hub ref).
      logger.warn(
        "No existing metadata but storage=repo-owned. Bootstrapping code-repo metadata as hybrid mode.",
      );
      meta = {
        schema: METADATA_SCHEMA,
        mode: "hybrid",
        project: args.project,
        hub_path: null,
        hub_repo: null,
        hub_refs: [
          { hub_path: args.hubPath, hub_repo: args.hubRepoUrl, project: args.project },
        ],
        linked_at: nowIso(),
      };
    } else {
      // Fresh hub-owned link — code repo gets mode=external pointing at the hub.
      meta = {
        schema: METADATA_SCHEMA,
        mode: "external",
        project: args.project,
        hub_path: args.hubPath,
        hub_repo: args.hubRepoUrl,
        hub_refs: [],
        linked_at: nowIso(),
      };
    }
  } else if (args.storage === "hub-owned") {
    // Existing metadata + hub-owned link = the user is migrating a repo to hub-owned;
    // overwrite mode to external. (Power-user case via --storage override.)
    meta = {
      ...existing,
      schema: METADATA_SCHEMA,
      mode: "external",
      project: args.project,
      hub_path: args.hubPath,
      hub_repo: args.hubRepoUrl,
      linked_at: nowIso(),
    };
  } else {
    // Existing local KB + new hub-ref = hybrid mode. Append/update the hub-ref and
    // make the mode explicit (a v1 in-repo becomes hybrid on its first hub link).
    const refs = [...existing.hub_refs];
    const idx = refs.findIndex((r) => r.hub_path === args.hubPath);
    const newRef = { hub_path: args.hubPath, hub_repo: args.hubRepoUrl, project: args.project };
    if (idx >= 0) refs[idx] = newRef;
    else refs.push(newRef);
    meta = {
      ...existing,
      schema: METADATA_SCHEMA,
      mode: "hybrid",
      hub_refs: refs,
      linked_at: nowIso(),
    };
  }

  await mkdir(dirname(metadataPath(codeRepo)), { recursive: true });
  await writeMetadata(codeRepo, meta);
  logger.success(`Wrote ${metadataPath(codeRepo)}`);
  return meta;
}

// ─── utilities ───────────────────────────────────────────────────────────

async function listContentOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
