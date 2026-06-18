// Gate-2 staged scan (ADR-0018 §7, ADR-0014 §2). The deterministic, blocking
// half of distill's redaction gate: before a tracked commit lands, scan the
// STAGED blobs (not the worktree) for live secrets so a leak cannot be committed.
// This is the engine a `mage redact --check --staged` pre-commit hook drives.
//
// SCOPE (ADR-0014 §2): Gate-2 protects the tracked, *shared* knowledge base — the
// notes/skills mage authors under the docs root (`mage/` in-repo, or the hub root)
// — because that is the only surface mage writes to, and the seam where a distilled
// secret becomes public. It is NOT a general repo secret-scanner: application
// source (e.g. `src/`, including a redaction tool's own secret-shaped test
// fixtures) is out of scope and never scanned. So only staged files UNDER the docs
// root are scanned; a repo with no mage KB is a no-op gate.
//
// FAIL-OPEN (host-hook safety): if git is missing, the dir is not a repo, there is
// no mage KB, or any `git show` of a blob fails, we return a safe empty/partial
// result and NEVER throw — a redaction gate that crashes the host's commit would be
// worse than the leak it guards. Reachable from a pre-commit hook ⇒ must not throw.
//
// SECURITY: like redact.ts, a raw secret VALUE never leaves this module. We carry
// only the SecretFinding fields (kind/line/severity/masked-preview) plus the
// owning `file` — never the staged content itself.

import { relative, sep } from "node:path";
import {
  type RedactConfig,
  readHubMetadata,
  readMetadata,
  resolveDocsRoot,
} from "./paths.js";
import { scanSecrets, type SecretFinding } from "./redact.js";
import { matchesRedactGlob, redactIgnoreFromMetadata } from "./redactignore.js";
import { isGeneratedArtifact } from "./scan.js";
import { run } from "./shell.js";

/** A SecretFinding attributed to the staged file it was found in. */
export interface StagedFinding extends SecretFinding {
  /** Repo-relative path of the staged file the finding came from. */
  file: string;
}

/** The outcome of a staged scan: file-attributed findings + a blocking verdict. */
export interface StagedScanResult {
  findings: StagedFinding[];
  /** True iff any finding is a live secret (severity "secret") — the gate blocks. */
  blocked: boolean;
  /** How many staged files were actually scanned (skipped blobs do not count). */
  scannedFiles: number;
}

/**
 * Scan the staged (added/copied/modified) files UNDER THE MAGE DOCS ROOT in
 * `repoPath` for secrets/PII — the knowledge-base seam Gate-2 protects, not the
 * whole repo (see SCOPE above).
 *
 * The list comes from `git diff --cached --name-only --diff-filter=ACM -z`, and each
 * file's STAGED content from `git show :<file>` (the index blob, not the worktree —
 * what would actually be committed). The `-z` flag is load-bearing: without it git's
 * default `core.quotePath=true` C-quotes any non-ASCII/special-char path (e.g.
 * `"caf\303\251.env"`), which `git show :<quoted>` then rejects — silently SKIPPING a
 * real staged file from the scan (a secret-leak bypass). NUL-delimited, unquoted output
 * yields the raw path so every in-scope staged file is scanned. A finding is mapped to a
 * {@link StagedFinding} by tacking on its owning `file`. `blocked` is true iff any finding
 * is a live secret (severity "secret"); PII warns but does not block (ADR-0014 §2).
 *
 * FAIL-OPEN: if git is missing, `repoPath` is not a repo, or there is no mage KB to
 * protect, we return `{ findings: [], blocked: false, scannedFiles: 0 }` and never
 * throw. A single blob whose `git show` fails (deleted/renamed race) is SKIPPED, not
 * fatal — the rest of the batch still scans.
 */
