// Harness-format flatten (ADR-0035): normalize a Claude Code native-memory note
// back to mage's neutral, flat note schema — at the DURABLE boundary, not at
// write-time. ADR-0032 tried to win the format at the PreToolUse write; CC
// re-normalizes a memory file's frontmatter AFTER the hook (and the restamp is
// async — it can land after the tool returns), so that fight is unwinnable. The
// durable layer instead becomes neutral here: the commit-time gate
// ({@link flattenStagedNotes}) flattens any tracked CC-shaped note before it is
// committed, so git is ALWAYS neutral no matter what shape the working tree holds.
//
// Two surfaces:
//   - {@link flattenCcNote} — the PURE, idempotent text→text transform (the keystone).
//   - {@link flattenStagedNotes} — the git plumbing that runs it over staged blobs
//     and re-stages the result (mirrors staged-scan.ts / the Gate-2 redaction hook).
//
// SCOPE: flatten normalizes FRONTMATTER ONLY. CC's restamp (observed live) buries the
// WHOLE authored frontmatter under `metadata` and blanks `name` — e.g. `name: ""` +
// `metadata: { node_type: memory, type, tags, created, last_reviewed, sources, keywords }`.
// So flatten RECOVERS every mage field from the top level OR from under `metadata`
// (top-level wins), dropping only CC's internal discriminators (`node_type`,
// `originSessionId`) and the `name`/`description`/`metadata` wrapper;
// `metadata.originSessionId` becomes a `cc-session:` source. Recovery (not mere
// top-level preservation) is load-bearing: a restamped authored/groomed note would
// otherwise lose its tags, last_reviewed, sources, and keywords at the durable
// boundary. The BODY is left byte-for-byte intact: markdown is already neutral,
// and an authored `[[wikilink]]` is Obsidian-native (ADR-0008) — rewriting it at the
// durable boundary would MANGLE a legitimate note (the ADR Gate's KILL condition).
// Body enrichment for a brand-new capture (H1 from name, description fold, flat-link
// conversion) is the job of the fresh-capture ingest/groom path (inbox.ts mapInboxNote),
// not this format normalizer. FAIL-OPEN: malformed/odd input returns unchanged.

import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { parseNote, stringifyNote } from "../../note.js";
import { resolveDocsRoot } from "../../paths.js";
import { isGeneratedArtifact, listNotePaths } from "../../scan.js";
import { run } from "../../shell.js";
import { isCcShaped, recoverCcFrontmatter } from "./cc-note.js";

export interface FlattenResult {
  /** The flattened note text (or the input unchanged when nothing to do). */
  text: string;
  /** True iff `text` differs from the input — the caller re-stages only when true. */
  changed: boolean;
}

/**
 * Flatten one CC native-memory note's text to mage's neutral schema (FRONTMATTER ONLY;
 * the body is preserved verbatim). PURE + idempotent + fail-open. Returns the input
 * verbatim (changed:false) when the note is not CC-shaped or when parsing fails — so it
 * is always safe to run over an arbitrary tracked note. The CC-shape predicate and the
 * field recovery both live in the cc-note adapter; this is the text↔text + git wrapper.
 */
export function flattenCcNote(raw: string): FlattenResult {
  let parsed: ReturnType<typeof parseNote>;
  try {
    parsed = parseNote(raw);
  } catch {
    return { text: raw, changed: false }; // malformed YAML → leave it for the redaction gate / human
  }
  if (!isCcShaped(parsed.frontmatter)) return { text: raw, changed: false };

  const { frontmatter } = recoverCcFrontmatter(parsed.frontmatter);

  // Body preserved verbatim (only a trailing newline is ensured) — never rewritten.
  let body = parsed.body ?? "";
  if (!body.endsWith("\n")) body = `${body}\n`;

  const text = stringifyNote(frontmatter, body);
  return { text, changed: text !== raw };
}

// ─── commit-time gate (mirrors staged-scan.ts scope discipline) ────────────────

