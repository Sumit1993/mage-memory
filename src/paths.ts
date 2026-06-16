import { access, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// ─── path constants ──────────────────────────────────────────────────────
/** The knowledge-base (KB) dir nested in a code repo (in-repo and hybrid modes). */
export const META_DIR = "mage";
export const META_FILE = "metadata.json";
export const PROJECTS_DIR = "projects";
export const ARCHIVE_DIR = "archive";

// KB layout (inside a docs root, whether a repo `mage/` or a hub root).
export const NOTES_DIR = "notes";
export const WORK_DIR = "work";
export const DECISIONS_DIR = "decisions";
export const INDEX_FILE = "INDEX.md";
export const IDENTITY_FILE = "IDENTITY.md";
/** Pre-promotion scratch (git-ignored). */
export const LEARNINGS_DIR = ".learnings";
/** Read-only context-match rollup dir (git-ignored, sibling of LEARNINGS_DIR). */
export const METRICS_DIR = ".metrics";
/** Rotated `.learnings/` archives (git-ignored, lives inside LEARNINGS_DIR). */
export const LEARNINGS_ARCHIVE_DIR = ".archive";
/** Once-per-day age-purge throttle marker (inside LEARNINGS_DIR). */
export const LEARNINGS_PURGE_MARKER = ".last-purge";
/** Per-work-unit raw materials dir name (git-ignored wherever it appears). */
export const ARTIFACTS_DIRNAME = "artifacts";
/** Obsidian config dir (Obsidian's own term; not a mage product noun). */
export const OBSIDIAN_DIR = ".obsidian";
/** Git metadata dir (skipped by the scanner). */
export const GIT_DIR = ".git";
/** Dependency dir (skipped by the scanner). */
export const NODE_MODULES_DIR = "node_modules";
/** Build output dir (skipped by ingest enumeration). */
export const DIST_DIR = "dist";
/** Agent-harness skill/config dirs where `mage skills` writes — skipped by the scanner. */
export const CLAUDE_DIR = ".claude";
export const AGENTS_SKILLS_DIR = ".agents";

export const AGENTS_FILE = "AGENTS.md";
export const CLAUDE_FILE = "CLAUDE.md";
export const GITIGNORE_FILE = ".gitignore";
/**
 * The Gate-2 false-positive allowlist (0.0.12). A COMMITTED (not git-ignored),
 * shared file at the docs root that lets a strict, no-`--no-verify` environment
 * confirm a false positive without disabling the redaction hook. Path globs skip a
 * staged file; `literal:<value>` lines whitelist an exact matched value.
 */
export const REDACTIGNORE_FILE = ".redactignore";

// ─── schema ──────────────────────────────────────────────────────────────
/** Current on-disk schema version — what every writer stamps. */
export const METADATA_SCHEMA = "mage.v2";
/**
 * Prior schema version. Still read leniently and normalized to v2 in memory
 * (Dec 9 migration): never throws on a v1 file. `mage migrate` rewrites eagerly.
 */
export const METADATA_SCHEMA_V1 = "mage.v1";

/**
 * Code-repo-side metadata. Lives at `<code-repo>/mage/metadata.json`.
 *
 * Three modes (the canonical KB-shape axis):
 *   - "in-repo":  the KB lives at `<code-repo>/mage/`. hub_refs is empty;
 *                 hub_path/hub_repo are null.
 *   - "hybrid":   the KB lives at `<code-repo>/mage/` (same docs root as in-repo)
 *                 AND is registered with one or more external hubs. hub_refs is
 *                 non-empty; hub_path/hub_repo remain null.
 *   - "external": the KB is hub-owned; docs live at `<hub_path>/projects/<project>/`.
 *                 hub_path/hub_repo are populated; hub_refs is empty.
 */
export interface MageMetadata {
  schema: string;
  mode: "in-repo" | "hybrid" | "external";
  project: string;
  hub_path: string | null;
  hub_repo: string | null;
  hub_refs: HubRef[];
  linked_at: string;
  /** 0.0.8 self-grooming dial (ADR-0019 §7); absent ⇒ "normal". */
  grooming?: { sensitivity?: "low" | "normal" | "high" };
}

/**
 * One entry in `hub_refs[]`. Present when mode=hybrid — this code repo is
 * registered with one or more external hubs for cross-cutting context.
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
  /** 0.0.8 self-grooming dial (ADR-0019 §7); absent ⇒ "normal". */
  grooming?: { sensitivity?: "low" | "normal" | "high" };
}

