import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { logger } from "./logger.js";
import {
  type Note,
  type NoteFrontmatter,
  deriveKeywords,
  effectiveFrontmatter,
  noteTitle,
  noteWings,
  readNote,
} from "./note.js";
import {
  AGENTS_FILE,
  AGENTS_SKILLS_DIR,
  ARCHIVE_DIR,
  ARTIFACTS_DIRNAME,
  CLAUDE_DIR,
  CLAUDE_FILE,
  GIT_DIR,
  IDENTITY_FILE,
  INDEX_FILE,
  MEMORY_FILE,
  NODE_MODULES_DIR,
  OBSIDIAN_DIR,
  STATE_DIR,
} from "./paths.js";

/** Sentinel wing key for untagged / cross-cutting notes. */
export const CROSS = "";

/**
 * Directories the scanner never descends into — the correctness boundary
 * (ADR-0011 §2). Sourced from paths.ts so the boundary has a single home.
 * NOTE: `projects/` is deliberately ABSENT — a hub's project notes ARE indexed.
 */
const SKIP_DIRS = new Set<string>([
  OBSIDIAN_DIR,
  GIT_DIR,
  NODE_MODULES_DIR,
  ARTIFACTS_DIRNAME,
  STATE_DIR, // ALL machine-written transient state (learnings/metrics/staging) — never indexed (ADR-0025)
  ARCHIVE_DIR,
  CLAUDE_DIR,
  AGENTS_SKILLS_DIR,
]);

/**
 * mage-authored `.md` files that are NOT knowledge notes. Skipped everywhere so
 * a recursive walk from the docs root never ingests its own generated index or
 * a hub's scaffolding (which live AT the root). `_index.<wing>.md` is matched by
 * pattern; the rest by exact name. This namespace is reserved.
 */
const RESERVED_MD = new Set<string>([
  INDEX_FILE,
  MEMORY_FILE, // the Claude Code adapter index twin (ADR-0032) — generated, never a note
  IDENTITY_FILE,
  AGENTS_FILE,
  CLAUDE_FILE,
  // The generated dashboard (ADR-0020 tier 0) lives AT the docs root and is not a
  // knowledge note — never ingest it into the index. (Knowledge.base is not `.md`,
  // so the walk skips it already.)
  "Dashboard.md",
]);
const GEN_INDEX_RE = /^_index\..+\.md$/;

/**
 * True iff a DOCS-ROOT-RELATIVE POSIX path (e.g. `INDEX.md`, `notes/x.md`,
 * `.claude/skills/g/SKILL.md`) points at a mage-GENERATED artifact, not an authored
 * note. Reused by the Gate-2 staged-redaction scan to skip files mage writes itself
 * (their PATH strings can trip the high-entropy detector but are never user
 * secrets — ADR-0014). SECURITY: the fixed scaffolding names ({@link RESERVED_MD})
 * are matched ONLY at the docs root, because mage generates them there — a
 * user-AUTHORED file that merely shares the basename in a subdirectory (e.g.
 * `notes/INDEX.md`) MUST still be secret-scanned, never skipped. Per-wing indexes
 * (`_index.*.md`) and host skill/config dirs (`.claude/`, `.agents/`) ARE generated
 * at any depth. Pure + sync.
 */
export function isGeneratedArtifact(docsRelPath: string): boolean {
  const segments = docsRelPath.split("/");
  // Host skill/config dirs mage owns — generated at any depth.
  if (segments.some((s) => s === CLAUDE_DIR || s === AGENTS_SKILLS_DIR)) return true;
  const base = segments[segments.length - 1] ?? "";
  // Per-wing indexes are generated at any depth.
  if (GEN_INDEX_RE.test(base)) return true;
  // The fixed scaffolding files are generated ONLY at the docs root; a subdirectory
  // file that shares the basename is author content and must still be scanned.
  return segments.length === 1 && RESERVED_MD.has(base);
}

