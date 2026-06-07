/**
 * Dual-mode decision helper (ADR-0017 section 4).
 *
 * mage commands run in two worlds: an interactive terminal (a human can be
 * prompted) and a non-interactive one (a hook, a pipe, CI, `--yes`). The
 * contract: a non-TTY is never interactive; a decision with neither an explicit
 * flag nor a documented default fails with a clear error naming the flag — it
 * never hangs waiting on a prompt that can't be answered, and never silently
 * guesses.
 */

/**
 * True iff both stdin and stdout are attached to a TTY. `isTTY` is `true` on a
 * real terminal and `undefined` when the stream is piped or redirected, so we
 * require an explicit `=== true` on both ends.
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Arguments for {@link resolveDecision}. */
export interface ResolveDecisionArgs<T> {
  /** Explicit flag value. When defined it wins outright (highest precedence). */
  flagValue: T | undefined;
  /** `--yes`: force the non-interactive branch even inside a TTY. */
  yes?: boolean;
  /** Thunk that prompts the user; only invoked on the interactive path. */
  interactive: () => Promise<T>;
  /** Documented default used on the non-interactive path. */
  fallback?: { value: T };
  /** Flag name (without leading dashes) surfaced in the no-default error. */
  flagName: string;
}

/**
 * Resolve a decision across interactive and non-interactive modes.
 *
 * Precedence:
 *   1. explicit `flagValue` (if defined) — flag always wins;
 *   2. non-interactive (`--yes` or not a TTY) — use `fallback.value`, or throw
 *      naming the flag when there is no documented default;
 *   3. interactive — await the prompt thunk.
 */
export async function resolveDecision<T>(args: ResolveDecisionArgs<T>): Promise<T> {
  const { flagValue, yes, interactive, fallback, flagName } = args;

  if (flagValue !== undefined) {
    return flagValue;
  }

  if (yes || !isInteractive()) {
    if (fallback) {
      return fallback.value;
    }
    throw new Error(
      `Non-interactive (no TTY or --yes): pass --${flagName}.`,
    );
  }

  return await interactive();
}
