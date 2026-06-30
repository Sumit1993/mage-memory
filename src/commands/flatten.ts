// `mage flatten` — the harness-format normalizer (ADR-0035), in two modes:
//
//   - `--staged` (the pre-commit hook): flatten staged, CC-shaped notes' frontmatter
//     back to mage's neutral schema and re-stage them, so the committed — durable,
//     shared — layer is always neutral. This is the GUARANTEE; pairs with
//     `mage redact --check --staged`.
//   - default / no flag (the Stop hook): sweep the WORKING TREE for notes CC restamped
//     this turn and flatten them in place, keeping the worktree neutral between commits.
//
// Unlike redact, flatten NEVER blocks — a convenience normalizer, not a gate (the
// hooks also guard with `|| true`). Fail-open: returns normally on any condition.

import { flattenStagedNotes, flattenWorktreeNotes } from "../adapters/claude-code/flatten.js";
import { logger } from "../logger.js";

export interface FlattenOptions {
  /** Flatten staged git blobs (the pre-commit guarantee). Default: sweep the working tree. */
  staged?: boolean;
  /** Suppress the report — used by the hooks and by tests. */
  quiet?: boolean;
}

/** Flatten harness-shaped notes — staged (commit boundary) or the working tree (Stop). */
export async function flattenCmd(opts: FlattenOptions): Promise<void> {
  const { flattened } = opts.staged
    ? await flattenStagedNotes(process.cwd())
    : await flattenWorktreeNotes(process.cwd());
  if (opts.quiet) return;
  if (flattened.length > 0) {
    const where = opts.staged ? "at the commit boundary" : "in the working tree";
    logger.info(`mage flatten — normalized ${flattened.length} harness-shaped note(s) ${where}:`);
    for (const f of flattened) logger.detail(f);
  }
}
