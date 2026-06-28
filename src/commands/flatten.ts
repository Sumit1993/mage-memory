// `mage flatten --staged` — the durable-boundary harness-format normalizer (ADR-0035).
//
// The companion to `mage redact --check --staged`: the pre-commit hook runs this
// FIRST to flatten any staged, CC-shaped note's frontmatter back to mage's neutral
// schema (and re-stage it), so the committed — durable, shared — layer is always
// neutral no matter what the working tree holds. Unlike redact, flatten NEVER blocks:
// it is a convenience normalizer, not a gate (the hook also guards with `|| true`).

import { flattenStagedNotes } from "../adapters/claude-code/flatten.js";
import { logger } from "../logger.js";

export interface FlattenOptions {
  /** Flatten staged git blobs in cwd (the pre-commit normalizer). The only mode today. */
  staged?: boolean;
  /** Suppress the report — used by the hook and by tests. */
  quiet?: boolean;
}

/**
 * Flatten staged harness-shaped notes. Fail-open and non-blocking by contract:
 * returns normally on any condition (no git, no KB, nothing to do). `--staged` is
 * required today; without it we just say so (a non-staged single-file mode can be
 * added later if a use appears).
 */
export async function flattenCmd(opts: FlattenOptions): Promise<void> {
  if (!opts.staged) {
    if (!opts.quiet) {
      logger.warn("mage flatten currently supports only --staged (the pre-commit normalizer).");
    }
    return;
  }
  const { flattened } = await flattenStagedNotes(process.cwd());
  if (opts.quiet) return;
  if (flattened.length > 0) {
    logger.info(
      `mage flatten — normalized ${flattened.length} harness-shaped note(s) at the commit boundary:`,
    );
    for (const f of flattened) logger.detail(f);
  }
}
