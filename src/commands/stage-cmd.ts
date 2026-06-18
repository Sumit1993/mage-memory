// `mage stage` (0.0.12, plan-0.0.12 §"portable core"). The frictionless inline
// half of the organic grooming loop: the agent composes a SHORT lesson during a
// response and stages it — no per-note confirm (the human confirms the batch at
// `mage groom`). Hidden plumbing; the user-facing seam is the inline-capture
// instruction + the `mage:groom` skill.
//
//   mage stage --title "..." [--type gotcha] [--tags w/r,w2] [--wing w]  < body
//
// Flow: compose a note → SCRUB it (redact, NEVER block — drafts are pre-commit +
// git-ignored, Gate-2 still guards the eventual `mage groom` commit) → dedup (vs
// notes/, the staged batch, the reject ledger) → write `.staging/<slug>.md`.

import { logger } from "../logger.js";
import { absolutePath, resolveDocsRoot, stagingPath } from "../paths.js";
import { redact } from "../redact.js";
import { scanNotes } from "../scan.js";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import {
  composeDraft,
  type DraftSig,
  draftKey,
  draftSig,
  dedupDraft,
  readStagedDrafts,
  readStagedRejects,
  slugify,
  stagedSlugs,
  uniqueSlug,
  writeDraft,
} from "../grooming/staging.js";

/** Options for {@link stageCmd}. */
export interface StageOptions {
  /** Working directory for resolving the docs root (default: cwd). */
  dir?: string;
  /** The lesson title (required) — drives the H1 and the slug. */
  title?: string;
  /** Note type (default "gotcha" — lessons). */
  type?: string;
  /** Comma-separated `wing/room` tags. */
  tags?: string;
  /** Convenience wing (prepended as a tag when no tag homes there). */
  wing?: string;
  /** Lesson body (else read from stdin). */
  body?: string;
  /** Emit the result as a single JSON line. */
  json?: boolean;
}

/** Result of {@link stageCmd}. */
export interface StageResult {
  staged: boolean;
  slug?: string;
  /** Absolute path of the written draft. */
  path?: string;
  /** Dedup key. */
  key?: string;
  /** Count of secrets/PII scrubbed from the draft. */
  redactions?: number;
  /** Why it was skipped (when `staged` is false). */
  reason?: "covered" | "rejected" | "duplicate";
  /** What it collided with (a note relPath, or a staged slug). */
  by?: string;
}

/**
 * Stage one lesson draft. Resolves the docs root (a friendly error when there's no
 * KB), composes + scrubs the draft, dedups it, and writes it to `.staging/` — or
 * reports that it was skipped (already covered / rejected / a duplicate).
 */
export async function stageCmd(opts: StageOptions): Promise<StageResult> {
  const start = absolutePath(opts.dir ?? process.cwd());
  const resolved = await resolveDocsRoot(start);
  if (!resolved) {
    throw new Error(`No mage knowledge base found at or above ${start}. Run \`mage init\` first.`);
  }
  const { root } = resolved;

  const rawTitle = (opts.title ?? "").trim();
  if (rawTitle.length === 0) {
    throw new Error("mage stage: --title is required (it drives the note's H1 and slug).");
  }
  const rawBody = await readBody(opts);
  if (rawBody.trim().length === 0) {
    throw new Error("mage stage: provide the lesson body on stdin (or via --body).");
  }

  // SCRUB every user-supplied value before it reaches disk: the title (it seeds the
  // slug AND the H1), the body, AND the frontmatter values — a secret can be
  // fat-fingered into --tags/--wing/--type just as easily. redact() is keep-context
  // + idempotent, so a clean input passes through untouched.
  const titleScrub = redact(rawTitle);
  const tags = parseTags(opts.tags);
  const tagScrubs = (tags ?? []).map((t) => redact(t));
  const wingScrub = redact(opts.wing ?? "");
  const typeScrub = redact(opts.type ?? "");
  const { frontmatter, body: composed } = composeDraft({
    title: titleScrub.text,
    type: opts.type !== undefined ? typeScrub.text : undefined,
    tags: tags ? tagScrubs.map((s) => s.text) : undefined,
    wing: opts.wing !== undefined ? wingScrub.text : undefined,
    body: rawBody,
  });
  const bodyScrub = redact(composed);
  const redactions =
    titleScrub.findings.length +
    bodyScrub.findings.length +
    wingScrub.findings.length +
    typeScrub.findings.length +
    tagScrubs.reduce((n, s) => n + s.findings.length, 0);

  const slugBase = slugify(titleScrub.text);
  const sig = draftSig(frontmatter, bodyScrub.text, slugBase);
  const key = draftKey(sig);

  const stagingDir = stagingPath(root);
  const [notes, staged, rejects] = await Promise.all([
    scanNotes(root),
    readStagedDrafts(stagingDir),
    readStagedRejects(root),
  ]);

  const verdict = dedupDraft(sig, key, notes, staged, rejects);
  if (!verdict.staged) {
    return report({ staged: false, reason: verdict.reason, by: "by" in verdict ? verdict.by : undefined }, opts.json);
  }

  const slug = uniqueSlug(slugBase, await stagedSlugs(stagingDir));
  const path = await writeDraft(stagingDir, slug, frontmatter, bodyScrub.text);
  warnIfLong(bodyScrub.text, key, sig);
  return report({ staged: true, slug, path, key, redactions }, opts.json);
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function parseTags(csv: string | undefined): string[] | undefined {
  if (!csv) return undefined;
  const out = csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Soft size nudge — drafts should be CC-memory-sized (never blocks). */
function warnIfLong(body: string, key: string, _sig: DraftSig): void {
  if (body.length > BASE_THRESHOLDS.lessonNoteCap) {
    logger.warn(
      `Draft is ${body.length} chars (> ${BASE_THRESHOLDS.lessonNoteCap} soft target) — lesson notes should be short; trim it before \`mage groom\`. [${key}]`,
    );
  }
}

function report(result: StageResult, asJson: boolean | undefined): StageResult {
  if (asJson) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return result;
  }
  if (result.staged) {
    logger.success(`Staged ${result.slug}.md${result.redactions ? ` (${result.redactions} redacted)` : ""}.`);
    logger.step("Plumbing engine: review the batch with `mage groom`, then accept/reject.");
  } else if (result.reason === "covered") {
    logger.info(`Skipped — already covered by ${result.by}.`);
  } else if (result.reason === "rejected") {
    logger.info("Skipped — this lesson was previously rejected.");
  } else {
    logger.info(`Skipped — an identical draft is already staged (${result.by}).`);
  }
  return result;
}

/** Read the lesson body from --body or stdin (TTY with no pipe → empty). */
async function readBody(opts: StageOptions): Promise<string> {
  if (typeof opts.body === "string" && opts.body.length > 0) return opts.body;
  if (process.stdin.isTTY) return "";
  return readStdinSafe();
}

/** Drain stdin to a UTF-8 string; resolves "" on empty/closed/errored streams. */
function readStdinSafe(): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}
