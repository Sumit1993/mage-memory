// The organic grooming loop's staging engine (0.0.12, plan-0.0.12 §"portable core").
// PURE compute + fs I/O — no model. A "draft" is a COMPLETE note (frontmatter +
// body) sitting in the git-ignored `.staging/` dir, a third epistemic state between
// `.learnings/` (raw, auto-pruned) and `notes/` (committed, indexed-live):
//
//   mage stage  → compose a short lesson, SCRUB it (redact, never block — drafts are
//                 pre-commit + git-ignored), dedup, write `.staging/<slug>.md`.
//   mage groom  → surface the deduped, budget-capped batch; --accept moves drafts to
//                 `notes/` (+ index); --reject deletes them and records their key.
//
// Anti-flood (plan §9): dedup vs `notes/` (coveringNote, keyword-overlap), vs the
// staged batch (exact key), and vs the reject ledger (exact key) + a bounded budget.

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type NoteFrontmatter,
  deriveKeywords,
  noteTitle,
  noteWing,
  normalizeTags,
  parseNote,
  writeNote,
} from "../note.js";
import { metricsPath, NOTES_DIR } from "../paths.js";
import type { ScannedNote } from "../scan.js";
import { coveringNoteMin } from "./covering-note.js";

/** The lesson reject ledger — distinct from the recurrence-path `.mage/metrics/rejected.json`. */
const REJECTS_FILE = "staged-rejects.json";
const REJECTS_VERSION = 1;
const SLUG_MAX = 60;

// ─── types ───────────────────────────────────────────────────────────────────

/** The coverage signature a draft dedups on: its wing + derived keywords. */
export interface DraftSig {
  wing: string;
  keywords: string[];
}

/** A lesson draft sitting in `.staging/` awaiting `mage groom`. */
export interface StagedDraft {
  /** Filename slug (no `.md`), unique within `.staging/`. */
  slug: string;
  /** Absolute path to `.staging/<slug>.md`. */
  path: string;
  /** Display title (H1 or slug). */
  title: string;
  frontmatter: NoteFrontmatter;
  body: string;
  sig: DraftSig;
  /** Stable dedup key (wing + sorted keyword set). */
  key: string;
}

/** Input to compose a draft from `mage stage` flags + stdin body. */
export interface DraftInput {
  title: string;
  type?: string;
  tags?: string[];
  /** Convenience: prepended as a tag when the body has no tag under that wing. */
  wing?: string;
  body: string;
  /** ISO date; defaults to today. */
  created?: string;
}

/** Why a fresh draft was (not) staged. */
export type DedupVerdict =
  | { staged: true }
  | { staged: false; reason: "covered"; by: string }
  | { staged: false; reason: "rejected" }
  | { staged: false; reason: "duplicate"; by: string };

// ─── slug + key ────────────────────────────────────────────────────────────────

/** Filename-safe kebab slug from a title; never empty, never a traversal token. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return s.length > 0 ? s : "lesson";
}

/** De-collide a slug against a taken set: `base`, `base-2`, `base-3` … */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** The coverage signature for a draft (wing from tags, keywords from title + body). */
export function draftSig(fm: NoteFrontmatter, body: string, slug: string): DraftSig {
  return { wing: noteWing(fm) ?? "", keywords: deriveKeywords(fm, body, slug) };
}

/**
 * The committed note (if any) that already covers a lesson draft — a STRICTER bar
 * than the recurrence path's any-overlap: half the draft's keywords must match
 * (floor 2). In a single-wing KB, wing-alignment is always true, so a 1-keyword
 * overlap would suppress every fresh lesson; first-sight capture must not silently
 * drop a real lesson (over-staging is recoverable at `mage groom`, suppression is not).
 */
export function lessonCoveringNote(sig: DraftSig, notes: ScannedNote[]): ScannedNote | null {
  return coveringNoteMin(sig, notes, lessonCoverMin(sig));
}

function lessonCoverMin(sig: DraftSig): number {
  return Math.max(2, Math.ceil(sig.keywords.length / 2));
}

/** Stable dedup key: wing + sorted keyword set. Two drafts collide iff identical. */
export function draftKey(sig: DraftSig): string {
  const kws = sig.keywords
    .map((k) => k.toLowerCase())
    .filter((k) => k.length > 0)
    .sort();
  return `${sig.wing.toLowerCase()}::${kws.join(",")}`;
}

// ─── compose ─────────────────────────────────────────────────────────────────

/** Compose a draft's frontmatter + body from stage input; the body gets an H1 = title. */
export function composeDraft(input: DraftInput): { frontmatter: NoteFrontmatter; body: string } {
  const tags = tagsFor(input.tags, input.wing);
  const fm: NoteFrontmatter = {
    type: (input.type && input.type.trim()) || "gotcha",
    ...(tags.length > 0 ? { tags } : {}),
    created: input.created ?? today(),
  };
  return { frontmatter: fm, body: ensureH1(input.body, input.title) };
}

