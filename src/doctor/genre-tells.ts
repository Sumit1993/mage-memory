// Genre-tell annotations for doctor (ADR-0041 §5 & Wave 1).
// Read-only info-level annotations flagging notes that carry PM/work/doc genre tells:
//  - size: note byte size > noteSizeCap (imported from thresholds.ts — doctor is its 1st importer)
//  - done-state vocabulary: count of \b(shipped|deferred|build order|critical path)\b + PR #\d+ >= 5
//  - issue-ref density: count of #\d+ >= 10
//  - checkboxes: any `- [ ]` / `- [x]` / `- [X]` line (>= 1)
// Read-only, fail-open, NEVER fails doctor or alters exit code.

import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import { isGeneratedArtifact, listNotePaths, toPosix } from "../scan.js";
import { logger } from "../logger.js";
import type { resolveDocsRoot } from "../paths.js";

type Kb = NonNullable<Awaited<ReturnType<typeof resolveDocsRoot>>>;

export interface GenreTellCounts {
  size?: number;
  doneVocab?: number;
  issueRefs?: number;
  checkboxes?: number;
}

export interface FlaggedNote {
  relPath: string; // posix path relative to kb.repo (e.g. mage/notes/plan-release-sequence.md)
  tells: GenreTellCounts;
}

export interface GenreTellsReport {
  scannedCount: number;
  flagged: FlaggedNote[];
}

/**
 * Pure compute: check a note's text against genre-tell thresholds.
 * Thresholds:
 *  - size: byte size > noteSizeCap (imported from thresholds.ts)
 *  - done-state vocabulary: count of \b(shipped|deferred|build order|critical path)\b (case-insensitive)
 *    plus PR #\d+ occurrences >= 5
 *  - issue-ref density: count of #\d+ references >= 10
 *  - checkboxes: any `- [ ]` / `- [x]` / `- [X]` line (>= 1)
 */
export function checkNoteGenreTells(
  rawText: string,
  noteSizeCap: number = BASE_THRESHOLDS.noteSizeCap,
): GenreTellCounts | null {
  const byteSize = Buffer.byteLength(rawText, "utf8");
  const sizeFired = byteSize > noteSizeCap;

  const vocabMatches = rawText.match(/\b(shipped|deferred|build order|critical path)\b/gi)?.length ?? 0;
  const prMatches = rawText.match(/\bPR\s*#\d+\b/gi)?.length ?? 0;
  const doneVocabCount = vocabMatches + prMatches;
  const doneVocabFired = doneVocabCount >= 5;

  const issueRefMatches = rawText.match(/#\d+\b/g)?.length ?? 0;
  const issueRefFired = issueRefMatches >= 10;

  const checkboxMatches = rawText.match(/^\s*-\s*\[[ xX]\]/gm)?.length ?? 0;
  const checkboxesFired = checkboxMatches >= 1;

  if (!sizeFired && !doneVocabFired && !issueRefFired && !checkboxesFired) {
    return null;
  }

  const tells: GenreTellCounts = {};
  if (sizeFired) tells.size = byteSize;
  if (doneVocabFired) tells.doneVocab = doneVocabCount;
  if (issueRefFired) tells.issueRefs = issueRefMatches;
  if (checkboxesFired) tells.checkboxes = checkboxMatches;

  return tells;
}

/**
 * Scan all notes under `kb.root` and evaluate genre tells for each note.
 * Returns a summary report. Fail-open (never throws).
 */
export async function evaluateGenreTells(
  kb: Kb,
  noteSizeCap: number = BASE_THRESHOLDS.noteSizeCap,
): Promise<GenreTellsReport> {
  try {
    const rawPaths = await listNotePaths(kb.root);
    const paths = rawPaths.filter((p) => !isGeneratedArtifact(p));
    const flagged: FlaggedNote[] = [];

    for (const rel of paths) {
      const absPath = join(kb.root, rel);
      let rawText: string;
      try {
        rawText = await readFile(absPath, "utf8");
      } catch {
        continue; // fail-open on unreadable file
      }

      const tells = checkNoteGenreTells(rawText, noteSizeCap);
      if (tells) {
        // POSIX path relative to kb.repo (so for a repo KB with root=mage, returns mage/notes/foo.md)
        const relToRepo = toPosix(relative(kb.repo, absPath));
        flagged.push({ relPath: relToRepo, tells });
      }
    }

    return { scannedCount: paths.length, flagged };
  } catch {
    return { scannedCount: 0, flagged: [] };
  }
}

/**
 * Format a single flagged note line detail.
 */
export function formatFlaggedNoteLine(f: FlaggedNote): string {
  const parts: string[] = [];
  if (f.tells.size !== undefined) {
    parts.push(`size (${f.tells.size} bytes)`);
  }
  if (f.tells.doneVocab !== undefined) {
    parts.push(`done-state vocab (${f.tells.doneVocab})`);
  }
  if (f.tells.issueRefs !== undefined) {
    parts.push(`issue-ref density (${f.tells.issueRefs})`);
  }
  if (f.tells.checkboxes !== undefined) {
    parts.push(`checkboxes (${f.tells.checkboxes})`);
  }
  return `${f.relPath}: ${parts.join(", ")}`;
}

/**
 * Render genre tells section to stdout via logger.
 */
export function renderGenreTells(report: GenreTellsReport): void {
  logger.blank();
  logger.info("=== Genre tells (info) ===");
  if (report.flagged.length === 0) {
    logger.detail(`0 notes flagged of ${report.scannedCount} scanned`);
    return;
  }
  for (const f of report.flagged) {
    logger.detail(formatFlaggedNoteLine(f));
  }
  const n = report.flagged.length;
  logger.detail(`${n} note${n === 1 ? "" : "s"} flagged of ${report.scannedCount} scanned`);
}