export interface FlattenStagedResult {
  /** Repo-relative POSIX paths whose note was flattened. */
  flattened: string[];
}

/** Git toplevel + a docs-root scope predicate/mapper, or null (no repo / no KB). */
interface DocsScope {
  top: string;
  inScope: (f: string) => boolean;
  toDocsRel: (f: string) => string;
}

/**
 * Resolve the git toplevel for `repoPath` plus a scope filter for paths under the mage
 * docs root. git's `--name-only` output is TOPLEVEL-relative, so all git ops and
 * worktree writes key off `top`. Returns null (fail-open) when there's no repo or no KB.
 */
async function resolveDocsScope(repoPath: string): Promise<DocsScope | null> {
  const docs = await resolveDocsRoot(repoPath).catch(() => null);
  if (!docs) return null;
  const topRes = await run("git", ["-C", repoPath, "rev-parse", "--show-toplevel"]);
  if (topRes.code !== 0) return null;
  const top = topRes.stdout.trim();
  if (!top) return null;
  const prefix = relative(top, docs.root).split(sep).join("/");
  const flat = prefix === "" || prefix === ".";
  return {
    top,
    inScope: flat ? () => true : (f) => f === prefix || f.startsWith(`${prefix}/`),
    toDocsRel: flat ? (f) => f : (f) => (f.startsWith(`${prefix}/`) ? f.slice(prefix.length + 1) : f),
  };
}

let flattenSeq = 0;

/**
 * Flatten the INDEX blob for `file` WITHOUT touching the worktree — used for a file
 * that has unstaged worktree edits, so we normalize the durable (staged) layer while
 * leaving the user's in-progress edits intact. Writes a fresh blob (`hash-object -w`,
 * with `--path` so any clean filter matches how git would store it) and points the
 * index entry at it (`update-index --cacheinfo`, preserving the file mode). Fail-open.
 */
