// `mage doctor --report` support bundle (ADR-0021 §3). A REDACTED, CONTENT-FREE
// dump a user can inspect and paste into a bug issue ("please attach your logs").
// It carries ONLY numbers + tool/version/OS identifiers + content-free check
// outcomes. It NEVER emits note content, keywords, full paths, or secrets — every
// piece of free text is reduced to a basename and routed through redact() as a
// belt-and-suspenders boundary.

import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { platform, release } from "node:os";
import type { DoctorCheck } from "../commands/doctor.js";
import { learningsPath, NOTES_DIR } from "../paths.js";
import { redact } from "../redact.js";
import { readRollup, summarize } from "../metrics/rollup.js";
import { mageVersion } from "../version.js";

/** A content-free metrics summary: numeric aggregates only (ADR-0021 §3). */
export interface ReportMetrics {
  loads: number;
  matches: number;
  /** loads === 0 → 0. Rounded to 3 d.p. so it reads cleanly. */
  matchRate: number;
  skillCount: number;
  noteCount: number;
}

/** A content-free render of one health check (no paths, no detail leakage). */
export interface ReportCheck {
  name: string;
  ok: boolean;
  /** A scrubbed, path-free, redact()-ed restatement of the check detail. */
  detail: string;
}

/** The full support bundle — every field is safe to paste into a public issue. */
export interface ReportBundle {
  mageVersion: string;
  node: string;
  os: string;
  checks: ReportCheck[];
  metrics: ReportMetrics;
  /** Count of recent error events seen (tool_use with ok:false); 0 if none/cheap-miss. */
  recentErrors: number;
}

/**
 * Build the content-free support bundle. `docsRoot`/`repoRoot` may be null when
 * there is no KB here — metrics then read as zeros and note count as 0.
 */
export async function buildReport(args: {
  checks: DoctorCheck[];
  docsRoot: string | null;
  repoRoot: string | null;
}): Promise<ReportBundle> {
  const { checks, docsRoot, repoRoot } = args;

  const metrics = await collectMetrics(docsRoot);
  const recentErrors = docsRoot ? await countRecentErrors(docsRoot) : 0;

  return {
    mageVersion: mageVersion(),
    node: process.versions.node,
    os: `${platform()} ${release()}`,
    checks: checks.map((c) => scrubCheck(c, repoRoot, docsRoot)),
    metrics,
    recentErrors,
  };
}

/**
 * Render the bundle to plain text. The output is deliberately boring: a header,
 * version/OS lines, one line per check, the metrics block, and the error count.
 * Returned as a string so the caller writes it (and tests can assert on it).
 */
export function renderReport(b: ReportBundle): string {
  const lines: string[] = [];
  lines.push("=== mage doctor --report (redacted, content-free) ===");
  lines.push(`mage:    ${b.mageVersion}`);
  lines.push(`node:    ${b.node}`);
  lines.push(`os:      ${b.os}`);
  lines.push("");
  lines.push("checks:");
  for (const c of b.checks) {
    lines.push(`  [${c.ok ? "ok" : "!!"}] ${c.name.padEnd(20)} ${c.detail}`);
  }
  lines.push("");
  lines.push("metrics (numbers only):");
  lines.push(`  loads=${b.metrics.loads} matches=${b.metrics.matches} matchRate=${b.metrics.matchRate}`);
  lines.push(`  skills=${b.metrics.skillCount} notes=${b.metrics.noteCount}`);
  lines.push(`  recentErrors=${b.recentErrors}`);
  lines.push("");
  lines.push("(No note content, keywords, paths, or secrets are included.)");
  return lines.join("\n");
}

// ─── internals ───────────────────────────────────────────────────────────────

/** Fold the rollup into numeric aggregates + count `.md` notes. All numbers. */
async function collectMetrics(docsRoot: string | null): Promise<ReportMetrics> {
  if (!docsRoot) {
    return { loads: 0, matches: 0, matchRate: 0, skillCount: 0, noteCount: 0 };
  }
  const rows = summarize(await readRollup(docsRoot));
  let loads = 0;
  let matches = 0;
  for (const r of rows) {
    loads += r.loads;
    matches += Math.round(r.matchRate * r.loads);
  }
  const matchRate = loads > 0 ? Math.round((matches / loads) * 1000) / 1000 : 0;
  const noteCount = await countNotes(join(docsRoot, NOTES_DIR));
  return { loads, matches, matchRate, skillCount: rows.length, noteCount };
}

/** Recursively count `.md` files under a notes dir. Best-effort; 0 on any error. */
async function countNotes(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const ent of entries) {
    if (ent.isDirectory()) n += await countNotes(join(dir, ent.name));
    else if (ent.name.endsWith(".md")) n += 1;
  }
  return n;
}

/**
 * Cheaply count recent error events: tool_use lines with `"ok":false` across the
 * `.learnings/*.jsonl` session streams. We grep the raw text for the literal
 * marker rather than JSON-parsing every line — content-free (we never read the
 * error_summary), and bounded by only reading top-level `.jsonl` files. 0 on miss.
 */
async function countRecentErrors(docsRoot: string): Promise<number> {
  const learnings = learningsPath(docsRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(learnings, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
    if (ent.name.endsWith(".skills.jsonl")) continue;
    let raw: string;
    try {
      raw = await readFile(join(learnings, ent.name), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.includes('"type":"tool_use"') && line.includes('"ok":false')) total += 1;
    }
  }
  return total;
}

/**
 * Reduce a check to a content-free form: strip absolute paths to a bare "<path>",
 * drop any root prefixes (repo root / docs root), scrub IP addresses, then
 * redact() the remainder as a final safety net so no secret-shaped, path-shaped,
 * or address-shaped fragment escapes. The `name` field is scrubbed too (names are
 * static literals today, but routing them through the same boundary future-proofs
 * it so a later dynamic name can never leak verbatim).
 */
function scrubCheck(c: DoctorCheck, repoRoot: string | null, docsRoot: string | null): ReportCheck {
  return {
    name: scrubText(c.name, repoRoot, docsRoot),
    ok: c.ok,
    detail: scrubText(c.detail, repoRoot, docsRoot),
  };
}

/**
 * Strip path and address content from a free-text detail. Any known root
 * (repoRoot/docsRoot) is replaced with the placeholder "<kb>"; any remaining
 * absolute path token (POSIX leading-slash or Windows drive) is reduced to a
 * bare "<path>" with NO surviving segment (not even a basename); IPv4 addresses
 * (with optional :port) become "<addr>". The result is then redact()-ed.
 */
export function scrubText(text: string, repoRoot: string | null, docsRoot: string | null): string {
  let out = text;
  for (const root of [docsRoot, repoRoot]) {
    if (root) out = out.split(root).join("<kb>");
  }
  // Reduce any remaining absolute path token to a bare "<path>" — leaking even a
  // single basename can reveal a project or user name, so no segment survives.
  // Covers Windows drive-absolute (`C:\...`), POSIX multi-segment (`/a/b`), and
  // single-segment roots (`/tmp`, `/run`, `/var`). Only leading-slash / drive
  // forms are targeted, so version strings and non-path text are left intact.
  out = out.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/]+)+/g, "<path>");
  // IPv4 (optionally `:port`) — e.g. an `ECONNREFUSED 127.0.0.1:3128` proxy addr.
  out = out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, "<addr>");
  return redact(out).text;
}
