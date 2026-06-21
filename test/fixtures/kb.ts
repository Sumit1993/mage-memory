// The shared knowledge-base fixture — test-only infrastructure (never ships; not a spec).
//
// Owns the byte-identical core every KB-touching test re-rolled by hand: the temp-dir
// LIFECYCLE (auto-cleaned), the `metadata.json` SCHEMA boilerplate, and the resolveDocsRoot
// call. Content seeders (.learnings chapters, staged drafts, notes) stay in the tests — a
// knob that serves a single test does NOT belong here (the over-reach guard: this stays a
// deep fixture, not a test-DSL).
//
// Two layers:
//   tmpDir(prefix?) — an auto-cleaned temp dir (the no-KB-found cases).
//   withKb(opts?)   — a built, resolved KB inside a tmpDir; returns a uniform handle.
//
// Auto-clean rides vitest's onTestFinished, so a test needs no `made[]` + afterEach of its own;
// N builds in one test register N cleanups for free.
//
// Shapes covered: in-repo ("repo", default), hub ("hub", incl. registered projects), and a
// hub-owned project ("project", the root != repo case). External-mode code repos are a low-
// frequency shape (a handful of doctor/connect/verify tests) deferred to the sweep, by design.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import {
  type GroomingConfig,
  type HubProject,
  type ResolvedDocsRoot,
  META_DIR,
  METADATA_SCHEMA,
  METADATA_SCHEMA_V1,
  PROJECTS_DIR,
  hubMetadataPath,
  hubProjectDocsRoot,
  metadataPath,
  resolveDocsRoot,
} from "../../src/paths.js";

/** Create a temp dir removed when the current test finishes — no afterEach/made[] needed. */
export async function tmpDir(prefix = "mage-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

/** The KB layout to build. "repo" (default) = in-repo; "hub" = a hub root; "project" = a hub-owned project (root != repo). */
export type KbKind = "repo" | "hub" | "project";

export interface WithKbOptions {
  /** The KB layout (default "repo"). */
  kind?: KbKind;
  /** The grooming sub-object to write into metadata (omit ⇒ none). For "project" it lands in the HUB's metadata. */
  grooming?: GroomingConfig;
  /** Metadata schema version (default 2). schema 1 exercises the migrate/normalize paths. */
  schema?: 1 | 2;
  /** Hub projects to register ("hub" only). */
  projects?: HubProject[];
  /** The hub-owned project name ("project" only; default "p"). */
  project?: string;
  /** A temp-dir prefix override (debugging aid). */
  prefix?: string;
}

/** A built, resolved KB. `dir` is the cwd a command resolves from; `resolved` is that same resolution. */
export interface KbHandle {
  /** The directory a command resolves from (code repo, hub root, or hub-owned project dir). */
  dir: string;
  /** The docs root — where `.mage/{learnings,metrics,staging}` + notes live. */
  root: string;
  /** The metadata-owning root: == dir for "repo"/"hub"; the hub for a hub-owned "project". */
  repo: string;
  /** resolveDocsRoot(dir) — the resolution a command performs. */
  resolved: ResolvedDocsRoot;
}

function schemaTag(schema: 1 | 2): string {
  return schema === 1 ? METADATA_SCHEMA_V1 : METADATA_SCHEMA;
}

function inRepoMeta(schema: 1 | 2, grooming?: GroomingConfig): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    schema: schemaTag(schema),
    mode: "in-repo",
    project: "p",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: "2026-06-08T00:00:00.000Z",
  };
  if (grooming) meta.grooming = grooming;
  return meta;
}

function hubMeta(schema: 1 | 2, grooming?: GroomingConfig, projects: HubProject[] = []): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    schema: schemaTag(schema),
    name: "hub",
    created_at: "2026-06-08T00:00:00.000Z",
    projects,
  };
  if (grooming) meta.grooming = grooming;
  return meta;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function mustResolve(dir: string): Promise<ResolvedDocsRoot> {
  const resolved = await resolveDocsRoot(dir);
  if (!resolved) throw new Error(`kb fixture: resolveDocsRoot returned null for ${dir}`);
  return resolved;
}

/** Build a temp KB of the requested shape, resolve it, and return a uniform handle. Auto-cleaned. */
export async function withKb(opts: WithKbOptions = {}): Promise<KbHandle> {
  const { kind = "repo", grooming, schema = 2, projects, project = "p", prefix } = opts;
  const base = await tmpDir(prefix);

  if (kind === "repo") {
    await mkdir(join(base, META_DIR), { recursive: true });
    await writeJson(metadataPath(base), inRepoMeta(schema, grooming));
    const resolved = await mustResolve(base);
    return { dir: base, root: resolved.root, repo: base, resolved };
  }

  // "hub" / "project": grooming + projects live in the hub's own metadata at the hub root.
  // looksLikeHub requires a projects/ dir alongside the metadata, so create it.
  await mkdir(join(base, PROJECTS_DIR), { recursive: true });
  await writeJson(hubMetadataPath(base), hubMeta(schema, grooming, projects));

  if (kind === "hub") {
    const resolved = await mustResolve(base);
    return { dir: base, root: base, repo: base, resolved };
  }

  // "project": a hub-owned project subdir, resolved as root (the project dir) != repo (the hub).
  const projectDir = hubProjectDocsRoot(base, project);
  await mkdir(projectDir, { recursive: true });
  const resolved = await mustResolve(projectDir);
  return { dir: projectDir, root: projectDir, repo: base, resolved };
}
