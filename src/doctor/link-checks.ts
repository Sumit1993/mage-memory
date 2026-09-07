// Link-integrity checks for `mage doctor` (0.0.9 setup-integrity). A code repo and
// its hub keep cross-references — the code repo's `mage/metadata.json.hub_repo`
// (forward; derived per ADR-0043, with the deprecated `hub_path` read only as a
// fallback) and the hub registry's project entry.
//
// What doctor validates: hub reachability at its derived location, origin match
// between that clone and `hub_repo` (never reused, never clobbered — ADR-0043 §2),
// and project registration — all needing an explicit `mage link <hub>` or a manual clone/move.

import { dirname, join } from "node:path";
import type { DoctorCheck, DoctorOptions } from "../commands/doctor.js";
import {
  META_DIR,
  META_FILE,
  type HubTarget,
  absolutePath,
  chosenHubRoot,
  exists,
  readHubMetadata,
  readMetadata,
  resolveHubGrant,
} from "../paths.js";

const CHECK = "link integrity";

/**
 * Append the link-integrity check from a linked EXTERNAL code repo → validate forward
 * (hub reachable + project registered).
 * In-repo (no hub) and non-KB dirs append nothing.
 */
export async function pushLinkChecks(checks: DoctorCheck[], opts: DoctorOptions): Promise<void> {
  const startDir = absolutePath(opts.cwd ?? process.cwd());

  const codeRepo = await findCodeRepo(startDir);
  if (codeRepo) {
    const meta = await readMetadata(codeRepo).catch(() => null);
    if (meta?.mode === "external") {
      await checkExternalLink(checks, opts, codeRepo, meta.hub_repo, meta.hub_path, meta.project);
    }
    return; // in-repo: no hub link to validate.
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

/**
 * Validate (and optionally repair) an external code repo's two-way hub link.
 * Resolves the hub root the ADR-0043 way — via the shared {@link resolveHubGrant}
 * (origin-verifying derived hub_repo, falling back to hub_path) — so an origin mismatch
 * is flagged before reading or repairing the hub.
 */
async function checkExternalLink(
  checks: DoctorCheck[],
  _opts: DoctorOptions,
  _codeRepo: string,
  hubRepo: string | null,
  hubPathField: string | null,
  project: string,
): Promise<void> {
  const chosen = chosenHubRoot(hubRepo, hubPathField);
  if (!chosen) {
    checks.push({
      name: CHECK,
      ok: false,
      detail: "hub at (no hub_repo/hub_path) is not a reachable hub (moved?) — re-run `mage link <hub>`",
    });
    return;
  }

  const target: HubTarget = {
    root: absolutePath(chosen.root),
    source: chosen.source,
    hubRepo: chosen.source === "derived" ? (hubRepo ?? undefined) : undefined,
    hubPath: hubPathField ?? undefined,
  };
  const resolution = await resolveHubGrant(target);

  if (resolution.reason === "mismatch") {
    checks.push({
      name: CHECK,
      ok: false,
      detail:
        `hub at ${chosen.root} is a clone of a different remote` +
        `${resolution.detail ? ` (${resolution.detail})` : ""}` +
        " — not reused and not repaired; re-run `mage link <hub>` to re-point this repo",
    });
    return;
  }

  const hubPath = resolution.root;
  if (!hubPath) {
    checks.push({
      name: CHECK,
      ok: false,
      detail: `hub at ${chosen.root} is not a reachable hub (moved?) — re-run \`mage link <hub>\``,
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

  checks.push({
    name: CHECK,
    ok: true,
    detail: `external link to '${hubMeta.name}' (project '${project}') consistent`,
  });
}
