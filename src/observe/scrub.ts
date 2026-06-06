// Gate-1 scrub wrapper around the shared `redact()` engine (ADR-0014 / ADR-0015
// §5). SCRUB-ONLY, never-block: unlike `redactCmd` this never inspects
// hasLiveSecret and never exits non-zero — it scrubs the free-text field and
// continues. FAIL-CLOSED: any throw from redact() yields the sentinel, never the
// raw input, so a redactor bug can never park a raw secret in `.learnings/`.

import { redact } from "../redact.js";

/**
 * Fail-closed sentinel for a redactor throw. Shaped to MATCH the redact()
 * marker grammar (`[REDACTED:<kind>]`) so it round-trips through the
 * idempotency no-op on any downstream re-scrub (addresses the LOW finding that
 * `[REDACT-ERROR]` is outside the marker grammar).
 */
export const REDACT_ERROR_MARKER = "[REDACTED:redact-error]";

/**
 * Pre-scrub input ceiling above `maxLen`. `observe` runs on every hook, so scrubbing
 * a multi-MB field at full length would make redact()'s whole ruleset scan unbounded,
 * untrusted-size input on the hot path. We slice to `maxLen + SCRUB_HEADROOM` BEFORE
 * scrubbing — the headroom is far larger than the longest detector token (~512), so a
 * secret straddling `maxLen` is still seen in full and the scrub-before-truncate
 * guarantee holds; only bytes that would be truncated away anyway are dropped early.
 */
export const SCRUB_HEADROOM = 4096;

/**
 * Scrub one free-text field then bound it. Steps:
 *   1. null/undefined → null.
 *   2. slice to `maxLen + SCRUB_HEADROOM` so redact() never scans unbounded input.
 *   3. redact(...).text via the shared engine (full ruleset incl. entropy).
 *   4. truncate to `maxLen` AFTER scrub — so a secret straddling the cap cannot
 *      leak a tail (scrub sees the full value first).
 *   5. on ANY throw from redact → REDACT_ERROR_MARKER (never the raw input).
 * Structured identifiers (paths/tool/hashes/cwd) are NEVER passed here.
 */
export function scrubField(
  raw: string | null | undefined,
  maxLen: number,
): string | null {
  if (raw === null || raw === undefined) return null;
  try {
    const ceiling = maxLen + SCRUB_HEADROOM;
    const bounded = raw.length > ceiling ? raw.slice(0, ceiling) : raw;
    const scrubbed = redact(bounded).text;
    return scrubbed.length > maxLen ? scrubbed.slice(0, maxLen) : scrubbed;
  } catch {
    return REDACT_ERROR_MARKER;
  }
}
