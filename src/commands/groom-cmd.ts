// `mage groom` (0.0.12, plan-0.0.12 §"portable core"). The human-confirm half of
// the organic grooming loop — the batch commit that `mage stage` defers to:
//
//   mage groom                       → SURFACE the deduped, budget-capped batch (read-only).
//   mage groom --accept <slugs|all>  → move drafts to notes/ + re-index.
//   mage groom --reject <slugs|all>  → delete drafts + record their keys (never re-drafted).
//
// Hidden plumbing behind the `mage:groom` skill. Accept is the ONLY thing that
// writes into committed `notes/`; the human still commits the diff (ADR-0013).

import { basename } from "node:path";
import { logger } from "../logger.js";
import { requireDocsRoot, stagingPath } from "../paths.js";
import { scanNotes } from "../scan.js";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import {
  type StagedDraft,
  addStagedRejects,
  discardDraft,
  existingNoteSlugs,
  lessonCoveringNote,
  promoteDraft,
  readStagedDrafts,
  readStagedRejects,
} from "../grooming/staging.js";
import { normalizeTags } from "../note.js";
import { index } from "./index-cmd.js";

/** Options for {@link groomCmd}. */
export interface GroomOptions {
  /** Working directory for resolving the docs root (default: cwd). */
  dir?: string;
  /** Emit the result as a single JSON line. */
  json?: boolean;
  /** Promote these staged drafts to notes/ ("all" or a comma-separated slug list). */
  accept?: string;
  /** Discard these staged drafts ("all" or a comma-separated slug list). */
  reject?: string;
}

/** One surfaced draft in the read-only batch view. */
export interface GroomDraftView {
  slug: string;
  title: string;
  type: string;
  wing: string;
  tags: string[];
  key: string;
}

/** Result of {@link groomCmd}: a surface view XOR an accept/reject disposition. */
export interface GroomResult {
  /** Surfaced drafts (read mode). */
  drafts?: GroomDraftView[];
  /** Total pending after dedup (read mode) — `surfaced` ≤ `pending`. */
  pending?: number;
  /** notes-relative paths of promoted drafts (--accept). */
  accepted?: string[];
  /** slugs of discarded drafts (--reject). */
  rejected?: string[];
}

/**
 * Run `mage groom`. Resolves the docs root, then either disposes a batch
 * (`--accept` / `--reject`, mutually exclusive) or surfaces the pending batch.
 */
export async function groomCmd(opts: GroomOptions): Promise<GroomResult> {
  const resolved = await requireDocsRoot(opts.dir);
  const { root } = resolved;

  if (opts.accept !== undefined && opts.reject !== undefined) {
    throw new Error("mage groom: choose one of --accept / --reject, not both.");
  }

  const staged = await readStagedDrafts(stagingPath(root));
  if (opts.accept !== undefined) return acceptBatch(root, staged, opts.accept, opts);
  if (opts.reject !== undefined) return rejectBatch(root, staged, opts.reject, opts);
  return surface(root, staged, opts.json);
}

// ─── surface (read-only) ─────────────────────────────────────────────────────

async function surface(root: string, staged: StagedDraft[], asJson: boolean | undefined): Promise<GroomResult> {
  const [notes, rejects] = await Promise.all([scanNotes(root), readStagedRejects(root)]);
  // Drop drafts a committed note now covers, or whose key was since rejected — they
  // are stale (e.g. another session committed the lesson). The files stay until an
  // explicit accept/reject; surface just doesn't show resolved ones.
  const pending = staged.filter((d) => lessonCoveringNote(d.sig, notes) === null && !rejects.has(d.key));
  const budget = BASE_THRESHOLDS.stagingBudget;
  const surfaced = pending.slice(0, budget);
  const drafts = surfaced.map(toView);
  const result: GroomResult = { drafts, pending: pending.length };

  if (asJson) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return result;
  }
  if (pending.length === 0) {
    logger.info("No staged lesson drafts awaiting review.");
    return result;
  }
  logger.success(`${surfaced.length} of ${pending.length} staged draft(s) awaiting your judgment:`);
  for (const d of drafts) {
    logger.detail(`${d.slug} — ${d.title} [${d.type}${d.wing ? ` · ${d.wing}` : ""}]`);
  }
  const remaining = pending.length - surfaced.length;
  if (remaining > 0) {
    logger.warn(`${remaining} more pending (budget ${budget}) — accept/reject some, then re-run.`);
  }
  logger.blank();
  logger.step("mage groom --accept <slug,…|all>  ·  mage groom --reject <slug,…|all>");
  return result;
}

function toView(d: StagedDraft): GroomDraftView {
  const tags = normalizeTags(d.frontmatter.tags);
  return {
    slug: d.slug,
    title: d.title,
    type: typeof d.frontmatter.type === "string" && d.frontmatter.type.trim() ? d.frontmatter.type.trim() : "note",
    wing: d.sig.wing,
    tags,
    key: d.key,
  };
}

// ─── accept: promote to notes/ + re-index ────────────────────────────────────

async function acceptBatch(
  root: string,
  staged: StagedDraft[],
  spec: string,
  opts: GroomOptions,
): Promise<GroomResult> {
  const selected = select(spec, staged);
  const taken = await existingNoteSlugs(root);
  const accepted: string[] = [];
  for (const draft of selected) {
    const rel = await promoteDraft(root, draft, taken);
    taken.add(basename(rel, ".md")); // so two accepted drafts can't collide on a slug
    accepted.push(rel);
  }
  await index({ dir: opts.dir }); // regenerate INDEX over the now-larger notes/ set.

  const result: GroomResult = { accepted };
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return result;
  }
  logger.success(`Promoted ${accepted.length} draft(s) to notes/ and re-indexed.`);
  for (const rel of accepted) logger.detail(rel);
  logger.step("Review the diff and commit when ready (the human commits — ADR-0013).");
  return result;
}

// ─── reject: discard + record the key ────────────────────────────────────────

async function rejectBatch(
  root: string,
  staged: StagedDraft[],
  spec: string,
  opts: GroomOptions,
): Promise<GroomResult> {
  const selected = select(spec, staged);
  await addStagedRejects(root, selected.map((d) => d.key));
  for (const draft of selected) await discardDraft(draft);

  const result: GroomResult = { rejected: selected.map((d) => d.slug) };
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return result;
  }
  logger.success(`Rejected ${selected.length} draft(s) — they won't be re-drafted.`);
  return result;
}

// ─── selection ───────────────────────────────────────────────────────────────

/** Resolve "all" or a comma-separated slug list to drafts; throws on an unknown slug. */
function select(spec: string, staged: StagedDraft[]): StagedDraft[] {
  if (spec.trim() === "all") {
    if (staged.length === 0) throw new Error("mage groom: no staged drafts to act on.");
    return staged;
  }
  const slugs = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (slugs.length === 0) throw new Error("mage groom: no drafts selected (pass slugs or 'all').");
  return slugs.map((slug) => {
    const found = staged.find((d) => d.slug === slug);
    if (!found) throw new Error(`mage groom: no staged draft '${slug}'.`);
    return found;
  });
}
