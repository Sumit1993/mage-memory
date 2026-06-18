// `mage nudge` (0.0.12, plan-0.0.12 §B / ADR-0009 §24 step 2). The Claude-Code
// adapter's boundary SAFETY-NET for the organic grooming loop. Fired from a
// SessionStart hook; on `source: "compact"` it distills the just-closed chapter's
// `.learnings/`, drafts up to N FORGOTTEN lessons into `.staging/` (the same engine
// `mage stage` uses), and surfaces a ONE-LINE `additionalContext` nudge pointing the
// agent at `mage:groom`. Inline capture is PRIMARY (the AGENTS.md instruction); this
// only catches what the agent forgot. Verified hook contract: SessionStart carries
// `source` and its structured stdout becomes context; SessionEnd cannot inject
// context, so it is NOT used here. NEVER throws to the host (fail-open, exit 0).
//
// The nudge does NOT advance the distill watermark (only `mage distill --seen` does);
// dedup against notes/, the staged batch, and the reject ledger makes a chapter that
// is re-offered every compact get drafted at most once.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { readDistill } from "../distill/reader.js";
import type { DistillCluster } from "../distill/types.js";
import {
  composeDraft,
  draftKey,
  draftSig,
  lessonCoveringNote,
  readStagedDrafts,
  readStagedRejects,
  slugify,
  type StagedDraft,
  writeDraft,
} from "../grooming/staging.js";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import { LEARNINGS_DIR, METRICS_DIR, absolutePath, resolveDocsRoot, stagingPath } from "../paths.js";
import { redact } from "../redact.js";
import { type ScannedNote, scanNotes } from "../scan.js";

/** Anti-nag throttle: a pending-batch reminder fires at most once per window. */
const NUDGE_THROTTLE_FILE = "nudge-throttle.json";
const NUDGE_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface NudgeOptions {
  /** Working directory used to resolve the KB (default: cwd). */
  cwd?: string;
  /** The hook `source`; only "compact" acts (others are a no-op). */
  source?: string;
  /** Bypass the anti-nag throttle (testing / explicit re-nudge). */
  force?: boolean;
}

export interface NudgeResult {
  /** True when the nudge acted (source was "compact" and a KB resolved). */
  ran: boolean;
  /** Drafts newly written to `.staging/` this run. */
  drafted: number;
  /** Total drafts pending in `.staging/` after the run. */
  pending: number;
  /** The one-line additionalContext nudge, or null when nothing was surfaced. */
  nudge: string | null;
}

const NONE: NudgeResult = { ran: false, drafted: 0, pending: 0, nudge: null };

/**
 * Distill the just-closed chapter, draft forgotten lessons to `.staging/` (bounded
 * by the staging budget + dedup), and COMPUTE the one-line nudge. Pure of stdout —
 * the caller (the hook command) emits `nudge` as additionalContext — so this is
 * directly unit-testable. May throw in tests; the command wraps it fail-open.
 */
export async function nudgeCmd(opts: NudgeOptions): Promise<NudgeResult> {
  // Only the post-compaction boundary distills + nudges. Other SessionStart sources
  // (startup/resume/clear) are no-ops — nothing closed to reflect on.
  if (opts.source !== "compact") return NONE;

  const resolved = await resolveDocsRoot(absolutePath(opts.cwd ?? process.cwd())).catch(() => null);
  if (!resolved) return NONE;
  const { root, repo } = resolved;
  const stagingDir = stagingPath(root);

  // Distill the NEW (un-disposed) segment since the watermark. We never write the
  // watermark — dedup makes a re-offered chapter idempotent.
  const manifest = await readDistill(root, join(root, LEARNINGS_DIR), repo).catch(() => null);
  const clusters = manifest?.clusters ?? [];

  const [notes, rejects, staged] = await Promise.all([
    scanNotes(root).catch(() => [] as ScannedNote[]),
    readStagedRejects(root).catch(() => new Set<string>()),
    readStagedDrafts(stagingDir).catch(() => [] as StagedDraft[]),
  ]);
  const taken = new Set(staged.map((d) => d.slug));

  const budget = BASE_THRESHOLDS.stagingBudget;
  let drafted = 0;
  for (const cluster of clusters) {
    if (drafted >= budget) break;
    if (await draftCluster(cluster, { stagingDir, notes, rejects, taken })) drafted += 1;
  }

  const pending = (await readStagedDrafts(stagingDir).catch(() => [] as StagedDraft[])).length;
  const nudge = await decideNudge(root, drafted, pending, opts.force === true);
  return { ran: true, drafted, pending, nudge };
}

