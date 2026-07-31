import { access, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

// ─── leaf primitives ───────────────────────────────────────────────────────
//
// Pulled out of paths.ts (ADR-0043) so hub derivation (src/hub-url.ts) can use
// isUnder/looksLikeHub/exists WITHOUT importing paths.ts — paths.ts imports hub
// derivation (for chosenHubRoot), so a leaf module is what keeps the two from
// being mutually recursive. paths.ts re-exports everything here for existing
// call sites; nothing outside paths.ts should need to import this file directly
// except hub-url.ts/hub-scan.ts.

export const META_FILE = "metadata.json";
export const PROJECTS_DIR = "projects";

/** Hub's top-level metadata file. */
export function hubMetadataPath(hubRoot: string): string {
  return join(hubRoot, META_FILE);
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
 * True when `child` is `parent` itself or nested inside it (no `../` escape).
 * The one canonical containment rule — it was written five times across the
 * codebase before this; adapters and `dream` import it rather than re-deriving it.
 */
export function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
