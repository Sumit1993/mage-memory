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
import { type NoteFrontmatter, parseNote, stringifyNote } from "../../note.js";
import { resolveDocsRoot } from "../../paths.js";
import { isGeneratedArtifact } from "../../scan.js";
import { run } from "../../shell.js";
import { isCaptureInboxNote } from "./inbox.js";
import { mapType } from "./schema-map.js";

/** CC-only frontmatter keys — dropped (or extracted-then-dropped) on flatten. */
const CC_ONLY_KEYS = new Set(["name", "description", "metadata"]);

/** mage's canonical frontmatter key order, so flattened output matches authored notes. */
const MAGE_KEY_ORDER = [
  "type",
  "tags",
  "created",
  "updated",
  "last_reviewed",
  "status",
  "provenance",
  "sources",
  "keywords",
] as const;

export interface FlattenResult {
  /** The flattened note text (or the input unchanged when nothing to do). */
  text: string;
  /** True iff `text` differs from the input — the caller re-stages only when true. */
  changed: boolean;
}

/**
 * True iff this frontmatter is a Claude Code capture worth flattening — i.e. it
 * still carries `metadata.node_type: memory`. A hand-authored mage note (no nested
 * `metadata`) NEVER matches, so flatten leaves it untouched. This is the single gate
 * that makes {@link flattenCcNote} idempotent: once flattened, the `metadata` wrapper
 * is gone, so a second pass is a no-op.
 */
export function isCcShaped(fm: NoteFrontmatter): boolean {
  return isCaptureInboxNote(fm);
}

/** First `YYYY-MM-DD` of a string- or Date-ish value, else undefined. */
function isoDate(v: unknown): string | undefined {
  // YAML 1.1 parses an UNQUOTED `created: 2026-06-01` (or a full timestamp) into a JS
  // Date, not a string — accept both so a CC-restamped unquoted date is not lost.
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return undefined;
  const m = v.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : undefined;
}

/** Merge an existing `sources` array with a `cc-session:<id>` pointer, de-duped, order-stable. */
function mergeSources(existing: unknown, sessionId: string | undefined): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: unknown) => {
    if (typeof s === "string" && s.length > 0 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  if (Array.isArray(existing)) for (const s of existing) push(s);
  if (sessionId) push(`cc-session:${sessionId}`);
  return out.length > 0 ? out : undefined;
}

/**
 * Flatten one CC native-memory note's text to mage's neutral schema (FRONTMATTER ONLY;
 * the body is preserved verbatim). PURE + idempotent + fail-open. Returns the input
 * verbatim (changed:false) when the note is not CC-shaped or when parsing fails — so it
 * is always safe to run over an arbitrary tracked note.
 */
export function flattenCcNote(raw: string): FlattenResult {
  let parsed: { frontmatter: NoteFrontmatter; body: string };
  try {
    parsed = parseNote(raw);
  } catch {
    return { text: raw, changed: false }; // malformed YAML → leave it for the redaction gate / human
  }
  const fm = parsed.frontmatter;
  if (!isCcShaped(fm)) return { text: raw, changed: false };

  const meta =
    fm.metadata && typeof fm.metadata === "object" && !Array.isArray(fm.metadata)
      ? (fm.metadata as Record<string, unknown>)
      : {};

  // Preserve every NON-CC top-level key verbatim (a groomed note's tags/status/
  // provenance/keywords/unknown-vocab all survive); we re-derive type/created/sources.
  const preserved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!CC_ONLY_KEYS.has(k) && v !== undefined) preserved[k] = v;
  }

  // RECOVER each mage field from the top level OR from under `metadata` — CC's
  // restamp (observed live) buries the WHOLE authored frontmatter (tags,
  // last_reviewed, sources, keywords, …) under `metadata`, not just its own keys.
  // Top-level wins when present; otherwise pull the nested value. Only CC's internal
  // discriminators (`node_type`, `originSessionId`) are never recovered.
  const recover = (key: string): unknown =>
    preserved[key] !== undefined ? preserved[key] : meta[key];

  const sessionId = typeof meta.originSessionId === "string" ? meta.originSessionId : undefined;
  const created = isoDate(recover("created"));
  const sources = mergeSources(recover("sources"), sessionId);

  // Assemble in mage's canonical key order; append any unknown-vocab keys after.
  const out: NoteFrontmatter = {};
  // type: a top-level (authored) type is kept as-is; a nested CC type is mapped.
  out.type =
    typeof preserved.type === "string" && preserved.type.trim()
      ? preserved.type.trim()
      : mapType(typeof meta.type === "string" ? meta.type : undefined);
  const tags = recover("tags");
  if (tags !== undefined) out.tags = tags as NoteFrontmatter["tags"];
  if (created) out.created = created;
  const updated = recover("updated");
  if (updated !== undefined) out.updated = updated as string;
  const lastReviewed = recover("last_reviewed");
  if (lastReviewed !== undefined) out.last_reviewed = lastReviewed as string;
  const status = recover("status");
  if (status !== undefined) out.status = status as NoteFrontmatter["status"];
  const provenance = recover("provenance");
  if (provenance !== undefined) out.provenance = provenance as NoteFrontmatter["provenance"];
  if (sources) out.sources = sources;
  const keywords = recover("keywords");
  if (keywords !== undefined) out.keywords = keywords as string[];

  // Recover any OTHER authored open-vocab keys CC buried under metadata or left at
  // top level, dropping only CC's internal discriminators + the keys handled above.
  const HANDLED = new Set<string>([...MAGE_KEY_ORDER, "node_type", "originSessionId"]);
  for (const [k, v] of Object.entries(meta)) {
    if (!HANDLED.has(k) && !(k in out) && v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(preserved)) {
    if (!HANDLED.has(k) && v !== undefined) out[k] = v; // top-level authored extras win
  }

  // Body preserved verbatim (only a trailing newline is ensured) — never rewritten.
  let body = parsed.body ?? "";
  if (!body.endsWith("\n")) body = `${body}\n`;

  const text = stringifyNote(out, body);
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