async function restageIndexBlob(top: string, file: string, text: string): Promise<boolean> {
  const ls = await run("git", ["-C", top, "ls-files", "--stage", "--", file]);
  if (ls.code !== 0) return false;
  const mode = ls.stdout.trim().split(/\s+/)[0];
  if (!/^\d{6}$/.test(mode ?? "")) return false;
  const tmp = join(tmpdir(), `mage-flatten-${process.pid}-${flattenSeq++}.md`);
  try {
    await writeFile(tmp, text);
    const hash = await run("git", ["-C", top, "hash-object", "-w", "--path", file, tmp]);
    if (hash.code !== 0) return false;
    const sha = hash.stdout.trim();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) return false;
    const upd = await run("git", ["-C", top, "update-index", "--cacheinfo", `${mode},${sha},${file}`]);
    return upd.code === 0;
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Flatten every TRACKED, STAGED, CC-shaped note under the mage docs root, re-staging
 * each — the durable-boundary normalizer the pre-commit hook drives (`mage flatten
 * --staged`). SCOPE mirrors staged-scan.ts: only staged files under the docs root,
 * skipping mage's own generated artifacts. The guarantee (git is always neutral) holds
 * for EVERY staged note:
 *   - a CLEAN note (worktree == index) is flattened in the worktree and re-added, so
 *     `git status` stays clean afterwards;
 *   - a DIRTY note (unstaged worktree edits present) is flattened in the INDEX ONLY, so
 *     the durable/staged blob is neutral while the user's unstaged edits are untouched.
 * Paths are resolved against the git TOPLEVEL (git's `--name-only` output is
 * toplevel-relative), so a manual run from a subdirectory works too. FAIL-OPEN end to
 * end: missing git / non-repo / no-KB yields an empty result, any per-file error skips
 * that file, and if the dirtiness probe fails we treat ALL files as dirty (index-only —
 * the safe direction that never overwrites a worktree edit). A normalizer must NEVER
 * block or break a commit (the hook also guards with `|| true`).
 */
export async function flattenStagedNotes(repoPath: string): Promise<FlattenStagedResult> {
  const empty: FlattenStagedResult = { flattened: [] };
  const scope = await resolveDocsScope(repoPath);
  if (!scope) return empty;
  const { top, inScope, toDocsRel } = scope;

  const list = await run("git", [
    "-C",
    top,
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACM",
    "-z",
  ]);
  if (list.code !== 0) return empty;
  const staged = list.stdout
    .split("\0")
    .filter((l) => l.length > 0)
    .filter(inScope)
    .filter((f) => !isGeneratedArtifact(toDocsRel(f)));
  if (staged.length === 0) return empty;

  // Files with UNSTAGED worktree edits take the index-only path. If the probe itself
  // FAILS, treat everything as dirty (index-only) — never risk overwriting a worktree edit.
  const probe = await run("git", ["-C", top, "diff", "--name-only", "-z"]);
  const probeFailed = probe.code !== 0;
  const dirty = new Set(probeFailed ? [] : probe.stdout.split("\0").filter((l) => l.length > 0));

  const result: FlattenStagedResult = { flattened: [] };
  for (const file of staged) {
    try {
      const isDirty = probeFailed || dirty.has(file);
      // Source to flatten: a clean file's worktree == index (read it directly, preserving
      // its exact bytes/line-endings); a dirty file must use the staged index blob.
      let srcText: string;
      if (isDirty) {
        const blob = await run("git", ["-C", top, "show", `:${file}`]);
        if (blob.code !== 0) continue; // deleted/renamed race — skip, don't abort.
        srcText = blob.stdout;
      } else {
        srcText = await readFile(resolve(top, file), "utf8");
      }
      const { text, changed } = flattenCcNote(srcText);
      if (!changed) continue; // not CC-shaped / already flat → nothing to do.
      if (isDirty) {
        if (await restageIndexBlob(top, file, text)) result.flattened.push(file);
      } else {
        await writeFile(resolve(top, file), text);
        const add = await run("git", ["-C", top, "add", "--", file]);
        if (add.code === 0) result.flattened.push(file);
      }
    } catch {
      // Fail-open per file: a single pathological note never breaks the commit.
    }
  }
  return result;
}

/**
 * Sweep the WORKING TREE for notes CC restamped this turn and flatten them in place —
 * the ADR-0035 `Stop`-hook normalizer (`mage flatten`, no `--staged`). It runs at
 * turn-end, AFTER CC's async restamp has settled, so it catches what a write-time hook
 * would fire too early to see. SCOPE is the cheap, correct set: the worktree-MODIFIED +
 * UNTRACKED `.md` files under the docs root (exactly the notes CC just touched) — not a
 * full-KB walk. It rewrites the worktree only (Stop is NOT commit time; nothing is
 * staged — mage never auto-stages); the pre-commit flatten stays the durable guarantee.
 * FAIL-OPEN end to end: no repo / no KB / any per-file error → skip, never throw or block.
 */
export async function flattenWorktreeNotes(repoPath: string): Promise<FlattenStagedResult> {
  const empty: FlattenStagedResult = { flattened: [] };
  const scope = await resolveDocsScope(repoPath);
  if (!scope) return empty;
  const { top, inScope, toDocsRel } = scope;

  // The notes CC could have restamped this turn: worktree-modified (a tracked note
  // CC rewrote) + untracked (a brand-new capture). Union, NUL-delimited.
  const modified = await run("git", ["-C", top, "diff", "--name-only", "-z"]);
  const untracked = await run("git", ["-C", top, "ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = new Set<string>([
    ...(modified.code === 0 ? modified.stdout.split("\0").filter((l) => l.length > 0) : []),
    ...(untracked.code === 0 ? untracked.stdout.split("\0").filter((l) => l.length > 0) : []),
  ]);
  const candidates = [...paths]
    .filter(inScope)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !isGeneratedArtifact(toDocsRel(f)));

  const result: FlattenStagedResult = { flattened: [] };
  for (const file of candidates) {
    try {
      const abs = resolve(top, file);
      const { text, changed } = flattenCcNote(await readFile(abs, "utf8"));
      if (!changed) continue; // not CC-shaped / already flat → nothing to do.
      await writeFile(abs, text);
      result.flattened.push(file);
    } catch {
      // Fail-open per file: a normalizer must never break the agent's turn.
    }
  }
  return result;
}

