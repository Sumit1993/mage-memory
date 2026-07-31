// Low-level path primitives and on-disk shape guards.
//
// These live in their own leaf module so that containment stays ONE definition
// (ADR-0042 consolidated it) even though ADR-0043 introduced a second module
// that needs it. `paths.ts` resolves hub locations via `hub-url.ts`, and
// `hub-url.ts` needs the same containment check and hub shape gate — importing
// them back from `paths.ts` would make the two mutually recursive. This module
// depends on nothing of ours, so both can import it freely.
//
// `paths.ts` re-exports every symbol here, so existing callers importing from
// `./paths.js` are unaffected.

import { access, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/** Directory holding a hub's per-project docs roots. */
export const PROJECTS_DIR = "projects";
/** Metadata filename, in both a code-repo KB and a hub root. */
export const META_FILE = "metadata.json";

/** True when `path` exists and is readable. */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `child` is `parent` itself or sits beneath it.
 *
 * The single containment check (ADR-0042). Every path derived from untrusted
 * input — a git-tracked `hub_repo`, a `hub_path`, a project name — is asserted
 * against this before use. Do not re-implement it locally.
 */
export function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

/** Path to a hub root's `metadata.json`. */
export function hubMetadataPath(hubRoot: string): string {
  return join(hubRoot, META_FILE);
}

/**
 * The hub shape gate (ADR-0042 §7): a `projects/` directory plus a hub
 * `metadata.json`. Deriving an address does not make its contents trustworthy,
 * so this still gates use of a hub found at a derived path (ADR-0043 §7).
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
