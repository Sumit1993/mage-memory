import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeHubRepo, readGitConfigOriginUrl } from "./hub-url.js";
import { looksLikeHub } from "./path-guards.js";

/** One hub clone found away from its derived location, matching by canonical origin. */
export interface DisplacedHubCandidate {
  path: string;
  /** The raw origin URL read from the candidate's `.git/config` (unredacted — callers decide). */
  origin: string;
}

/**
 * Scan `root` (the hubs root) for a clone whose canonicalized origin equals
 * `wantedKey`, at exactly `depth` directory levels down (host + N path
 * segments — the same depth `wantedKey`'s own segment count implies). ADR-0043
 * §5 / this spec §4 — determinism is the whole point of this function:
 *
 *   - `depth` is DERIVED from the requested key by the caller, never
 *     hard-coded — a hard cap silently skips exactly the nested (GitLab
 *     subgroup) hubs the nested-segment design exists to support.
 *   - directory entries are read and SORTED at every level of the walk, so
 *     which candidate is "first" is the same on every machine regardless of
 *     `readdir` order (which is filesystem-dependent).
 *   - ALL candidates are returned, sorted by path — never just the first —
 *     so an ambiguous case (two displaced clones of the same remote) is
 *     visible. Callers that want the deterministic single pick take `[0]`.
 *
 * Read-only: never moves, never clones, never writes. A directory that fails
 * `looksLikeHub`, or whose origin can't be read or doesn't parse, is silently
 * skipped — not a candidate, not an error.
 */
export async function findDisplacedHubs(
  root: string,
  wantedKey: string,
  depth: number,
): Promise<DisplacedHubCandidate[]> {
  const out: DisplacedHubCandidate[] = [];
  if (depth < 1) return out;

  async function walk(dir: string, remaining: number): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (remaining === 1) {
        if (!(await looksLikeHub(candidate))) continue;
        const origin = await readGitConfigOriginUrl(candidate);
        if (!origin) continue;
        try {
          if (canonicalizeHubRepo(origin).key === wantedKey) {
            out.push({ path: candidate, origin });
          }
        } catch {
          // Candidate's own origin doesn't canonicalize — not a match, not an error.
        }
      } else {
        await walk(candidate, remaining - 1);
      }
    }
  }

  await walk(root, depth);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
