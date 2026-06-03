import { access, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

// ─── path constants ──────────────────────────────────────────────────────
/** The knowledge-base dir nested in a code repo (in-repo mode). */
export const META_DIR = "mage";
export const META_FILE = "metadata.json";
export const PROJECTS_DIR = "projects";
export const ARCHIVE_DIR = "archive";

// Vault layout (inside a docs root, whether in-repo `mage/` or a hub root).
export const NOTES_DIR = "notes";
export const WORK_DIR = "work";
export const DECISIONS_DIR = "decisions";
export const INDEX_FILE = "INDEX.md";
export const IDENTITY_FILE = "IDENTITY.md";
/** Pre-promotion scratch (git-ignored). */
export const LEARNINGS_DIR = ".learnings";
/** Per-work-unit raw materials dir name (git-ignored wherever it appears). */
export const ARTIFACTS_DIRNAME = "artifacts";
/** Obsidian vault config dir. */
export const OBSIDIAN_DIR = ".obsidian";
/** Git metadata dir (skipped by the scanner). */
export const GIT_DIR = ".git";
/** Dependency dir (skipped by the scanner). */
export const NODE_MODULES_DIR = "node_modules";
/** Agent-harness skill/config dirs where `mage skills` writes — skipped by the scanner. */
export const CLAUDE_DIR = ".claude";
export const AGENTS_SKILLS_DIR = ".agents";

export const AGENTS_FILE = "AGENTS.md";
export const CLAUDE_FILE = "CLAUDE.md";
export const GITIGNORE_FILE = ".gitignore";

// ─── schema ──────────────────────────────────────────────────────────────
export const METADATA_SCHEMA = "mage.v1";

/**
 * Code-repo-side metadata. Lives at `<code-repo>/mage/metadata.json`.
 *
 * Two modes:
 *   - "in-repo":  the knowledge base lives at `<code-repo>/mage/`. hub_path/hub_repo are null.
 *                 Hybrid mode = in-repo + non-empty hub_refs[].
 *   - "external": the knowledge base lives at `<hub_path>/projects/<project>/`.
 *                 hub_path/hub_repo are populated.
 */
export interface MageMetadata {
  schema: string;
  mode: "in-repo" | "external";
  project: string;
  hub_path: string | null;
  hub_repo: string | null;
  hub_refs: HubRef[];
  linked_at: string;
}

/**
 * One entry in `hub_refs[]`. Used in hybrid mode (mode=in-repo + this code repo
 * is also registered with one or more external hubs for cross-cutting context).
 */
export interface HubRef {
  hub_path: string;
  hub_repo: string;
  /** Project name as registered in that hub (may differ from code-repo's own project). */
  project: string;
}

/**
 * Hub-side metadata. Lives at `<hub>/metadata.json` (AT THE ROOT, not nested
 * under mage/, because the hub repo is entirely the knowledge base — no
 * segregation namespace needed). The registry of all projects this hub knows about.
 */
export interface HubMetadata {
  schema: string;
  name: string;
  created_at: string;
  projects: HubProject[];
}

export interface HubProject {
  name: string;
  /**
   * "hub-owned" — the project's notes live at `<hub>/projects/<name>/`
   * (the hub has the actual files). Used when the code repo was linked via the
   * external-only flow (no in-repo notes at link time).
   *
   * "in-repo" — the project's notes live at `<code_repo_path>/mage/` (the code
   * repo owns the files; the hub just registers awareness). Used in hybrid mode.
   */
  storage: "hub-owned" | "in-repo";
  code_repo_path: string;
  code_repo_url: string;
}

// ─── path helpers ────────────────────────────────────────────────────────

/** Code repo's metadata file. */
export function metadataPath(codeRepo: string): string {
  return join(codeRepo, META_DIR, META_FILE);
}

/**
 * Code repo's docs root — where notes/, decisions/, work/, INDEX.md land when
 * mode=in-repo or mode=in-repo+hub_refs (hybrid).
 */
export function codeRepoDocsRoot(codeRepo: string): string {
  return join(codeRepo, META_DIR);
}

/** Hub's top-level metadata file. */
export function hubMetadataPath(hubRoot: string): string {
  return join(hubRoot, META_FILE);
}

/** Guard against path traversal via a name that becomes a directory segment. */
export function assertSafeName(name: string, kind: string): void {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    throw new Error(
      `Unsafe ${kind} '${name}': must not be empty, '.', '..', or contain path separators.`,
    );
  }
}

