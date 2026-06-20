// The hub fan-out nudge shared by `mage distill` and `mage promote`. Both engines
// are deliberately SINGLE-SCOPE (Decision 1 / ADR-0011): at a hub root a bare run
// reads only the hub's OWN `.mage/learnings/`, never a mixed manifest across the
// registered projects (so session ids stay unambiguous). When projects exist that
// silence is easy to misread as "nothing to groom" — this points the human at the
// per-root fan-out instead. It reuses the ONE `ownedDocsRoots` enumerator, so the
// hint can never disagree with what the fan-out actually grooms.

import { logger } from "../logger.js";
import { ownedDocsRoots, type ResolvedDocsRoot } from "../paths.js";

/**
 * In READ + HUMAN output only (callers gate on `!asJson` so the `--json` line the
 * `mage:groom` skill consumes is never polluted), print a one-line nudge when a bare
 * engine run sits at a hub ROOT that owns registered projects: those projects are NOT
 * in this manifest and are reached only by the per-root fan-out. No-op for a repo KB,
 * a hub-owned project (root ≠ repo), or a hub with no registered projects.
 */
export async function reportHubFanout(
  resolved: ResolvedDocsRoot,
  engine: "distill" | "promote",
): Promise<void> {
  if (resolved.kind !== "hub" || resolved.root !== resolved.repo) return;
  const owned = await ownedDocsRoots(resolved);
  if (owned.length <= 1) return; // hub root with no registered projects — nothing to fan out to.
  logger.blank();
  logger.step(
    `Hub root: ${owned.length - 1} registered project(s) are NOT in this manifest. ` +
      `Run \`mage groom\` (fans out per project) or \`mage ${engine} --dir <project>\` to cover them.`,
  );
}
