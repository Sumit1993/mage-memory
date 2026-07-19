import pc from "picocolors";
import { logger } from "../logger.js";
import { resolveDocsRoot } from "../paths.js";
import { type Footprint, formatTokensEst, measureFootprint } from "../metrics/footprint.js";
import { type FootprintTrend, readTrend } from "../metrics/footprint-trend.js";

export interface FootprintOptions {
  cwd?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface FootprintResult {
  repo: string;
  footprint: Footprint | null;
  trend?: FootprintTrend | null;
}

export async function footprint(opts: FootprintOptions = {}): Promise<FootprintResult> {
  const start = opts.cwd ?? process.cwd();

  const resolved = await resolveDocsRoot(start).catch(() => null);
  if (!resolved) {
    if (!opts.quiet) logger.info("No knowledge base found.");
    return { repo: start, footprint: null };
  }

  const { root, repo } = resolved;
  const footprintData = await measureFootprint(root);
  const trendData = await readTrend(root);

  if (opts.quiet) return { repo, footprint: footprintData, trend: trendData };

  if (opts.json) {
    console.log(JSON.stringify({ footprint: footprintData, trend: trendData }, null, 2));
    return { repo, footprint: footprintData, trend: trendData };
  }

  renderFootprint(repo, footprintData, trendData);
  return { repo, footprint: footprintData, trend: trendData };
}

function renderFootprint(repo: string, fp: Footprint, trend: FootprintTrend) {
  const b = fp.budget;
  const p = fp.pointers;
  const y = fp.yield;

  logger.blank();
  const repoName = repo.split(/[\\/]/).pop() || repo;
  logger.info(`Context footprint — ${repoName}`);

  const ratioPctBytes = b.capBytes > 0 ? (b.byteRatio * 100).toFixed(0) : "0";
  const ratioPctLines = b.capLines > 0 ? (b.lineRatio * 100).toFixed(0) : "0";

  let stateWord: string = b.state;
  let remedyLine = "";
  if (b.state === "warn") {
    stateWord = pc.yellow(b.state);
    remedyLine = "  -> run `mage index` to regenerate, or `mage doctor` for detail";
  } else if (b.state === "breach") {
    stateWord = pc.red(b.state);
    remedyLine = "  -> run `mage index` to regenerate, or `mage doctor` for detail";
  } else {
    stateWord = pc.green(b.state);
  }

  logger.info(`Recall budget:`);
  logger.info(`  bytes: ${b.usedBytes.toLocaleString()} / ${b.capBytes.toLocaleString()} B (${ratioPctBytes}%)`);
  logger.info(`  lines: ${b.usedLines.toLocaleString()} / ${b.capLines.toLocaleString()} lines (${ratioPctLines}%)`);
  logger.info(`  state: ${stateWord}`);
  if (remedyLine) {
    logger.detail(remedyLine);
  }

  logger.blank();
  logger.info("Estimated launch cost by surface");

  let totalBytes = 0;
  const maxLabel = Math.max(5, ...fp.surfaces.map(s => s.label.length));

  const surfaceLine = (s: (typeof fp.surfaces)[number], modeStr: string) => {
    const label = s.label.padEnd(maxLabel);
    const bytesStr = `${s.bytes.toLocaleString()} B`.padStart(10);
    const estTokens = `(${formatTokensEst(s.bytes)})`.padEnd(16);
    logger.info(`  ${label}  ${bytesStr}  ${estTokens}   ${modeStr}`);
  };

  for (const s of fp.surfaces) {
    if (s.loadMode === "on-follow") continue;

    totalBytes += s.bytes;

    let modeStr = "";
    if (s.capped) {
      const pct = b.capBytes > 0 ? ((s.bytes / b.capBytes) * 100).toFixed(0) : "0";
      modeStr = `${pct}% of cap   <- capped`;
    } else {
      if (s.loadMode === "import") {
        modeStr = "@import";
      } else if (s.loadMode === "description-only") {
        modeStr = "description only";
      }
    }

    surfaceLine(s, modeStr);
  }

  logger.info(`  ${"-".repeat(maxLabel + 12 + 16 + 14)}`);
  logger.info(`  ${"total".padEnd(maxLabel)}  ${totalBytes.toLocaleString().padStart(8)} B  ${`(${formatTokensEst(totalBytes)})`.padEnd(16)}`);

  // ADR-0039 §4: on-follow surfaces are measured and SHOWN, but excluded from the
  // launch total — counting them would overstate launch cost by ~2x. Hiding them
  // is the other failure: `_index.<wing>.md` is the largest file mage generates.
  const onFollow = fp.surfaces.filter((s) => s.loadMode === "on-follow");
  if (onFollow.length > 0) {
    logger.blank();
    logger.info("Not in the total - paid only if the agent opens it");
    for (const s of onFollow) surfaceLine(s, "on-follow");
  }

  logger.blank();
  logger.info("Yield (note reads)");
  if (!y.sufficientData) {
    logger.info(`  insufficient data - ${y.sessions} sessions recorded, need 30`);
  } else {
    logger.info(`  ${y.notesRead} notes read, ${y.notesNeverRead} unread in ${y.sessions} sessions`);
  }

  logger.blank();
  logger.info("Pointer leverage - a CEILING on avoided reads, not a realization");

  if (p.total === 0) {
    logger.info("  no pointers");
  } else {
    const mPct = ((p.measurable / p.total) * 100).toFixed(0);
    const uPct = ((p.unmeasurable / p.total) * 100).toFixed(0);
    const measStr = `${p.measurable} / ${p.total} (${mPct}%)`;
    
    logger.info(`  ${"measurable pointers".padEnd(21)} ${measStr.padEnd(17)} - ${uPct}% are URLs or opaque refs`);
    if (p.dead > 0) {
      logger.info(`  ${"dead pointers".padEnd(21)} ${p.dead.toString().padEnd(17)} -> run \`mage doctor\``);
    } else {
      logger.info(`  ${"dead pointers".padEnd(21)} 0`);
    }
  }

  logger.blank();
  logger.info(`Trend (last ${trend.rows.length} sessions)`);
  if (trend.rows.length < 3) {
    logger.info(`  insufficient data - ${trend.rows.length} sample(s)`);
  } else {
    const first = trend.rows[0]!;
    const last = trend.rows[trend.rows.length - 1]!;
    
    let deltaBytesStr = "";
    if (last.bytes > first.bytes) {
      deltaBytesStr = `+${(last.bytes - first.bytes).toLocaleString()} B`;
    } else if (last.bytes < first.bytes) {
      deltaBytesStr = `${(last.bytes - first.bytes).toLocaleString()} B`;
    } else {
      deltaBytesStr = "no change";
    }

    const firstLines = typeof first.lines === "number" ? first.lines : 0;
    const lastLines = typeof last.lines === "number" ? last.lines : 0;
    
    let deltaLinesStr = "";
    if (lastLines > firstLines) {
      deltaLinesStr = `+${(lastLines - firstLines).toLocaleString()} lines`;
    } else if (lastLines < firstLines) {
      deltaLinesStr = `${(lastLines - firstLines).toLocaleString()} lines`;
    } else {
      deltaLinesStr = "no change";
    }

    logger.info(`  ${first.bytes.toLocaleString()} B  ->  ${last.bytes.toLocaleString()} B    ${deltaBytesStr} over ${trend.rows.length} sessions`);
    if (typeof first.lines === "number" && typeof last.lines === "number") {
      logger.info(`  ${first.lines.toLocaleString()} lines  ->  ${last.lines.toLocaleString()} lines    ${deltaLinesStr} over ${trend.rows.length} sessions`);
    }
  }
}