/** Hub-owned project's directory (no `mage/` nesting at THIS level). */
export function hubProjectPath(hubRoot: string, projectName: string): string {
  assertSafeName(projectName, "project name");
  return join(hubRoot, PROJECTS_DIR, projectName);
}

/**
 * Hub-owned project's docs root — where a project's notes land. FLAT (ADR-0011
 * §6): `projects/<name>/{notes,decisions,…}`, no `mage/` nesting. A project
 * looks like the hub it lives in, not like a code-repo `mage/`. (Identical to
 * {@link hubProjectPath}; kept as a distinct name for call-site intent.)
 */
export function hubProjectDocsRoot(hubRoot: string, projectName: string): string {
  return hubProjectPath(hubRoot, projectName);
}

// ─── reading ─────────────────────────────────────────────────────────────

/**
 * Read and parse a code repo's mage metadata file, if present.
 * Returns null if the file doesn't exist. Throws if the schema is unknown.
 */
export async function readMetadata(codeRepo: string): Promise<MageMetadata | null> {
  const path = metadataPath(codeRepo);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `metadata.json at ${path} is not valid JSON (possible merge conflict or partial write). ` +
        `Delete it and run \`mage init\` or \`mage link\` to recreate.`,
    );
  }
  const schema = String(parsed.schema ?? "");
  if (schema !== METADATA_SCHEMA) {
    throw new Error(
      `Unknown mage metadata schema at ${path}: ${schema || "(missing)"}. ` +
        `Expected ${METADATA_SCHEMA}. Delete the file and run \`mage init\` or \`mage link\` to recreate.`,
    );
  }
  return parsed as unknown as MageMetadata;
}

/**
 * Read and parse a hub's top-level metadata.json. Returns null if absent.
 */
export async function readHubMetadata(hubRoot: string): Promise<HubMetadata | null> {
  const path = hubMetadataPath(hubRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Hub metadata.json at ${path} is not valid JSON (possible merge conflict or partial write). ` +
        `Delete it and run \`mage link\` to recreate.`,
    );
  }
  return parsed as unknown as HubMetadata;
}

// ─── structural checks ──────────────────────────────────────────────────

/**
 * True iff `path` looks like a hub root — has the projects/ registry dir AND a
 * top-level metadata.json. (cross-refs/ is gone in mage; relationships are
 * notes/edges, not a directory — see ADR-0006.)
 */
export async function looksLikeHub(path: string): Promise<boolean> {
  try {
    const s = await stat(join(path, PROJECTS_DIR));
    if (!s.isDirectory()) return false;
  } catch {
    return false;
  }
  return exists(hubMetadataPath(path));
}

/**
 * Resolve the mage docs root to operate on, starting from `startDir` (default cwd):
 *  - in-repo: the nearest ancestor with `mage/metadata.json` → that repo's `mage/`.
 *  - hub:     `startDir` itself looks like a hub → the hub root.
 * Returns null if neither is found.
 */
export async function resolveDocsRoot(
  startDir: string,
): Promise<{ root: string; kind: "in-repo" | "hub"; repo: string } | null> {
  const abs = absolutePath(startDir);

  // Walk up looking for an in-repo `mage/metadata.json`.
  let dir = abs;
  for (;;) {
    if (await exists(join(dir, META_DIR, META_FILE))) {
      return { root: codeRepoDocsRoot(dir), kind: "in-repo", repo: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Otherwise, is the start dir itself a hub?
  if (await looksLikeHub(abs)) {
    return { root: abs, kind: "hub", repo: abs };
  }

  return null;
}

/** Resolve a path (relative → absolute relative to cwd). */
export function absolutePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/** True iff a file/dir exists at `path`. */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
