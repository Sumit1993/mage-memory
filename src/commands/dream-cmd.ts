import { type DreamFinding, type DreamReport, analyzeDream } from "../dream.js";
import { applyProposal } from "../dream/applier.js";
import type { ApplyResult } from "../dream/types.js";
import { isRejected, readRejected, writeRejected } from "../grooming/proposals.js";
import type { Proposal, ProposalAction } from "../grooming/types.js";
import { logger } from "../logger.js";
import { readHubMetadata, requireDocsRoot } from "../paths.js";

/** The proposal actions the applier (`--apply`) accepts. */
const VALID_ACTIONS: ReadonlySet<ProposalAction> = new Set<ProposalAction>([
  "note",
  "graduate",
  "merge",
  "split",
  "reword",
  "demote",
]);

export interface DreamCmdOptions {
  /** Where to look for the knowledge base (default cwd; walks up for in-repo). */
  dir?: string;
  /** Flag notes whose `last_reviewed` is older than this many days (default 180). */
  staleDays?: number;
  /** --apply: read ONE Proposal JSON from stdin → applyProposal (the single writer). */
  apply?: boolean;
  /** --reject: read ONE Proposal from stdin → append to the rejected-edit buffer. */
  reject?: boolean;
}

export interface DreamResult extends DreamReport {
  findingCount: number;
}

/**
 * Report knowledge-base health, read-only (default), OR — with `--apply`/`--reject` —
 * run the Stage-2 application seam. "Detection proposes, dream applies" (ADR-0016 §4):
 *
 *   --apply   read ONE Proposal JSON from stdin → `applyProposal` (the single writer
 *             that enforces the §3 ceilings, then writes/archives/removes). NEVER commits.
 *   --reject  read ONE Proposal from stdin → append to the rejected-edit buffer (dedup
 *             via `isRejected`) so mage backs off and doesn't re-pester.
 *   (default) the deterministic read-only health report — flags rot, never heals it.
 *
 * Both seams are FAIL-CLOSED on a malformed proposal: a clear throw, never a silent
 * partial apply.
 */
export async function dream(opts: DreamCmdOptions = {}): Promise<DreamResult> {
  const resolved = await requireDocsRoot(opts.dir);

  // ── --apply: the single serialized writer (ADR-0016 §4). ──
  if (opts.apply) {
    await applyMode(resolved.root, resolved.repo);
    return emptyResult(resolved.root);
  }
  // ── --reject: append to the back-off buffer. ──
  if (opts.reject) {
    await rejectMode(resolved.root);
    return emptyResult(resolved.root);
  }

  // ── default: read-only health report. ──
  // Hub registry enables the project drift signals (info-tier, never failures).
  const hubMeta = resolved.kind === "hub" ? await readHubMetadata(resolved.root) : null;
  const report = await analyzeDream(resolved.root, { staleDays: opts.staleDays, hubMeta });
  renderReport(report);
  // findingCount counts ONLY failure-tier rot — the info drift is advisory.
  const findingCount =
    report.supersededButActive.length +
    report.danglingLinks.length +
    report.orphans.length +
    report.stale.length;
  return { ...report, findingCount };
}

// ─── --apply / --reject (ADR-0016 §4: detection proposes, dream applies) ─────────

/** Read a Proposal from stdin, apply it via the single writer, render the result. */
async function applyMode(docsRoot: string, repo: string): Promise<void> {
  const proposal = await readProposalFromStdin();
  const result = await applyProposal(docsRoot, repo, proposal);
  renderApplyResult(result);
}

/** Read a Proposal from stdin, append it to the rejected-edit buffer (deduped). */
async function rejectMode(docsRoot: string): Promise<void> {
  const proposal = await readProposalFromStdin();
  const rejected = await readRejected(docsRoot);
  if (isRejected(proposal, rejected)) {
    logger.info(`Already rejected ${proposal.action} ${proposal.target} — backing off (no change).`);
    return;
  }
  await writeRejected(docsRoot, [...rejected, proposal]);
  logger.success(`Rejected ${proposal.action} ${proposal.target} — mage will back off and not re-pester.`);
}

/**
 * Drain stdin and parse it as ONE Proposal. FAIL-CLOSED: empty stdin, non-JSON, or a
 * shape missing `action`/`target` (or an unknown action) throws a clear error — the
 * applier must never run on a malformed proposal.
 */