export interface HubProject {
  name: string;
  /**
   * "hub-owned" — the project's notes live at `<hub>/projects/<name>/`
   * (the hub has the actual files). Used when the code repo was linked via the
   * external-only flow (no in-repo notes at link time).
   *
   * "repo-owned" — the project's notes live at `<code_repo_path>/mage/` (the code
   * repo owns the files; the hub just registers awareness). Used in hybrid mode.
   */
  storage: "hub-owned" | "repo-owned";
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
 * mode=in-repo or mode=hybrid (both store locally in `<code-repo>/mage/`).
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
 * Read and parse a code repo's mage metadata file, if present. Returns null if
 * absent. Reads BOTH schema v1 and v2 leniently: a v1 file is normalized to the
 * v2 shape IN MEMORY (mode "in-repo" + non-empty hub_refs ⇒ "hybrid"), but the
 * returned object's `schema` field is the ON-DISK value — so `status`/`doctor`
 * can still report a v1 file as needing `mage migrate`. Only a genuinely foreign
 * schema throws. On the capture hot path: kept cheap and total.
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
  if (schema !== METADATA_SCHEMA && schema !== METADATA_SCHEMA_V1) {
    throw new Error(
      `Unknown mage metadata schema at ${path}: ${schema || "(missing)"}. ` +
        `Expected ${METADATA_SCHEMA}. Run \`mage migrate\` to upgrade, or delete and run \`mage init\`/\`mage link\` to recreate.`,
    );
  }
  return normalizeMetadata(parsed as unknown as MageMetadata);
}

/**
 * v1 → v2 in-memory normalization for code-repo metadata: makes hybrid explicit
 * (mode "in-repo" + non-empty hub_refs ⇒ "hybrid"). Idempotent on a v2 object,
 * and immutable — returns the same object when nothing changed (cheap hot path),
 * a new object otherwise. Leaves `schema` untouched; {@link writeMetadata} stamps
 * the current schema on write.
 */
export function normalizeMetadata(meta: MageMetadata): MageMetadata {
  const mode =
    (meta.mode as string) === "in-repo" && (meta.hub_refs?.length ?? 0) > 0
      ? "hybrid"
      : meta.mode;
  return mode === meta.mode ? meta : { ...meta, mode };
}

/**
 * Read and parse a hub's top-level metadata.json. Returns null if absent. Reads
 * schema v1 and v2 leniently and normalizes v1 in memory (HubProject.storage
 * "in-repo" ⇒ "repo-owned"); the returned `schema` is the on-disk value. Only a
 * genuinely foreign schema throws.
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
  const schema = String(parsed.schema ?? "");
  if (schema !== METADATA_SCHEMA && schema !== METADATA_SCHEMA_V1) {
    throw new Error(
      `Unknown mage hub metadata schema at ${path}: ${schema || "(missing)"}. ` +
        `Expected ${METADATA_SCHEMA}. Run \`mage migrate\` to upgrade, or delete and re-run \`mage link\`.`,
    );
  }
  return normalizeHubMetadata(parsed as unknown as HubMetadata);
}

/**
 * v1 → v2 in-memory normalization for hub metadata: renames each project's
 * storage "in-repo" ⇒ "repo-owned". Idempotent and immutable (same object when
 * nothing changed). Leaves `schema` untouched; {@link writeHubMetadata} stamps it.
 */
export function normalizeHubMetadata(hub: HubMetadata): HubMetadata {
  if (!Array.isArray(hub.projects)) return hub;
  let changed = false;
  const projects = hub.projects.map((p) => {
    if ((p.storage as string) === "in-repo") {
      changed = true;
      return { ...p, storage: "repo-owned" as const };
    }
    return p;
  });
  return changed ? { ...hub, projects } : hub;
}

// ─── writing ─────────────────────────────────────────────────────────────

/**
 * Write a code repo's metadata, ALWAYS stamping the current schema
 * ({@link METADATA_SCHEMA}). Routing every writer through this guarantees a
 * read-modify-write upgrades a v1 file to v2 (lazy migration) and that no spread
 * accidentally persists a stale schema. Trailing newline for clean git diffs.
 */
export async function writeMetadata(codeRepo: string, meta: MageMetadata): Promise<void> {
  const stamped: MageMetadata = { ...meta, schema: METADATA_SCHEMA };
  await writeFile(metadataPath(codeRepo), `${JSON.stringify(stamped, null, 2)}\n`);
}

