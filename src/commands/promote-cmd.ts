// `mage promote` (ADR-0019 §1, §4). The PLUMBING half of self-grooming: a
// deterministic recurrence fold + a watermark commit — distill's sibling. Two modes,
// one of which advances a bookmark:
//
//   mage promote            → READ. Fold every CLOSED `.learnings/` segment into a
//                             per-(wing+keywords) signature recurrence tally (counting
//                             DISTINCT sessions), persist the derived tally (like the
//                             rollup Stop-fold), then build the manifest of fresh
//                             note-candidates (>= K sessions, no covering note, not
//                             rejected). --json emits the manifest the `mage:groom`
//                             skill drafts notes from; else a human summary.
//   mage promote --seen S:N → Disposition a batch: advance session S's tally offset to
//                             N (never-regress) and persist. Marks the proposals the
//                             manifest's `cursors` suggested as seen. An interrupted run
//                             never reaches here, so a re-run safely re-offers.
//
// This mirrors `mage distill` EXACTLY (distill-cmd.ts): the CLI does the determinism,
// the skill does the judgment. No model lives here (ADR-0009).

import { logger } from "../logger.js";
import { learningsPath, requireDocsRoot } from "../paths.js";
import { reportHubFanout } from "./fanout-hint.js";
import { scanNotes } from "../scan.js";
import { scanSecrets } from "../redact.js";
import { buildManifest } from "../grooming/promote.js";
import { foldTally, readTally, writeTally } from "../grooming/tally.js";
import { readRejected } from "../grooming/proposals.js";
import { readSensitivity } from "../grooming/config.js";
import { thresholdsFor } from "../grooming/thresholds.js";
import type { PromoteManifest, PromoteTally } from "../grooming/types.js";

/** Options for {@link promoteCmd}. */
export interface PromoteOptions {
  /** Working directory for resolving the docs root (default: cwd). */
  dir?: string;
  /** Emit the manifest as a single JSON line for the skill (read mode only). */
  json?: boolean;
  /** Commit a disposition: "<session>:<offset>" — advances the tally offset. */
  seen?: string;
}

/** Result of {@link promoteCmd}: a manifest (read mode) XOR an advance (--seen). */
export interface PromoteResult {
  manifest?: PromoteManifest;
  advanced?: { session: string; offset: number };
}

/**
 * Run `mage promote`. Resolves the docs root (a friendly error when there's no
 * knowledge base), then either commits a `--seen` disposition (advance the tally
 * offset) or folds the tally + builds the note-candidate manifest.
 */
export async function promoteCmd(opts: PromoteOptions): Promise<PromoteResult> {
  const resolved = await requireDocsRoot(opts.dir);
  if (opts.seen !== undefined) return commitSeen(resolved.root, opts.seen);
  return readAndReport(resolved, Boolean(opts.json));
}

// ─── --seen: advance the tally offset ────────────────────────────────────────

/**
 * Parse "<session>:<offset>" (splitting on the LAST ":" so a session id may itself
 * contain a colon), validate the offset as a non-negative integer, then advance the
 * tally's per-session offset (never-regress). Throws on malformed input — a bad
 * disposition must not silently corrupt the bookmark.
 */
async function commitSeen(docsRoot: string, seen: string): Promise<PromoteResult> {
  const { session, offset } = parseSeen(seen);
  // Read the persisted tally (the bookmark) and advance JUST this session's offset —
  // do NOT re-fold (the read path folds; mirrors distill commitSeen reading the
  // watermark, not re-reading `.learnings`). Folding here would prune a session whose
  // file already purged and lose its offset.
  const tally = await readTally(docsRoot);
  const advanced = advanceOffset(tally, session, offset);
  await writeTally(docsRoot, advanced);
  // SECURITY: the session id is verbatim user input. A session is expected to be a
  // mage session id from a prior `--json` manifest, but nothing enforces that, so a
  // value carrying a secret (e.g. a PAT pasted by mistake) must NOT echo to the
  // terminal — logger output is scanned by no gate. If the id trips a secret/PII
  // detector, log a generic line without it; otherwise log it (it's the useful id).
  if (scanSecrets(session).length > 0) {
    logger.success(`Promote offset advanced to ${offset}.`);
  } else {
    logger.success(`Promote offset for ${session} advanced to ${offset}.`);
  }
  return { advanced: { session, offset } };
}

