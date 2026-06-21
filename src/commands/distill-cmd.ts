// `mage distill` (ADR-0018 §1, §3). The PLUMBING half of distill: a deterministic
// reader + a watermark commit. Two modes, one of which writes:
//
//   mage distill            → PURE READ. Group un-distilled CLOSED `.learnings/`
//                             events into candidate clusters; print a human
//                             summary (or --json the manifest the `mage:groom`
//                             skill consumes). NEVER advances the watermark.
//   mage distill --seen S:N → THE ONLY WRITE PATH. After the human dispositions a
//                             batch (keep/skip), advance session S's watermark to
//                             offset N (never-regress). An interrupted run never
//                             reaches here, so a re-run safely re-offers.
//
// This mirrors the `mage ingest --json` → `mage:learn --from` split: the CLI does
// the determinism, the skill does the judgment. No model lives here.

import { logger } from "../logger.js";
import { learningsPath, type ResolvedDocsRoot, requireDocsRoot } from "../paths.js";
import { reportHubFanout } from "./fanout-hint.js";
import { readDistill } from "../distill/reader.js";
import type { DistillManifest } from "../distill/types.js";
import { advanceWatermark, readWatermark, writeWatermark } from "../distill/watermark.js";
import { scanSecrets } from "../redact.js";

/** Options for {@link distillCmd}. */
export interface DistillOptions {
  /** Working directory for resolving the docs root (default: cwd). */
  dir?: string;
  /** Emit the manifest as a single JSON line for the skill (read mode only). */
  json?: boolean;
  /** Commit a disposition: "<session>:<offset>" — advances the watermark. */
  seen?: string;
}

/** Result of {@link distillCmd}: a manifest (read mode) XOR an advance (--seen). */
export interface DistillResult {
  manifest?: DistillManifest;
  advanced?: { session: string; offset: number };
}

/**
 * Run `mage distill`. Resolves the docs root (a friendly error when there's no
 * knowledge base), then either commits a `--seen` disposition (the sole write) or
 * reads + reports the candidate-cluster manifest.
 */
export async function distillCmd(opts: DistillOptions): Promise<DistillResult> {
  const resolved = await requireDocsRoot(opts.dir);
  const { root } = resolved;

  if (opts.seen !== undefined) return commitSeen(root, opts.seen);
  return readAndReport(resolved, Boolean(opts.json));
}

// ─── --seen: the only write path ─────────────────────────────────────────────

/**
 * Parse "<session>:<offset>" (splitting on the LAST ":" so a session id may itself
 * contain a colon), validate the offset as a non-negative integer, then advance
 * the watermark (never-regress). Throws on malformed input — a bad disposition
 * must not silently corrupt the bookmark.
 */
async function commitSeen(docsRoot: string, seen: string): Promise<DistillResult> {
  const { session, offset } = parseSeen(seen);
  const wm = await readWatermark(docsRoot);
  const advanced = advanceWatermark(wm, session, offset);
  await writeWatermark(docsRoot, advanced);
  // SECURITY: the session id is verbatim user input. A session is expected to be a
  // mage session id from a prior `--json` manifest, but nothing enforces that, so a
  // value carrying a secret (e.g. a PAT pasted by mistake) must NOT echo to the
  // terminal — logger output is scanned by no gate. If the id trips a secret/PII
  // detector, log a generic line without it; otherwise log it (it's the useful id).
  if (scanSecrets(session).length > 0) {
    logger.success(`Distill watermark advanced to ${offset}.`);
  } else {
    logger.success(`Distill watermark for ${session} advanced to ${offset}.`);
  }
  return { advanced: { session, offset } };
}

/** Split "<session>:<offset>" on the LAST colon; validate both halves. */
function parseSeen(seen: string): { session: string; offset: number } {
  const idx = seen.lastIndexOf(":");
  if (idx <= 0 || idx === seen.length - 1) {
    throw new Error(`Invalid --seen '${seen}': expected "<session>:<offset>".`);
  }
  const session = seen.slice(0, idx);
  const offsetRaw = seen.slice(idx + 1);
  // Splitting on the LAST colon means a multi-colon input like ":abc:7" would yield
  // a session of ":abc" — a malformed id no real session carries. Reject a session
  // that is empty or starts with a colon so a fat-fingered value can't seed a junk
  // watermark key.
  if (session.length === 0 || session.startsWith(":")) {
    throw new Error(`Invalid --seen session '${session}': not a valid session id.`);
  }
  // Reject anything that isn't a clean non-negative integer (no "1.5", "-1", "1e2").
  if (!/^\d+$/.test(offsetRaw)) {
    throw new Error(`Invalid --seen offset '${offsetRaw}': expected a non-negative integer.`);
  }
  return { session, offset: Number.parseInt(offsetRaw, 10) };
}

// ─── read mode: report the candidate-cluster manifest ────────────────────────

/** Read the manifest, then emit it as JSON (for the skill) or a human summary. */
async function readAndReport(
  resolved: ResolvedDocsRoot,
  asJson: boolean,
): Promise<DistillResult> {
  const { root, repo } = resolved;
  const manifest = await readDistill(root, learningsPath(root), repo);

  if (asJson) {
    process.stdout.write(JSON.stringify(manifest) + "\n");
    return { manifest };
  }

  reportHuman(manifest);
  await reportHubFanout(resolved, "distill");
  return { manifest };
}

/** A human-readable summary of the candidate clusters (one detail line each). */
function reportHuman(manifest: DistillManifest): void {
  const clusters = manifest.clusters;
  if (clusters.length === 0) {
    logger.info("No un-distilled clusters — nothing new to draft notes from.");
    return;
  }
  const sessions = new Set(clusters.map((c) => c.session)).size;
  logger.success(`${clusters.length} candidate cluster(s) across ${sessions} session(s).`);
  if (manifest.capped) {
    logger.warn("Output was capped — the spilled remainder will be re-offered next run.");
  }
  for (const c of clusters) {
    logger.detail(`${c.session} ${c.span} — ${c.hint}`);
  }
  logger.blank();
  logger.step("Plumbing engine (you don't normally run this): mage:groom (Phase 1) turns these candidates into notes, then `mage distill --seen <session>:<offset>` commits.");
}