async function readProposalFromStdin(): Promise<Proposal> {
  const raw = (await readStdin()).trim();
  if (raw.length === 0) {
    throw new Error("mage dream: no proposal on stdin (expected one Proposal JSON).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("mage dream: stdin is not valid JSON (expected one Proposal).");
  }
  return asProposal(parsed);
}

/** Structurally validate an untrusted value as a Proposal — fail-closed. */
function asProposal(v: unknown): Proposal {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("mage dream: proposal must be a JSON object.");
  }
  const p = v as Partial<Proposal>;
  if (typeof p.action !== "string" || !VALID_ACTIONS.has(p.action as ProposalAction)) {
    throw new Error(`mage dream: proposal.action '${String(p.action)}' is not a valid action.`);
  }
  if (typeof p.target !== "string") {
    throw new Error("mage dream: proposal.target must be a string.");
  }
  return {
    action: p.action,
    target: p.target,
    payload: (p.payload && typeof p.payload === "object" ? p.payload : {}) as Record<string, unknown>,
    evidence: typeof p.evidence === "string" ? p.evidence : "",
  };
}

/** Drain stdin to a UTF-8 string. Resolves "" on an empty/closed stream; rejects on error. */
function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", (err: unknown) =>
      reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

/** Render an ApplyResult: a refusal (with reason) or the writes/archives performed. */
function renderApplyResult(r: ApplyResult): void {
  logger.info(`mage dream --apply — ${r.action} (the single writer; never commits)`);
  logger.blank();
  if (!r.ok) {
    logger.error(`Refused: ${r.refused ?? "unknown reason"}`);
    logger.detail("Nothing was written, archived, or removed (the proposal was blocked by a ceiling).");
    return;
  }
  logger.success(r.summary);
  for (const w of r.written) logger.detail(`wrote ${w}`);
  for (const a of r.archived) logger.detail(`archived ${a}`);
  logger.blank();
  logger.detail("Review the diff and commit it yourself — mage never commits (ADR-0016 §3).");
}

/** A health-report-shaped no-op result for the apply/reject seams (they don't report rot). */
function emptyResult(root: string): DreamResult {
  return {
    root,
    noteCount: 0,
    clean: true,
    supersededButActive: [],
    danglingLinks: [],
    orphans: [],
    stale: [],
    emptyProjects: [],
    unregisteredProjectDirs: [],
    untaggedNudge: [],
    findingCount: 0,
  };
}

function renderReport(r: DreamReport): void {
  logger.info("mage dream — knowledge-base health (read-only)");
  logger.blank();
  if (r.clean) {
    logger.success(`${r.noteCount} note(s) scanned — no rot found. Memory is healthy.`);
  } else {
    logger.detail(`${r.noteCount} note(s) scanned`);
    logger.blank();
    section("superseded but still active", r.supersededButActive);
    section("dangling links", r.danglingLinks);
    section("orphan notes", r.orphans);
    section("stale / unreviewed", r.stale);
    logger.detail(
      "Read-only (v0.1). The healing sweep — decay/consolidate/re-verify/prune — is `/dream` (v0.2).",
    );
  }
  renderDriftInfo(r);
}

/** Advisory drift — printed even when clean; never counted as a finding/failure. */
function renderDriftInfo(r: DreamReport): void {
  if (!r.emptyProjects.length && !r.unregisteredProjectDirs.length && !r.untaggedNudge.length) return;
  logger.blank();
  logger.info("info (advisory — never failures):");
  if (r.emptyProjects.length > 0) {
    logger.detail(`registered project(s) with 0 indexed notes: ${r.emptyProjects.join(", ")}`);
  }
  if (r.unregisteredProjectDirs.length > 0) {
    logger.detail(`projects/ dir(s) not in the registry: ${r.unregisteredProjectDirs.join(", ")}`);
  }
  for (const m of r.untaggedNudge) logger.detail(m);
}

function section(title: string, findings: DreamFinding[]): void {
  if (findings.length === 0) return;
  logger.warn(`${title} (${findings.length})`);
  for (const f of findings) logger.detail(`${f.note} — ${f.detail}`);
  logger.blank();
}