/**
 * Advance a session's tally offset, never regressing. Returns a NEW tally (the input
 * is never mutated). A session with no fold yet seeds a fresh `{offset, sigs:[]}` so a
 * disposition can mark a session the fold hasn't reached.
 */
function advanceOffset(tally: PromoteTally, session: string, offset: number): PromoteTally {
  const prev = tally.sessions[session] ?? { offset: 0, sigs: [] };
  return {
    ...tally,
    sessions: {
      ...tally.sessions,
      [session]: { offset: Math.max(prev.offset, offset), sigs: [...prev.sigs] },
    },
  };
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
  // offset key.
  if (session.length === 0 || session.startsWith(":")) {
    throw new Error(`Invalid --seen session '${session}': not a valid session id.`);
  }
  // Reject anything that isn't a clean non-negative integer (no "1.5", "-1", "1e2").
  if (!/^\d+$/.test(offsetRaw)) {
    throw new Error(`Invalid --seen offset '${offsetRaw}': expected a non-negative integer.`);
  }
  return { session, offset: Number.parseInt(offsetRaw, 10) };
}

// ─── read mode: fold the tally + report the note-candidate manifest ──────────

/**
 * Fold the recurrence tally (persisting the derived cache, like the rollup Stop-fold),
 * read the dial → thresholds, load the notes + rejected buffer, build the manifest,
 * then emit it as JSON (for the skill) or a human summary.
 */
async function readAndReport(
  resolved: { root: string; kind: "repo" | "hub"; repo: string },
  asJson: boolean,
): Promise<PromoteResult> {
  const { root, repo } = resolved;

  // Fold + persist the derived tally (the read path writes it — a derived cache, like
  // the rollup Stop fold). repoRoot mirrors readDistill: the resolved code repo / hub.
  const tally = await foldTally(root, learningsPath(root), repo);
  await writeTally(root, tally);

  const sensitivity = await readSensitivity(resolved);
  const thresholds = thresholdsFor(sensitivity);
  const notes = await scanNotes(root);
  const rejected = await readRejected(root);
  const cursors = cursorsFromTally(tally);
  const manifest = buildManifest(tally, notes, thresholds, rejected, cursors);

  if (asJson) {
    process.stdout.write(JSON.stringify(manifest) + "\n");
    return { manifest };
  }

  reportHuman(manifest);
  await reportHubFanout(resolved, "promote");
  return { manifest };
}

/** The suggested per-session cursors: each session's already-folded offset. */
function cursorsFromTally(tally: PromoteTally): Record<string, number> {
  const cursors: Record<string, number> = {};
  for (const [session, fold] of Object.entries(tally.sessions)) {
    cursors[session] = fold.offset;
  }
  return cursors;
}

/** A human-readable summary of the graduation proposals (one detail line each). */
function reportHuman(manifest: PromoteManifest): void {
  const proposals = manifest.proposals;
  if (proposals.length === 0) {
    if (manifest.covered > 0) {
      logger.info(
        `No notes ready to graduate — ${manifest.covered} recurring signature(s) covered by notes, none proven yet.`,
      );
    } else {
      logger.info("No covered recurring signatures yet.");
    }
    return;
  }
  logger.success(
    `${proposals.length} note(s) ready to graduate; ${manifest.covered} recurring signature(s) covered.`,
  );
  if (manifest.deferred > 0) {
    logger.info(
      `+${manifest.deferred} more eligible — surfaced the strongest ${proposals.length} this pass (bounded promotion budget; the rest defer).`,
    );
  }
  for (const p of proposals) {
    logger.detail(`${p.target} — ${p.evidence}`);
  }
  logger.blank();
  logger.step(
    "Plumbing engine (you don't normally run this): mage:graduate turns a proven note into a Procedure skill. Recurrence no longer proposes NEW notes (ADR-0038) — capture those with mage:learn.",
  );
}
