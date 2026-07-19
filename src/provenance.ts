// Programmatic provenance stamping at note creation (ADR-0031 Phase 1).
//
// mage's deterministic writer stamps a note's `provenance` the moment it enters
// `notes/` (the promote chokepoint) — never the host agent's discretion (an
// instruction it can forget), so attribution is reliable. Two parts:
//   - resolveCreationStamp — the I/O: read the resolved autonomy level (ADR-0030,
//     via `resolved.repo` so a hub-owned KB resolves correctly) + the repo basename
//     + the short git HEAD. Fail-open: a missing git/HEAD just omits `commit`.
//   - stampProvenance — the PURE merge into a note's frontmatter.
//
// `autonomy` is set ONLY at approver/overseer (the authorship mark the reject-ledger
// reads — absent ⇒ operator/human). `repo` + `commit` are set on EVERY creation,
// finally populating the staleness anchor no writer set before. mage's engine still
// calls no model (ADR-0009): this only reads a config field + git and merges YAML.

import { basename } from "node:path";
import { getHeadCommit } from "./git.js";
import { readAutonomy } from "./grooming/config.js";
import type { NoteFrontmatter, Provenance } from "./note.js";
import type { ResolvedDocsRoot } from "./paths.js";

/** The provenance fields mage stamps at note creation (ADR-0031). */
export interface ProvenanceStamp {
  /** Authorship — set ONLY at approver/overseer; absent ⇒ operator / human-written. */
  autonomy?: "approver" | "overseer";
  /** The KB/repo the note was created in (the git-repo basename). */
  repo?: string;
  /** Short git HEAD at creation — the `provenance.commit` staleness anchor. */
  commit?: string;
  /** Cohort mark (ADR-0031 Phase 2): "capture" (the promote chokepoint) or "adopt". */
  source?: "capture" | "adopt";
}

/**
 * Resolve the creation stamp for a docs root: `autonomy` iff the resolved level is
 * approver/overseer (read via `resolved.repo`, the hub-aware path — ADR-0030),
 * `repo` = the repo basename, `commit` = short HEAD (omitted when not a git repo),
 * `source` = "capture" (the promote chokepoint IS the fresh-capture cohort — ADR-0031 P2).
 */
export async function resolveCreationStamp(resolved: ResolvedDocsRoot): Promise<ProvenanceStamp> {
  const autonomy = await readAutonomy(resolved);
  const commit = await getHeadCommit(resolved.repo);
  return {
    ...(autonomy === "approver" || autonomy === "overseer" ? { autonomy } : {}),
    repo: basename(resolved.repo),
    ...(commit ? { commit } : {}),
    source: "capture",
  };
}

/**
 * Merge a creation stamp into a note's frontmatter (PURE). `autonomy` is always
 * applied when present in the stamp (mage owns the authorship mark); `repo`/`commit`/
 * `source` fill ONLY when absent, so a hand-authored (or an adopt-marked) provenance
 * value is never clobbered. Returns `fm` untouched when the merge would add nothing.
 */
export function stampProvenance(fm: NoteFrontmatter, stamp: ProvenanceStamp): NoteFrontmatter {
  const provenance: Provenance = { ...fm.provenance };
  if (stamp.repo !== undefined && provenance.repo === undefined) provenance.repo = stamp.repo;
  if (stamp.commit !== undefined && provenance.commit === undefined) provenance.commit = stamp.commit;
  if (stamp.source !== undefined && provenance.source === undefined) provenance.source = stamp.source;
  if (stamp.autonomy !== undefined) provenance.autonomy = stamp.autonomy;
  return Object.keys(provenance).length > 0 ? { ...fm, provenance } : fm;
}
