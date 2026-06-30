// `mage groom` (0.0.12, plan-0.0.12 §"portable core"). The human-confirm half of
// the organic grooming loop — the batch commit that `mage stage` defers to:
//
//   mage groom                       → SURFACE the deduped, budget-capped batch (read-only).
//   mage groom --accept <slugs|all>  → move drafts to notes/ + re-index.
//   mage groom --reject <slugs|all>  → delete drafts + record their keys (never re-drafted).
//
// Hidden plumbing behind the `mage:groom` skill. Accept is the ONLY thing that
// writes into committed `notes/`; the human still commits the diff (ADR-0013).

import { logger } from "../logger.js";
import { type ResolvedDocsRoot, requireDocsRoot, stagingPath } from "../paths.js";
import { resolveCreationStamp } from "../provenance.js";
import { scanNotes } from "../scan.js";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import {
  type StagedDraft,
  addStagedRejects,
  discardDraft,
  lessonCoveringNote,
  promoteBatch,
  readStagedDrafts,
  readStagedRejects,
} from "../grooming/staging.js";
import { normalizeTags } from "../note.js";
import { type InboxIngestResult, ingestCaptureInbox } from "../adapters/claude-code/inbox.js";
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
  /** slugs lifted from the CC capture-inbox into staging this run (ADR-0032 §curation). */
  ingested?: string[];
  /** count of inbox captures dropped because an existing note already covered them. */
  ingestCovered?: number;
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

  // Lift any CC capture-inbox files (Gate-0 drops scrubbed native-memory writes at
  // the docs-root top) into staging FIRST, so they flow through the same
  // surface/accept/reject path as `mage stage` drafts (ADR-0032 §curation).
  const ingest = await ingestCaptureInbox(root);
  reportIngest(ingest, opts.json);

  const staged = await readStagedDrafts(stagingPath(root));
  const result =
    opts.accept !== undefined
      ? await acceptBatch(resolved, staged, opts.accept, opts)
      : opts.reject !== undefined
        ? await rejectBatch(root, staged, opts.reject, opts)
        : await surface(root, staged, opts.json);
  withIngest(result, ingest);
  // Emit JSON once, at the top level, so the ingest summary rides along (the
  // sub-functions only do human logging now).
  if (opts.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

/** Attach the inbox-ingest summary to a groom result (so JSON consumers see it). */
function withIngest(result: GroomResult, ingest: InboxIngestResult): GroomResult {
  if (ingest.ingested.length > 0) result.ingested = ingest.ingested.map((i) => i.slug);
  if (ingest.covered.length > 0) result.ingestCovered = ingest.covered.length;
  return result;
}

/** Log a one-line human summary of what the inbox ingest moved (skipped in JSON mode). */
function reportIngest(ingest: InboxIngestResult, asJson: boolean | undefined): void {
  if (asJson) return;
  const { ingested, covered } = ingest;
  if (ingested.length === 0 && covered.length === 0) return;
  const masked = ingested.reduce((n, i) => n + i.masked, 0);
  const parts = [`Ingested ${ingested.length} capture(s) from the inbox`];
  if (masked > 0) parts.push(`${masked} secret/PII value(s) scrubbed`);
  if (covered.length > 0) parts.push(`${covered.length} already covered (dropped)`);
  logger.info(`${parts.join(" · ")}.`);
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

  if (asJson) return result; // JSON is emitted once by groomCmd (with the ingest summary)
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
  resolved: ResolvedDocsRoot,
  staged: StagedDraft[],
  spec: string,
  opts: GroomOptions,
): Promise<GroomResult> {
  const root = resolved.root;
  const selected = select(spec, staged);
  // Stamp provenance at the creation chokepoint (ADR-0031): repo + commit on every
  // accepted note, and `autonomy` when this groom runs under approver/overseer (the
  // reject-ledger's authorship mark — ADR-0030). Resolved once for the batch.
  const stamp = await resolveCreationStamp(resolved);
  const accepted = await promoteBatch(root, selected, stamp);
  // Regenerate INDEX over the now-larger notes/ set. In --json mode, keep index()'s
  // human logging off stdout so the single JSON line groomCmd emits stays clean.
  await index({ dir: opts.dir, quiet: opts.json });

  const result: GroomResult = { accepted };
  if (opts.json) return result; // JSON is emitted once by groomCmd (with the ingest summary)
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
  if (opts.json) return result; // JSON is emitted once by groomCmd (with the ingest summary)
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