/**
 * Sweep EVERY note under the mage docs root, regardless of git state — the ADR-0035
 * BACKFILL mode (`mage flatten --all`). {@link flattenWorktreeNotes} and
 * {@link flattenStagedNotes} only ever reach a note that git currently reports as
 * modified/untracked/staged; a CC-shaped note committed BEFORE the flatten boundary
 * existed is clean and untouched by either, so it stays harness-shaped forever unless
 * something walks the whole tree once. This is that one-time (or periodic) full sweep:
 * enumerate every `.md` under the docs root ({@link listNotePaths} — the same
 * SKIP_DIRS/reserved-name discipline `scanNotes` uses for `mage index`), skip anything
 * mage generates ({@link isGeneratedArtifact}), then run the identical
 * flatten-if-CC-shaped/write/re-flatten-is-a-noop pipeline as the other two sweeps.
 * Every candidate here is already rooted AT the docs root by construction, so there is
 * no separate `inScope` predicate to apply (unlike the git-diff-derived candidate
 * lists above, which must filter an arbitrary repo-wide path list down to the KB).
 *
 * This mode enumerates from the docs root, NOT from git, so it must run in a
 * standalone/non-git KB too — hence it resolves the root via {@link resolveDocsRoot}
 * (the git-free resolver `mage index` uses), NOT `resolveDocsScope` (which is git-gated
 * and would wrongly no-op a non-repo KB, contradicting the "regardless of git state"
 * contract). git is consulted only best-effort, to report toplevel-relative paths that
 * match the other two sweeps when this IS a repo; a standalone KB falls back to
 * docs-root-relative paths.
 *
 * FAIL-OPEN end to end: no KB → empty result; any per-file error is skipped, never
 * thrown. Does not stage or touch the index (no worktree-vs-index games) — this mode
 * only rewrites files that are already clean in git's eyes, so nothing new becomes
 * "dirty" that wasn't already going to be flattened identically on its next natural
 * pass through the Stop/pre-commit sweeps.
 */
export async function flattenAllNotes(repoPath: string): Promise<FlattenStagedResult> {
  const empty: FlattenStagedResult = { flattened: [] };
  const docs = await resolveDocsRoot(repoPath).catch(() => null);
  if (!docs) return empty;
  const root = docs.root;

  // Best-effort git toplevel so reported paths match the other sweeps (toplevel-relative)
  // when this is a repo; a standalone KB reports docs-root-relative paths (top === root).
  const topRes = await run("git", ["-C", repoPath, "rev-parse", "--show-toplevel"]);
  const top = topRes.code === 0 && topRes.stdout.trim() ? topRes.stdout.trim() : root;

  // listNotePaths returns paths already relative to the docs root — exactly the shape
  // isGeneratedArtifact expects — so no separate inScope/toDocsRel mapping is needed here.
  const relPaths = (await listNotePaths(root).catch(() => [] as string[])).filter(
    (f) => !isGeneratedArtifact(f),
  );

  const result: FlattenStagedResult = { flattened: [] };
  for (const rel of relPaths) {
    try {
      const abs = resolve(root, rel);
      const { text, changed } = flattenCcNote(await readFile(abs, "utf8"));
      if (!changed) continue; // not CC-shaped / already flat → nothing to do.
      await writeFile(abs, text);
      result.flattened.push(relative(top, abs).split(sep).join("/"));
    } catch {
      // Fail-open per file: a full-KB sweep must never abort on one pathological note.
    }
  }
  return result;
}