/** Write a hub's top-level metadata, always stamping {@link METADATA_SCHEMA}. */
export async function writeHubMetadata(hubRoot: string, hub: HubMetadata): Promise<void> {
  const stamped: HubMetadata = { ...hub, schema: METADATA_SCHEMA };
  await writeFile(hubMetadataPath(hubRoot), `${JSON.stringify(stamped, null, 2)}\n`);
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

/** What {@link resolveDocsRoot} resolves to: the docs root to operate on, its
 *  kind, and the git repo the sinks live under (== root for a repo-KB/hub; the hub
 *  for an external project, whose docs live inside the hub's repo). `kind` is the
 *  2-value umbrella — "repo" covers BOTH in-repo and hybrid (both store locally);
 *  callers that must distinguish re-read `meta.mode`. */
export interface ResolvedDocsRoot {
  root: string;
  kind: "repo" | "hub";
  repo: string;
}

/**
 * Resolve the mage docs root to operate on, starting from `startDir` (default cwd):
 *  - repo KB:  the nearest ancestor with `mage/metadata.json` (mode=in-repo or
 *              mode=hybrid) → that repo's `mage/`. Reported as kind "repo".
 *  - external: that metadata is mode=external → the HUB project it points to
 *              (`<hub_path>/projects/<project>/`), so captures/grooming land in the
 *              hub, not the code repo. Reported as kind "hub" (a hub-owned project
 *              is a flat docs root living inside the hub's repo); `repo` is the hub.
 *  - hub:      `startDir` is a hub root, or sits inside one. Inside a hub-owned
 *              project dir (`<hub>/projects/<name>/…`) → that project's flat docs
 *              root; the hub root or elsewhere under it → the hub root. Kind "hub".
 * Returns null if none is found. A malformed/unreadable metadata degrades to the
 * repo KB root (never throws — this is on the capture hot path).
 */
export async function resolveDocsRoot(startDir: string): Promise<ResolvedDocsRoot | null> {
  const abs = absolutePath(startDir);

  // Walk up looking for a code-repo `mage/metadata.json` (in-repo/hybrid/external).
  let dir = abs;
  for (;;) {
    if (await exists(join(dir, META_DIR, META_FILE))) {
      // Honor mode=external by following hub_path; a bad read degrades to repo KB.
      const external = await externalDocsRoot(dir).catch(() => null);
      return external ?? { root: codeRepoDocsRoot(dir), kind: "repo", repo: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Otherwise, walk up looking for a hub root. `startDir` may BE the hub, or sit
  // INSIDE it — most importantly inside a hub-owned project dir
  // (`<hub>/projects/<name>/`), a flat docs root the hub owns but which carries no
  // metadata.json of its own. Resolving it is what lets `mage <engine> --dir
  // <hub>/projects/<name>/` (the Decision 1 groom fan-out) reach the project's
  // own `.learnings/` even when its member code repo is absent on this machine.
  dir = abs;
  for (;;) {
    if (await looksLikeHub(dir)) return hubDocsRoot(dir, abs);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Resolve a docs root given that `hub` is a hub root and `abs` is at or below it.
 * Inside `<hub>/projects/<name>/…` → that project's flat docs root; the hub root
 * itself or anywhere else under it → the hub root. Always kind "hub" (the hub repo
 * owns the files).
 */
function hubDocsRoot(hub: string, abs: string): ResolvedDocsRoot {
  const rel = relative(hub, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    const [top, name] = rel.split(sep);
    if (top === PROJECTS_DIR && name) {
      return { root: hubProjectDocsRoot(hub, name), kind: "hub", repo: hub };
    }
  }
  return { root: hub, kind: "hub", repo: hub };
}

/**
 * If the code repo at `dir` is linked in external mode (its `mage/metadata.json`
 * has mode=external with a usable hub_path + project), the hub project docs root
 * it points to; otherwise null (caller falls back to repo-KB handling). May throw
 * on an unknown/foreign schema or unsafe project name — {@link resolveDocsRoot} catches it.
 */
async function externalDocsRoot(dir: string): Promise<ResolvedDocsRoot | null> {
  const meta = await readMetadata(dir);
  if (!meta || meta.mode !== "external" || !meta.hub_path || !meta.project) return null;
  return {
    root: hubProjectDocsRoot(meta.hub_path, meta.project),
    kind: "hub",
    repo: meta.hub_path,
  };
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