// ─── draft one cluster ───────────────────────────────────────────────────────

interface DraftCtx {
  stagingDir: string;
  notes: ScannedNote[];
  rejects: ReadonlySet<string>;
  /** Existing + this-run draft slugs. Each nudge draft gets a STABLE per-cluster slug, so
   *  membership here means "this exact cluster was already drafted" (idempotent re-distill). */
  taken: Set<string>;
}

/** Compose, scrub, dedup, and write one cluster's draft. Returns true iff written. */
async function draftCluster(cluster: DistillCluster, ctx: DraftCtx): Promise<boolean> {
  const { title, body, type } = clusterToDraft(cluster);
  if (title.length === 0 || body.trim().length === 0) return false;

  // SCRUB before disk — the cluster signals are scrubbed at capture, so this is
  // defense-in-depth (and matches `mage stage`). redact() is keep-context + idempotent.
  const titleScrub = redact(title);
  const { frontmatter, body: composed } = composeDraft({ title: titleScrub.text, type, body });
  // Honor the SOFT lessonNoteCap on the FINAL body — AFTER the H1 is prepended.
  const scrubbed = redact(composed).text;
  const finalBody =
    scrubbed.length > BASE_THRESHOLDS.lessonNoteCap
      ? scrubbed.slice(0, BASE_THRESHOLDS.lessonNoteCap)
      : scrubbed;

  const slugBase = slugify(titleScrub.text);
  const sig = draftSig(frontmatter, finalBody, slugBase);
  const key = draftKey(sig);

  // CONTENT dedup: skip if a committed note already covers this lesson, or it was rejected.
  if (lessonCoveringNote(sig, ctx.notes)) return false;
  if (ctx.rejects.has(key)) return false;

  // IDENTITY dedup: a STABLE per-cluster slug (title + session/span) keeps re-distilling the
  // same chapter idempotent, while two DISTINCT chapters that happen to share a generic
  // title-derived key never silently collide (the review's untagged-collision finding —
  // over-staging is recoverable at `mage groom`; a silent drop is not).
  const slug = `${slugBase}-${clusterTag(cluster)}`;
  if (ctx.taken.has(slug)) return false;
  await writeDraft(ctx.stagingDir, slug, frontmatter, finalBody);
  ctx.taken.add(slug);
  return true;
}

/** A short, stable, per-cluster token (session + span). Distinct clusters get distinct tokens;
 *  re-distilling the SAME chapter yields the same token (so the draft slug is idempotent). */
function clusterTag(cluster: DistillCluster): string {
  return slugify(`${cluster.session} ${cluster.span}`).slice(0, 32) || "x";
}

/**
 * Turn a distill cluster into a SHORT draft. Deterministic (no model) — it captures
 * the raw observed material as a starting point the human shapes into a real lesson
 * at `mage groom`, NOT a finished note. Type defaults to `gotcha` (the lesson type).
 */
function clusterToDraft(cluster: DistillCluster): { title: string; body: string; type: string } {
  const s = cluster.signals;
  const lead = firstNonEmpty(s.corrections, s.failures, s.prompts, s.tools) ?? cluster.hint;
  const title = oneLine(lead ?? "Observed lesson").slice(0, 72) || "Observed lesson";

  const lines: string[] = [
    `> Drafted by mage at a session boundary from observed scratch (${cluster.span}). Shape or reject it at \`mage groom\`.`,
    "",
  ];
  if (cluster.hint.length > 0) lines.push(cluster.hint, "");
  pushBullets(lines, "Correction", s.corrections);
  pushBullets(lines, "Failure", s.failures);
  pushBullets(lines, "Did", s.tools);
  pushBullets(lines, "Prompt", s.prompts);
  // The cap is applied to the FINAL composed body in draftCluster (after the H1 is added).
  const body = lines.join("\n");
  return { title, body, type: "gotcha" };
}