function tagsFor(tags: string[] | undefined, wing: string | undefined): string[] {
  const out = normalizeTags(tags);
  const w = wing?.trim().replace(/^#/, "");
  if (w && w.length > 0) {
    const head = w.split("/")[0];
    if (!out.some((t) => t.split("/")[0] === head)) out.unshift(w);
  }
  return out;
}

/** Ensure the body opens with `# <title>`; preserve an existing H1; trailing newline. */
function ensureH1(body: string, title: string): string {
  const b = (body.charCodeAt(0) === 0xfeff ? body.slice(1) : body).replace(/^\s+/, "");
  const withH1 = /^#\s+\S/.test(b) ? b : `# ${title.trim()}\n\n${b}`;
  return withH1.endsWith("\n") ? withH1 : `${withH1}\n`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── stage: write a draft ──────────────────────────────────────────────────────

/**
 * Write `.staging/<slug>.md`. The body must ALREADY be redacted by the caller
 * (`mage stage` scrubs it; drafts are pre-commit + git-ignored, Gate-2 still guards
 * the eventual `mage groom` commit). Returns the absolute path written.
 */
export async function writeDraft(
  stagingDir: string,
  slug: string,
  fm: NoteFrontmatter,
  body: string,
): Promise<string> {
  await mkdir(stagingDir, { recursive: true });
  const path = join(stagingDir, `${slug}.md`);
  await writeNote(path, fm, body);
  return path;
}

// ─── list staged drafts (fail-open) ─────────────────────────────────────────────

/** All drafts currently in `.staging/`, slug-sorted. Missing/unreadable dir → []. */
export async function readStagedDrafts(stagingDir: string): Promise<StagedDraft[]> {
  let names: string[];
  try {
    names = (await readdir(stagingDir)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: StagedDraft[] = [];
  for (const name of names) {
    const path = join(stagingDir, name);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const slug = name.replace(/\.md$/i, "");
    const { frontmatter, body } = parseNote(raw);
    const sig = draftSig(frontmatter, body, slug);
    out.push({ slug, path, title: noteTitle(body, slug), frontmatter, body, sig, key: draftKey(sig) });
  }
  return out;
}

/** Existing slugs in `.staging/` (for `uniqueSlug`). Missing dir → empty. */
export async function stagedSlugs(stagingDir: string): Promise<Set<string>> {
  return slugsIn(stagingDir);
}

/** Existing flat slugs in `notes/` (so a promotion never clobbers a committed note). */
export async function existingNoteSlugs(docsRoot: string): Promise<Set<string>> {
  return slugsIn(join(docsRoot, NOTES_DIR));
}

async function slugsIn(dir: string): Promise<Set<string>> {
  try {
    const names = await readdir(dir);
    return new Set(names.filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/i, "")));
  } catch {
    return new Set();
  }
}

// ─── dedup decision ────────────────────────────────────────────────────────────

/**
 * Decide whether a fresh draft should be staged, or skipped because a committed
 * note already covers it (coveringNote, keyword-overlap), it was previously
 * rejected, or an identical draft is already staged (exact key). Checked in that
 * order — a committed note is the strongest signal that the lesson is already known.
 */
export function dedupDraft(
  sig: DraftSig,
  key: string,
  notes: ScannedNote[],
  staged: StagedDraft[],
  rejects: ReadonlySet<string>,
): DedupVerdict {
  const cover = lessonCoveringNote(sig, notes);
  if (cover) return { staged: false, reason: "covered", by: cover.relPath };
  if (rejects.has(key)) return { staged: false, reason: "rejected" };
  const dup = staged.find((d) => d.key === key);
  if (dup) return { staged: false, reason: "duplicate", by: dup.slug };
  return { staged: true };
}

// ─── promote / discard ──────────────────────────────────────────────────────────

/**
 * Move a staged draft into `notes/` (de-collided against `taken`), returning the
 * notes-relative path. `taken` should be mutated by the caller across a batch so
 * two accepted drafts can't land on the same slug.
 */
export async function promoteDraft(
  docsRoot: string,
  draft: StagedDraft,
  taken: ReadonlySet<string>,
): Promise<string> {
  const notesDir = join(docsRoot, NOTES_DIR);
  await mkdir(notesDir, { recursive: true });
  const finalSlug = uniqueSlug(draft.slug, taken);
  await rename(draft.path, join(notesDir, `${finalSlug}.md`));
  return `${NOTES_DIR}/${finalSlug}.md`;
}

/** Delete a staged draft file (idempotent). */
export async function discardDraft(draft: StagedDraft): Promise<void> {
  await rm(draft.path, { force: true });
}

// ─── reject ledger (.mage/metrics/staged-rejects.json, fail-open) ────────────────

interface StagedRejects {
  v: number;
  keys: string[];
}

function rejectsPath(docsRoot: string): string {
  return join(metricsPath(docsRoot), REJECTS_FILE);
}

/** The set of rejected draft keys; missing/corrupt → empty (fail-open). */
export async function readStagedRejects(docsRoot: string): Promise<Set<string>> {
  try {
    const raw = await readFile(rejectsPath(docsRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<StagedRejects>;
    const keys = Array.isArray(parsed.keys)
      ? parsed.keys.filter((k): k is string => typeof k === "string")
      : [];
    return new Set(keys);
  } catch {
    return new Set();
  }
}

/** Record draft keys to the reject ledger (deduped, sorted, pretty JSON). */
export async function addStagedRejects(docsRoot: string, keys: string[]): Promise<void> {
  const existing = await readStagedRejects(docsRoot);
  for (const k of keys) existing.add(k);
  const payload: StagedRejects = { v: REJECTS_VERSION, keys: [...existing].sort() };
  await mkdir(metricsPath(docsRoot), { recursive: true });
  await writeFile(rejectsPath(docsRoot), JSON.stringify(payload, null, 2) + "\n");
}