export interface ScannedNote {
  /** posix path relative to the docs root */
  relPath: string;
  /**
   * Every wing this note is tagged under (multi-home, ADR-0012 §5), de-duped,
   * primary first. Empty => cross-cutting. Unsafe segments are dropped.
   */
  wings: Array<{ wing: string; room: string }>;
  /** Primary wing — `wings[0]?.wing` or "" (cross-cutting). Kept for convenience. */
  wing: string;
  /** Primary room — `wings[0]?.room` or "". */
  room: string;
  title: string;
  type: string;
  keywords: string[];
  status?: string;
  lastReviewed?: string;
}

/**
 * Whether a wing/segment is safe to use as a filename and markdown-link target
 * (no path traversal or separators). Unsafe wings are reclassified to CROSS so a
 * crafted tag like `../x` can never drive file creation or deletion.
 */
export function safeSegment(s: string): boolean {
  return (
    s.length > 0 && s !== "." && s !== ".." && !s.includes("/") && !s.includes("\\") && !s.includes("\0")
  );
}

/**
 * Walk the WHOLE docs root (ADR-0011 §2) and return one ScannedNote per
 * markdown note, sorted deterministically by path. "Folders are conventions":
 * every dir is indexed EXCEPT the deny-list ({@link SKIP_DIRS}), and every
 * generated/scaffolding `.md` ({@link RESERVED_MD} + `_index.*.md`) is skipped
 * everywhere. An unparseable note is skipped with a warning rather than crashing
 * the scan. Shared by `mage index`, `mage skills`, and `mage dream`.
 */
export async function scanNotes(root: string): Promise<ScannedNote[]> {
  const out: ScannedNote[] = [];
  await walk(root, root, out);
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;
}

async function walk(dir: string, root: string, out: ScannedNote[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), root, out);
      continue;
    }
    if (!e.name.endsWith(".md")) continue;
    // Skip mage's own generated indexes + scaffolding anywhere (reserved namespace).
    // NOTE: the indexer deliberately reserves these BASENAMES at any depth (a note is
    // never named INDEX.md); the Gate-2 isGeneratedArtifact() is stricter (root-only)
    // because a stray secret in a subdir file must still be scanned.
    if (RESERVED_MD.has(e.name) || GEN_INDEX_RE.test(e.name)) continue;
    const abs = join(dir, e.name);
    const relPath = toPosix(relative(root, abs));
    let note: Note;
    try {
      note = await readNote(abs);
    } catch (err) {
      logger.warn(`mage: skipping unparseable note ${relPath} (${(err as Error).message})`);
      continue;
    }
    out.push(toScanned(note.frontmatter, note.body, abs, relPath));
  }
}

function toScanned(fm: NoteFrontmatter, body: string, abs: string, relPath: string): ScannedNote {
  // Dual-format tolerance (ADR-0035 §3): a note CC has transiently restamped buries its
  // real fields (type, tags, status, …) under nested `metadata.*`. Read an EFFECTIVE
  // view (top-level wins, `metadata.*` as fallback) so index/dream/groom categorize it
  // correctly even before the durable-boundary flatten runs. Harness-neutral — a plain
  // nested read, no CC-specific vocab mapping (the neutral-core posture, ADR-0035 §6).
  const efm = effectiveFrontmatter(fm);
  // Multi-home: every tag-wing, primary first, with unsafe segments dropped so a
  // crafted tag like `../x` can never drive file creation or deletion.
  const wings = noteWings(efm).filter((w) => safeSegment(w.wing));
  const primary = wings[0];
  return {
    relPath,
    wings,
    wing: primary ? primary.wing : CROSS,
    room: primary ? primary.room : "",
    title: noteTitle(body, abs),
    type: typeof efm.type === "string" && efm.type.trim() ? efm.type.trim() : "note",
    keywords: deriveKeywords(efm, body, abs),
    status: typeof efm.status === "string" ? efm.status : undefined,
    lastReviewed: typeof efm.last_reviewed === "string" ? efm.last_reviewed : undefined,
  };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
