import { type DreamFinding, type DreamReport, analyzeDream } from "../dream.js";
import { logger } from "../logger.js";
import { absolutePath, resolveDocsRoot } from "../paths.js";

export interface DreamCmdOptions {
  /** Where to look for the knowledge base (default cwd; walks up for in-repo). */
  dir?: string;
  /** Flag notes whose `last_reviewed` is older than this many days (default 180). */
  staleDays?: number;
}

export interface DreamResult extends DreamReport {
  findingCount: number;
}

/**
 * Report knowledge-base health, read-only. The deterministic v0.1 slice of the
 * maintenance pass — it flags rot, it does not heal it (the healing `/dream`
 * sweep is v0.2, ADR-0007).
 */
export async function dream(opts: DreamCmdOptions = {}): Promise<DreamResult> {
  const start = absolutePath(opts.dir ?? process.cwd());
  const resolved = await resolveDocsRoot(start);
  if (!resolved) {
    throw new Error(`No mage knowledge base found at or above ${start}. Run \`mage init\` first.`);
  }
  const report = await analyzeDream(resolved.root, { staleDays: opts.staleDays });
  renderReport(report);
  const findingCount =
    report.supersededButActive.length +
    report.danglingLinks.length +
    report.orphans.length +
    report.stale.length;
  return { ...report, findingCount };
}

function renderReport(r: DreamReport): void {
  logger.info("mage dream — knowledge-base health (read-only)");
  logger.blank();
  if (r.clean) {
    logger.success(`${r.noteCount} note(s) scanned — no rot found. Memory is healthy.`);
    return;
  }
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

function section(title: string, findings: DreamFinding[]): void {
  if (findings.length === 0) return;
  logger.warn(`${title} (${findings.length})`);
  for (const f of findings) logger.detail(`${f.note} — ${f.detail}`);
  logger.blank();
}
