// The NON-BYPASS false-positive allowlist for the Gate-2 staged scan — compiled.
// The allowlist is KB config, sourced from `metadata.redact` (ADR-0025; it was a
// `.redactignore` file before the state fold). Two kinds of confirmed false positive:
//   - `ignore` — a path GLOB (relative to the docs root) → that staged file is not scanned;
//   - `allow`  — an exact matched VALUE that is never treated as a secret.
// This module is the COMPILER: it turns the raw {@link RedactConfig} strings (or the
// legacy line-based file text, via {@link parseRedactIgnoreFile} — kept so `mage migrate`
// can fold an existing `.redactignore` into metadata) into adjacency-collapsed,
// anchored globs (no stacked ambiguous wildcard runs) + a literal set.
//
// FAIL-OPEN (host-hook safety): missing/empty config yields an empty allowlist and
// NEVER throws — reachable from a pre-commit hook (see staged-scan).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RedactConfig } from "./paths.js";

export interface RedactIgnore {
  /** Compiled, anchored path-glob matchers (relative to the docs root). */
  globs: RegExp[];
  /** Literal matched-values to treat as non-secret (exact match on the raw value). */
  literals: Set<string>;
}

const LITERAL_PREFIX = "literal:";
/**
 * The legacy on-disk allowlist filename (pre-ADR-0025). No longer a live source —
 * the allowlist lives in `metadata.redact` now — but `mage migrate` still reads a
 * leftover file at the docs root to FOLD it into metadata (then deletes it). Local
 * to this module; not a paths.ts product noun anymore.
 */
const REDACTIGNORE_FILENAME = ".redactignore";

/** A FRESH empty allowlist — never a shared instance, so a caller that mutates one
 *  result's `literals`/`globs` can never poison a later fail-open result. */
function empty(): RedactIgnore {
  return { globs: [], literals: new Set() };
}

/**
 * Compile a KB's `metadata.redact` allowlist into matchers. `ignore` globs become
 * anchored path RegExps; `allow` values become literal suppressions. Fail-open:
 * absent/empty config → an empty allowlist (never throws), so a missing allowlist
 * never changes gate behavior. Pure.
 */
export function redactIgnoreFromMetadata(redact?: RedactConfig): RedactIgnore {
  if (!redact) return empty();
  const globs = (redact.ignore ?? [])
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map(globToRegExp);
  const literals = new Set<string>();
  for (const value of redact.allow ?? []) {
    const trimmed = value.trim();
    if (trimmed) literals.add(trimmed);
  }
  return { globs, literals };
}

/**
 * Parse legacy `.redactignore` file text into a {@link RedactConfig} (the
 * metadata-shaped form `mage migrate` folds in). Two entry kinds, one per line: a
 * bare line is a path glob (→ `ignore`); a `literal:<value>` line whitelists an
 * exact value (→ `allow`); `#` lines and blanks are ignored. Pure.
 */
export function parseRedactIgnoreFile(text: string): RedactConfig {
  const ignore: string[] = [];
  const allow: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(LITERAL_PREFIX)) {
      const value = trimmed.slice(LITERAL_PREFIX.length).trim();
      if (value) allow.push(value);
      continue;
    }
    ignore.push(trimmed);
  }
  return { ignore, allow };
}

/**
 * Read a leftover `<docsRoot>/.redactignore` file and parse it into a
 * {@link RedactConfig}, or null when absent/unreadable. Used ONLY by `mage migrate`
 * to fold a pre-ADR-0025 file into `metadata.redact`. Never throws.
 */
export async function readRedactIgnoreFile(docsRoot: string): Promise<RedactConfig | null> {
  let raw: string;
  try {
    raw = await readFile(join(docsRoot, REDACTIGNORE_FILENAME), "utf8");
  } catch {
    return null;
  }
  return parseRedactIgnoreFile(raw);
}

/** True iff `docsRelPath` (POSIX, relative to the docs root) matches any glob. */
export function matchesRedactGlob(docsRelPath: string, ignore: RedactIgnore): boolean {
  return ignore.globs.some((re) => re.test(docsRelPath));
}

/**
 * Compile a minimal gitignore-ish glob to an anchored, backtrack-bounded RegExp:
 *   `**` → any run including `/`;  `*` → any run except `/`;  `?` → one non-`/`
 *   char;  a trailing `/` → a directory prefix (matches the dir and all beneath).
 * Every other regex metacharacter is escaped. Matched against a docs-root-relative
 * POSIX path.
 *
 * ReDoS shape (latent since #26): a naive `*`→`[^/]*` / `**`→`.*` emission lets two
 * greedy runs split by a failing literal tail catastrophically backtrack — e.g.
 * `('a*'×12)+'!'` compiled to `a[^/]*a[^/]*…!` takes ~60s against `'a'×40`, and that
 * compile is reachable from the live pre-commit hook (matchesRedactGlob, staged-scan).
 * Two defenses keep the output linear:
 *   1. ADJACENCY-COLLAPSE — a wildcard run identical to the one just emitted (no
 *      literal between) is dropped, so consecutive stars never stack (two `[^/]*`
 *      runs collapse to one; stacked `**` runs collapse likewise).
 *   2. ATOMIC RUNS — each surviving wildcard run is emitted as an atomic group
 *      `(?=(run<tail>))\N` that swallows the literal text following it in the same
 *      segment, so the run commits once it matches and can never backtrack to re-share
 *      characters with a later run. That kills the only remaining catastrophic shape.
 * The atomic form is exact for real path globs. Its lone divergence from a plain
 * backtracking matcher is in the SAFE direction: a contrived leading-`**`-then-slash
 * pattern won't match a zero-segment path, so a redact-IGNORE glob can at worst skip
 * skipping (the file is then scanned) — never the reverse.
 */
export function globToRegExp(glob: string): RegExp {
  const dirPrefix = glob.endsWith("/");
  const core = dirPrefix ? glob.slice(0, -1) : glob;
  const tokens = core.match(/\*\*|[*?]|[^*?]+/g) ?? [];
  // Pre-compile each token to its regex atom; `star` marks a wildcard run.
  const atoms = tokens.map((tok) => {
    if (tok === "**") return { star: "[\\s\\S]*" };
    if (tok === "*") return { star: "[^/]*" };
    if (tok === "?") return { lit: "[^/]" };
    return { lit: tok.replace(/[.+^${}()|[\]\\]/g, "\\$&") };
  });
  let group = 0;
  let body = "";
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (!atom) continue;
    if (atom.lit !== undefined) {
      body += atom.lit;
      continue;
    }
    // (1) Collapse a wildcard run identical to its immediate neighbor — two stacked
    //     ambiguous runs are the catastrophic shape; one run is the same language.
    if (atoms[i + 1]?.star === atom.star) continue;
    // (2) Make this run atomic by folding the rest of the segment's literal text into
    //     the lookahead, so the run commits once matched and never re-shares chars
    //     with a later run (no cross-run backtracking).
    let tail = "";
    let j = i + 1;
    for (let next = atoms[j]; next?.lit !== undefined; next = atoms[++j]) {
      tail += next.lit;
    }
    group += 1;
    body += `(?=(${atom.star}${tail}))\\${group}`;
    i = j - 1;
  }
  // A trailing-slash pattern matches the dir itself and everything underneath it.
  const suffix = dirPrefix ? "(?:/[\\s\\S]*)?" : "";
  return new RegExp(`^${body}${suffix}$`);
}
