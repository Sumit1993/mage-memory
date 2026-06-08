// Plan folding a new lesson into an existing same-topic note (prefer-update-over-
// new; ADR-0019 §6). A READ-ONLY planner: it reads the target note and returns a
// MutationPlan with ONE write; the single applier (applier.ts) enforces the §3
// ceilings (Gate-2 secret scan over the write content) and performs the write.
// This executor never touches disk.
//
// The merge appends `addition` under a dated "## Update" section, unions any
// `keywords` into the note's frontmatter, and bumps `updated`/`last_reviewed`. No
// skill is touched (skillTargets/removes/archives all empty) — a note grows; the
// graduated skill (if any) re-renders later from the richer note.

import { join } from "node:path";
import { type NoteFrontmatter, readNote, stringifyNote } from "../note.js";
import type { MutationPlan } from "./types.js";

export interface MergePayload {
  /** docs-root-relative path of the note to fold the lesson into. */
  note: string;
  /** The new lesson body (markdown) to append under a dated Update section. */
  addition: string;
  /** Keywords to union into the note's frontmatter.keywords (deduped). */
  keywords?: string[];
}

/**
 * Plan folding `payload.addition` into `payload.note`. THROWS if the note is
 * missing. One write (the note), no skill/archive/remove mutations.
 *
 *   body     <- existing body + `\n\n## Update (<date>)\n\n<addition>`
 *   keywords <- union(existing, payload.keywords), order-preserving + deduped
 *   updated, last_reviewed <- today (YYYY-MM-DD — the note's existing pattern)
 */
export async function planMerge(docsRoot: string, payload: MergePayload): Promise<MutationPlan> {
  const abs = join(docsRoot, payload.note);
  let note: { frontmatter: NoteFrontmatter; body: string };
  try {
    note = await readNote(abs);
  } catch {
    throw new Error(`merge: note '${payload.note}' not found under the docs root.`);
  }

  const today = todayStamp();
  // The Update section is dated by the note's CURRENT `updated` (the point the
  // lesson is recorded against), falling back to today for a never-stamped note.
  const sectionDate =
    typeof note.frontmatter.updated === "string" && note.frontmatter.updated.trim()
      ? note.frontmatter.updated.trim()
      : today;

  const body = appendUpdate(note.body, sectionDate, payload.addition);

  const frontmatter: NoteFrontmatter = {
    ...note.frontmatter,
    keywords: unionKeywords(note.frontmatter.keywords, payload.keywords),
    updated: today,
    last_reviewed: today,
  };

  return {
    action: "merge",
    writes: [{ path: abs, content: stringifyNote(frontmatter, body) }],
    archives: [],
    removes: [],
    skillTargets: [],
    summary: `Merge lesson into ${payload.note}; bumped updated/last_reviewed to ${today}.`,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Append the addition under a dated `## Update (<date>)` section. */
function appendUpdate(body: string, date: string, addition: string): string {
  const base = body.replace(/\s+$/, "");
  const section = `## Update (${date})\n\n${addition.trim()}`;
  return base.length > 0 ? `${base}\n\n${section}\n` : `${section}\n`;
}

/**
 * Union two keyword lists, order-preserving (existing first) and deduped. Returns
 * undefined when the union is empty so an untagged note's frontmatter stays clean.
 */
function unionKeywords(
  existing: NoteFrontmatter["keywords"],
  added: string[] | undefined,
): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...(existing ?? []), ...(added ?? [])]) {
    if (typeof k !== "string") continue;
    const v = k.trim();
    if (v.length === 0 || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

/** Today as `YYYY-MM-DD` (UTC) — the date format every mage note uses. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
