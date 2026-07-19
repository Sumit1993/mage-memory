// The grooming-config seam (ADR-0019 §7 + ADR-0030): the ONE place that locates,
// parses, and writes a resolved docs root's `metadata.json → grooming` sub-object.
//
// Before this module the hub-vs-repo branch + fail-open were re-derived at every
// field reader — readSensitivity, readAutonomy, and the nudge's own readThrottleHours
// (which lazy-imported paths.js to dodge a cycle) — and a fourth time at the autonomy
// command's read-merge-write. They had drifted apart once (root vs repo for hubs) and
// were re-converged by hand. This concentrates the branch (locality): one read locates
// the config, every field narrows off it, and the writer rides the same path (leverage).
//
// HUB SEMANTICS (ADR-0030): hub grooming config is a single hub-ROOT setting in the hub's
// own metadata (`resolved.repo` — where `mage autonomy` writes), applying to the hub + its
// projects. For a hub-owned/external KB `resolved.root` is `<hub>/projects/<name>/` — a file
// nobody writes — so the read MUST use `resolved.repo` to match the write and hold the
// round-trip. Per-project override is future work.

import {
  type GroomingConfig,
  type ResolvedDocsRoot,
  hubMetadataPath,
  metadataPath,
  readHubMetadata,
  readMetadata,
  writeHubMetadata,
  writeMetadata,
} from "../paths.js";
import { type Autonomy, narrowAutonomy } from "./autonomy-ladder.js";
import { type Sensitivity, narrowSensitivity } from "./thresholds.js";

/** The resolved grooming config for a docs root — every field narrowed + defaulted. */
export interface ResolvedGrooming {
  /** The recurrence dial (ADR-0019 §7); absent/junk ⇒ "normal". */
  sensitivity: Sensitivity;
  /** The opt-in autonomy level (ADR-0030); absent/junk ⇒ "operator". */
  autonomy: Autonomy;
  /** The backlog-reminder window in hours (ADR-0030 §5); absent/non-number ⇒ undefined (caller defaults). */
  nudgeThrottleHours: number | undefined;
  /** The pre-registered autonomy keep-rate threshold (ADR-0031 P2 §7); absent/non-number ⇒ undefined (unset). */
  crownThreshold: number | undefined;
}

/**
 * The on-disk grooming sub-object for a resolved docs root (or undefined), branched + parsed
 * ONCE and FAIL-OPEN: a missing file, unreadable bytes, or an unknown schema all yield undefined
 * so callers fall back to their defaults. The hub/repo branch and the `resolved.repo` choice live
 * here and nowhere else.
 */
async function loadGroomingRaw(resolved: ResolvedDocsRoot): Promise<GroomingConfig | undefined> {
  try {
    const meta =
      resolved.kind === "hub"
        ? await readHubMetadata(resolved.repo)
        : await readMetadata(resolved.repo);
    return meta?.grooming;
  } catch {
    return undefined; // unreadable / unknown-schema metadata → no config; callers default.
  }
}

/**
 * The grooming config for a resolved docs root: every field narrowed to its enum / default in a
 * SINGLE metadata read. The deep read — prefer it over the single-field convenances when a caller
 * (the nudge) wants more than one field, so the file is parsed once.
 */
export async function readGrooming(resolved: ResolvedDocsRoot): Promise<ResolvedGrooming> {
  const raw = await loadGroomingRaw(resolved);
  return {
    sensitivity: narrowSensitivity(raw?.sensitivity),
    autonomy: narrowAutonomy(raw?.autonomy),
    nudgeThrottleHours: typeof raw?.nudgeThrottleHours === "number" ? raw.nudgeThrottleHours : undefined,
    crownThreshold: typeof raw?.crownThreshold === "number" ? raw.crownThreshold : undefined,
  };
}

/** The sensitivity dial alone (ADR-0019 §7) — a one-field convenience over {@link readGrooming}. */
export async function readSensitivity(resolved: ResolvedDocsRoot): Promise<Sensitivity> {
  return (await readGrooming(resolved)).sensitivity;
}

/** The autonomy level alone (ADR-0030) — a one-field convenience over {@link readGrooming}. */
export async function readAutonomy(resolved: ResolvedDocsRoot): Promise<Autonomy> {
  return (await readGrooming(resolved)).autonomy;
}

/** True iff a grooming field is explicitly present on disk (vs. the unset default). Fail-open: false. */
export async function groomingFieldIsSet(
  resolved: ResolvedDocsRoot,
  field: keyof GroomingConfig,
): Promise<boolean> {
  return (await loadGroomingRaw(resolved))?.[field] !== undefined;
}

/**
 * Read-merge-write a grooming-field patch into `metadata.json → grooming`, PRESERVING the other
 * grooming fields, through the schema-stamping writer. Returns the path written. Throws when no
 * metadata exists (the caller resolved a KB but it has no metadata file — an interactive-command
 * error worth surfacing). mage never commits (ADR-0013): the write lands uncommitted.
 */
export async function writeGroomingField(
  resolved: ResolvedDocsRoot,
  patch: Partial<GroomingConfig>,
): Promise<string> {
  if (resolved.kind === "hub") {
    const hub = await readHubMetadata(resolved.repo);
    if (!hub) throw new Error(`No hub metadata at ${hubMetadataPath(resolved.repo)}.`);
    const grooming: GroomingConfig = { ...hub.grooming, ...patch };
    await writeHubMetadata(resolved.repo, { ...hub, grooming });
    return hubMetadataPath(resolved.repo);
  }
  const meta = await readMetadata(resolved.repo);
  if (!meta) throw new Error(`No metadata at ${metadataPath(resolved.repo)}.`);
  const grooming: GroomingConfig = { ...meta.grooming, ...patch };
  await writeMetadata(resolved.repo, { ...meta, grooming });
  return metadataPath(resolved.repo);
}