export async function scanStaged(repoPath: string): Promise<StagedScanResult> {
  // SCOPE: resolve the mage knowledge base. No KB → nothing tracked-and-shared to
  // gate → a no-op gate (fail-open). `inScope` keeps only staged files under it.
  const docs = await resolveDocsRoot(repoPath).catch(() => null);
  if (!docs) return { findings: [], blocked: false, scannedFiles: 0 };
  const inScope = docsScopeFilter(docs.repo, docs.root);
  const toDocsRel = docsRelPathMapper(docs.repo, docs.root);
  // The false-positive allowlist now lives in `metadata.redact` (ADR-0025), not a
  // `.redactignore` file. Fail-open (empty when metadata is absent/unreadable), so a
  // missing allowlist never changes gate behavior — same contract as before.
  const ignore = redactIgnoreFromMetadata(await readRedactConfig(docs.repo, docs.kind));

  const list = await run("git", [
    "-C",
    repoPath,
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACM",
    "-z",
  ]);
  // git missing or not a repo → nothing to gate. Fail open (never throw).
  if (list.code !== 0) return { findings: [], blocked: false, scannedFiles: 0 };

  // NUL-delimited: split on "\0" and drop the trailing empty. No `.trim()` — a path
  // is taken verbatim (trimming would corrupt a name with leading/trailing spaces).
  const files = list.stdout
    .split("\0")
    .filter((l) => l.length > 0)
    .filter(inScope)
    .filter((file) => {
      // Skip mage's OWN generated artifacts (their path strings trip the high-entropy
      // detector but are never user secrets) and any path allowlisted via a
      // `metadata.redact.ignore` glob — the non-bypass override for a strict,
      // no-`--no-verify` environment.
      const rel = toDocsRel(file);
      return !isGeneratedArtifact(rel) && !matchesRedactGlob(rel, ignore);
    });

  const findings: StagedFinding[] = [];
  let scannedFiles = 0;
  for (const file of files) {
    // `:<path>` addresses the staged (index) blob — exactly what a commit writes.
    const blob = await run("git", ["-C", repoPath, "show", `:${file}`]);
    if (blob.code !== 0) continue; // deleted/renamed/binary race — skip, don't abort.
    scannedFiles += 1;
    // Map each finding to a file-attributed one. scanSecrets() already masks the
    // preview; we add ONLY the file — the raw blob never escapes this loop. Literal
    // allows are suppressed INSIDE the scanner, where the raw value is available.
    for (const f of scanSecrets(blob.stdout, ignore.literals)) {
      findings.push({ ...f, file });
    }
  }

  const blocked = findings.some((f) => f.severity === "secret");
  return { findings, blocked, scannedFiles };
}

/**
 * Build a predicate that keeps only staged paths UNDER the docs root. `git diff`
 * paths are POSIX-relative to the repo top-level; the docs root is `<repo>/mage`
 * (in-repo) or `<repo>` itself (a hub). So the in-scope prefix is `relative(repo,
 * root)` in POSIX form: "" for a hub (the whole repo IS the KB → everything in
 * scope), or e.g. "mage" in-repo (a path is in scope iff it equals the prefix or
 * sits under `prefix/`). Pure + sync.
 */
/** Docs root as a POSIX prefix relative to the repo: "" for a hub (the repo IS the
 *  KB), else e.g. "mage" in-repo. Shared by the scope filter and the docs-rel mapper. */
function docsPrefix(repo: string, root: string): string {
  return relative(repo, root).split(sep).join("/");
}

function docsScopeFilter(repo: string, root: string): (file: string) => boolean {
  const prefix = docsPrefix(repo, root);
  if (prefix === "" || prefix === ".") return () => true; // hub: the repo is the KB.
  const under = `${prefix}/`;
  return (file: string) => file === prefix || file.startsWith(under);
}

/**
 * Read a KB's `metadata.redact` allowlist from where the metadata physically lives —
 * `repo` (the code-repo root for a repo KB, the hub root for a hub/external KB). The
 * kind picks the reader (code-repo vs hub metadata). Fail-open: any read/parse error
 * → undefined, which {@link redactIgnoreFromMetadata} compiles to an empty allowlist.
 * Reachable from a pre-commit hook ⇒ must never throw.
 */
async function readRedactConfig(
  repo: string,
  kind: "repo" | "hub",
): Promise<RedactConfig | undefined> {
  try {
    const meta = kind === "repo" ? await readMetadata(repo) : await readHubMetadata(repo);
    return meta?.redact;
  } catch {
    return undefined;
  }
}

/**
 * Map a repo-relative POSIX staged path to one relative to the docs root, so it can
 * be matched against `metadata.redact.ignore` globs (which the user writes relative
 * to the KB root). In a hub the docs root IS the repo (prefix ""), so the path is
 * returned unchanged; in-repo, the `mage/` prefix is stripped. Pure + sync.
 */
function docsRelPathMapper(repo: string, root: string): (file: string) => string {
  const prefix = docsPrefix(repo, root);
  if (prefix === "" || prefix === ".") return (file) => file;
  const under = `${prefix}/`;
  return (file) => (file.startsWith(under) ? file.slice(under.length) : file);
}