// ─── anti-nag nudge decision ───────────────────────────────────────────────────

/**
 * Decide the one-line nudge under the anti-nag rule: a freshly-drafted batch is
 * ALWAYS worth surfacing; otherwise a stale pending batch is reminded at most once
 * per {@link NUDGE_THROTTLE_MS}. Returns null (no nudge) when nothing is new and the
 * window has not elapsed, or there is nothing pending at all. Persists the throttle
 * timestamp when it surfaces.
 */
async function decideNudge(
  root: string,
  drafted: number,
  pending: number,
  force: boolean,
): Promise<string | null> {
  if (drafted === 0 && pending === 0) return null; // nothing to say.
  const throttlePath = join(root, METRICS_DIR, NUDGE_THROTTLE_FILE);
  if (drafted === 0 && !force) {
    const last = await readThrottle(throttlePath);
    if (Date.now() - last < NUDGE_THROTTLE_MS) return null; // a recent reminder already fired.
  }
  const line =
    drafted > 0
      ? `mage: drafted ${drafted} lesson${plural(drafted)} from the last chapter (${pending} pending) — review with \`mage:groom\`.`
      : `mage: ${pending} lesson draft${plural(pending)} pending in .staging/ — review with \`mage:groom\`.`;
  await writeThrottle(throttlePath, Date.now());
  return line;
}

async function readThrottle(path: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { lastNudge?: unknown };
    return typeof parsed.lastNudge === "number" ? parsed.lastNudge : 0;
  } catch {
    return 0; // missing/corrupt → never throttled.
  }
}

async function writeThrottle(path: string, ts: number): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ v: 1, lastNudge: ts })}\n`);
  } catch {
    // Fail-open: a throttle write failure must never break the host session start.
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function firstNonEmpty(...lists: string[][]): string | undefined {
  for (const list of lists) {
    const v = list.find((x) => x.trim().length > 0);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Collapse to a single trimmed line (titles/slugs must not carry newlines). */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function pushBullets(lines: string[], label: string, items: string[]): void {
  for (const item of items) {
    const text = oneLine(item).slice(0, 200);
    if (text.length > 0) lines.push(`- ${label}: ${text}`);
  }
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/**
 * Emit a one-line nudge as Claude Code `additionalContext`. The structured form is
 * the documented contract for a SessionStart hook (plain stdout also works); exit 0
 * is required for stdout to be consumed.
 */
export function emitAdditionalContext(context: string): void {
  const out = {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

// ─── hook stdin (mirrors observe.ts's fail-open contract) ──────────────────────

/** Drain stdin to a UTF-8 string; resolves "" on empty/closed/errored streams. */
function readStdinSafe(): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/** Parse stdin → a plain object, or null for invalid/array/primitive/null JSON. */
function parseHookPayload(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ─── CLI registration (kept next to the handler so the flag list can't drift) ──

/**
 * Build the `nudge` plumbing-tier command (ADR-0009 §24 step 2). Reads the hook JSON
 * on stdin, extracts `source`/`cwd`, runs the nudge, and emits the additionalContext
 * line. Wrapped fail-open: any error → silent exit 0 (a boundary nudge must never
 * break the host's session start).
 */
export function buildNudgeCommand(): Command {
  return new Command("nudge")
    .description(
      "Hook-fired boundary nudge: on a post-compaction SessionStart, distill the closed chapter, draft forgotten lessons to .staging/, and surface them (ADR-0009 §24; never blocks the host)",
    )
    .option(
      "--cwd <dir>",
      "working directory used to locate the knowledge base (overrides the hook JSON cwd; defaults to it, then process.cwd())",
    )
    .action(async (opts: { cwd?: string }) => {
      try {
        const raw = await readStdinSafe();
        const payload = raw.trim().length === 0 ? null : parseHookPayload(raw);
        const result = await nudgeCmd({
          cwd: opts.cwd ?? str(payload?.cwd),
          source: str(payload?.source),
        });
        if (result.nudge !== null) emitAdditionalContext(result.nudge);
      } catch {
        // Fail open: a boundary nudge never breaks the host session start.
      }
    });
}
