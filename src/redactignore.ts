// `mage/.redactignore` — the NON-BYPASS false-positive allowlist for the Gate-2
// staged scan (0.0.12). A COMMITTED, shared file (NOT git-ignored) that lets a
// strict, no-`--no-verify` environment confirm a redaction false positive without
// disabling the pre-commit hook. Two entry kinds, one per line:
//   - a path GLOB (relative to the docs root) → that staged file is not scanned;
//   - `literal:<value>` → that exact matched value is never treated as a secret.
// Bare lines are globs (the common case: "this generated/fixture file is safe");
// `#` lines and blanks are ignored.
//
// FAIL-OPEN (host-hook safety): a missing/unreadable file yields an empty
// allowlist and NEVER throws — reachable from a pre-commit hook (see staged-scan).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REDACTIGNORE_FILE } from "./paths.js";

export interface RedactIgnore {
  /** Compiled, anchored path-glob matchers (relative to the docs root). */
  globs: RegExp[];
  /** Literal matched-values to treat as non-secret (exact match on the raw value). */
  literals: Set<string>;
}

const LITERAL_PREFIX = "literal:";

/** A FRESH empty allowlist — never a shared instance, so a caller that mutates one
 *  result's `literals`/`globs` can never poison a later fail-open result. */
function empty(): RedactIgnore {
  return { globs: [], literals: new Set() };
}

/** Read + parse `<docsRoot>/.redactignore`. Fail-open: missing/unreadable → empty. */
export async function readRedactIgnore(docsRoot: string): Promise<RedactIgnore> {
  let raw: string;
  try {
    raw = await readFile(join(docsRoot, REDACTIGNORE_FILE), "utf8");
  } catch {
    return empty();
  }
  return parseRedactIgnore(raw);
}

/** Parse `.redactignore` text into compiled globs + literal allows. Pure. */
export function parseRedactIgnore(text: string): RedactIgnore {
  const globs: RegExp[] = [];
  const literals = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(LITERAL_PREFIX)) {
      const value = trimmed.slice(LITERAL_PREFIX.length).trim();
      if (value) literals.add(value);
      continue;
    }
    globs.push(globToRegExp(trimmed));
  }
  return { globs, literals };
}

/** True iff `docsRelPath` (POSIX, relative to the docs root) matches any glob. */
export function matchesRedactGlob(docsRelPath: string, ignore: RedactIgnore): boolean {
  return ignore.globs.some((re) => re.test(docsRelPath));
}

/**
 * Compile a minimal gitignore-ish glob to an anchored, ReDoS-safe RegExp:
 *   `**` → any run including `/`;  `*` → any run except `/`;  `?` → one non-`/`
 *   char;  a trailing `/` → a directory prefix (matches the dir and all beneath).
 * Every other regex metacharacter is escaped. The tokenizer is bounded (no nested
 * quantifiers) and the output uses only linear `.*` / `[^/]*` runs — never a
 * catastrophic-backtracking shape. Matched against a docs-root-relative POSIX path.
 */
export function globToRegExp(glob: string): RegExp {
  const dirPrefix = glob.endsWith("/");
  const core = dirPrefix ? glob.slice(0, -1) : glob;
  const body = core.replace(/\*\*|[*?]|[^*?]+/g, (tok) => {
    if (tok === "**") return ".*";
    if (tok === "*") return "[^/]*";
    if (tok === "?") return "[^/]";
    return tok.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  });
  // A trailing-slash pattern matches the dir itself and everything underneath it.
  const suffix = dirPrefix ? "(?:/.*)?" : "";
  return new RegExp(`^${body}${suffix}$`);
}
