import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { logger } from "./logger.js";
import {
  type Note,
  type NoteFrontmatter,
  deriveKeywords,
  noteRoom,
  noteTitle,
  noteWing,
  readNote,
} from "./note.js";
import { DECISIONS_DIR, INDEX_FILE, NOTES_DIR, WORK_DIR } from "./paths.js";

/** Sentinel wing key for untagged / cross-cutting notes. */
export const CROSS = "";

const SCAN_DIRS = [NOTES_DIR, DECISIONS_DIR, WORK_DIR];
const SKIP_DIRS = new Set([
  "artifacts",
  ".learnings",
  ".obsidian",
  ".git",
  "node_modules",
  "projects",
]);

export interface ScannedNote {
  /** posix path relative to the docs root */
  relPath: string;
  /** "" => cross-cutting (untagged, or an unsafe wing name reclassified) */
  wing: string;
  /** "" => no room */
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
 * Walk a docs root's notes/, decisions/, and work/ trees and return one
 * ScannedNote per markdown note, sorted deterministically by path. Skips
 * artifacts/, scratch, Obsidian config, and nested projects. An unparseable
 * note is skipped with a warning rather than crashing the scan. Shared by
 * `mage index` and `mage skills`.
 */
export async function scanNotes(root: string): Promise<ScannedNote[]> {
  const out: ScannedNote[] = [];
  for (const top of SCAN_DIRS) {
    await walk(join(root, top), root, out);
  }
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
    // Generated index files live at the docs root (never inside these dirs), so a
    // note named `_index.*.md` here is a real user note and IS indexed.
    if (e.name === INDEX_FILE) continue;
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
  const w = noteWing(fm);
  return {
    relPath,
    wing: w && safeSegment(w) ? w : CROSS,
    room: noteRoom(fm) ?? "",
    title: noteTitle(body, abs),
    type: typeof fm.type === "string" && fm.type.trim() ? fm.type.trim() : "note",
    keywords: deriveKeywords(fm, body, abs),
    status: typeof fm.status === "string" ? fm.status : undefined,
    lastReviewed: typeof fm.last_reviewed === "string" ? fm.last_reviewed : undefined,
  };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
