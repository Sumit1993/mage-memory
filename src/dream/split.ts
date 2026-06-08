// Plan splitting a note into the trimmed original + one or more new notes
// (too-long / slice-recurs / incoherent; ADR-0019 §6). A READ-ONLY planner: it
// reads the original for its frontmatter and returns a MutationPlan of writes; the
// single applier (applier.ts) enforces the §3 ceilings (Gate-2 over every write)
// and performs the writes. This executor never touches disk.
//
// The Stage-3 skill (judgment) fully specifies the cut in the payload: `keepBody`
// is what stays in the original, and `into[]` are the carved-out notes. The
// ORIGINAL IS NEVER DELETED — it persists, trimmed, with relation-bullet links to
// each new note (knowledge is never hard-deleted; ADR-0013 §1).

import { join } from "node:path";
import {
  type NoteFrontmatter,
  noteTitle,
  readNote,
  stringifyNote,
} from "../note.js";
import type { MutationPlan } from "./types.js";

export interface SplitNewNote {
  /** docs-root-relative path of the new note to create. */
  relPath: string;
  type: string;
  tags: string[];
  title: string;
  body: string;
}

export interface SplitPayload {
  /** docs-root-relative path of the note being split. */
  note: string;
  /** The body the original keeps (relation-bullet links are appended below it). */
  keepBody: string;
  /** The carved-out notes. Must be non-empty. */
  into: SplitNewNote[];
}

/**
 * Plan splitting `payload.note`. THROWS if the original is missing or `into` is
 * empty (a split into nothing is meaningless). The original keeps its frontmatter
 * (with bumped `updated`/`last_reviewed`); each new note gets fresh frontmatter
 * `{type, tags, created, updated, last_reviewed}` and its body under its H1 title.
 *
 *   writes = [...new notes, trimmed original]   (no skill/archive/remove mutations)
 *
 * Children are written BEFORE the shrunk original so a mid-plan child-write failure
 * leaves the full original intact (no content lost between shrinking and carving).
 */
export async function planSplit(docsRoot: string, payload: SplitPayload): Promise<MutationPlan> {
  if (payload.into.length === 0) {
    throw new Error(`split: refusing to split '${payload.note}' into zero notes.`);
  }

  const originalAbs = join(docsRoot, payload.note);
  let original: { frontmatter: NoteFrontmatter; body: string };
  try {
    original = await readNote(originalAbs);
  } catch {
    throw new Error(`split: note '${payload.note}' not found under the docs root.`);
  }

  const today = todayStamp();

  // Trimmed original: keepBody + a relation-bullet link to each new note. The
  // link text is the new note's title; the target is its relPath (locked format).
  const trimmedBody = withRelations(payload.keepBody, payload.into);
  const trimmedFm: NoteFrontmatter = {
    ...original.frontmatter,
    updated: today,
    last_reviewed: today,
  };

  // Children FIRST, then the shrunk original LAST: a child-write failure mid-plan
  // must leave the full original intact (content is never lost — ADR-0013 §1).
  const writes = payload.into.map((child) => {
    const fm: NoteFrontmatter = {
      type: child.type,
      tags: child.tags,
      created: today,
      updated: today,
      last_reviewed: today,
    };
    return {
      path: join(docsRoot, child.relPath),
      content: stringifyNote(fm, childBody(child)),
    };
  });

  writes.push({ path: originalAbs, content: stringifyNote(trimmedFm, trimmedBody) });

  return {
    action: "split",
    writes,
    archives: [],
    removes: [],
    skillTargets: [],
    summary: `Split ${payload.note} → kept + ${payload.into.length} new note(s); original persists, trimmed.`,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Append a `- relates_to [<title>](<relPath>)` link to each new note below the
 * kept body. The link target is the new note's relPath (the locked relation-bullet
 * format mirrored elsewhere in mage notes).
 */
function withRelations(keepBody: string, into: SplitNewNote[]): string {
  const base = keepBody.replace(/\s+$/, "");
  const bullets = into.map((c) => `- relates_to [${c.title}](${c.relPath})`).join("\n");
  return base.length > 0 ? `${base}\n\n${bullets}\n` : `${bullets}\n`;
}

/** A new note's body, ensuring its H1 title leads (idempotent if already present). */
function childBody(child: SplitNewNote): string {
  const body = child.body.replace(/^\s+/, "");
  // Reuse noteTitle to detect an existing H1 without re-implementing the regex.
  const existingH1 = noteTitle(body, child.relPath);
  const hasH1 = body.startsWith("#") && existingH1 === child.title;
  if (hasH1) return body.endsWith("\n") ? body : `${body}\n`;
  return `# ${child.title}\n\n${body}`.replace(/\s+$/, "") + "\n";
}

/** Today as `YYYY-MM-DD` (UTC) — the date format every mage note uses. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
