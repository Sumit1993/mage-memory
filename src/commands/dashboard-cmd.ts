// `mage dashboard` — generate this KB's tiered dashboard (ADR-0020).
//
// Resolves ONE knowledge base off the cwd (or a --hub path), collects a pure
// {@link DashboardData} snapshot from LOCAL FILES ONLY, and writes the tiers:
//
//   KNOWLEDGE tier (always, committable):
//     <docsRoot>/Dashboard.md    — the portable static markdown (tier 0)
//     <docsRoot>/Knowledge.base  — the Obsidian Bases frontmatter view (tier 1)
//
//   COCKPIT tier (only with --html, gitignored):
//     <docsRoot>/dashboard.html  — the self-contained interactive cockpit (tier 2)
//
// The cockpit embeds `.metrics`-derived data (the grooming queue, context-match
// rates, the recurrence ladder) so it must NEVER be committed (ADR-0020 §6). We
// gitignore it at the same root `mage init`/`connect` use for the capture sinks:
// the code-repo root for in-repo, the hub root for a hub.
//
// This command never throws on a missing KB — it prints a friendly hint and
// returns `{ written: [] }` so a hook/CI caller degrades gracefully.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectDashboardData } from "../dashboard/collect.js";
import { renderKnowledgeBase } from "../dashboard/bases.js";
import { renderCockpitHtml } from "../dashboard/html.js";
import type { OpenWith } from "../dashboard/html.js";
import { renderDashboardMarkdown } from "../dashboard/markdown.js";
import { ensureGitignored } from "../gitignore.js";
import { logger } from "../logger.js";
import { absolutePath, resolveDocsRoot } from "../paths.js";
import { mageVersion } from "../version.js";

/** The committable knowledge-tier markdown dashboard (tier 0). */
const DASHBOARD_MD = "Dashboard.md";
/** The committable Obsidian Bases frontmatter view (tier 1). */
const KNOWLEDGE_BASE = "Knowledge.base";
/** The gitignored, self-contained cockpit (tier 2). */
const DASHBOARD_HTML = "dashboard.html";

/** Options for {@link dashboard}. */
export interface DashboardOptions {
  /** Working directory for KB resolution (test isolation; default process.cwd()). */
  cwd?: string;
  /** Hub root to resolve the KB from (honored like `doctor --hub`). */
  hub?: string;
  /** Also generate the gitignored, self-contained `dashboard.html` cockpit. */
  html?: boolean;
  /** Print the command to open the html (never spawns a browser). */
  open?: boolean;
  /**
   * Where clicking a note (graph node or Notes-table row) opens it. Defaults to
   * `file` — a relative link that opens the raw file from the page's own origin
   * (works in any browser/OS, including WSL). See {@link OpenWith}.
   */
  openWith?: OpenWith;
}

/** Result of {@link dashboard} — the absolute paths actually written. */
export interface DashboardResult {
  written: string[];
}

/**
 * Generate this KB's dashboard. Always writes the committable knowledge tier
 * (`Dashboard.md` + `Knowledge.base`); with `--html` also writes the gitignored
 * `dashboard.html` cockpit and ensures it can never be committed. Returns the
 * absolute paths written. A missing KB prints a friendly hint and returns no
 * paths (never throws).
 */
export async function dashboard(opts: DashboardOptions = {}): Promise<DashboardResult> {
  // Resolve the KB. A --hub path takes precedence as the start dir (mirrors how
  // doctor treats --hub for the hub-at-cwd probe); otherwise walk up from cwd.
  const startDir = opts.hub ? absolutePath(opts.hub) : (opts.cwd ?? process.cwd());
  const kb = await resolveDocsRoot(startDir);
  if (!kb) {
    logger.error(
      `No mage knowledge base found at or above ${startDir} — run \`mage init\` first, or pass --hub <path>.`,
    );
    return { written: [] };
  }

  const { root, kind, repo } = kb;
  const data = await collectDashboardData({ root, kind }, { mageVersion: mageVersion() });

  const written: string[] = [];

  // ── KNOWLEDGE tier — always written, committable. ──
  const mdPath = join(root, DASHBOARD_MD);
  await writeFile(mdPath, renderDashboardMarkdown(data));
  written.push(mdPath);

  const basePath = join(root, KNOWLEDGE_BASE);
  await writeFile(basePath, renderKnowledgeBase(data));
  written.push(basePath);

  // ── COCKPIT tier — only with --html, gitignored so it can never be committed. ──
  let htmlPath: string | undefined;
  if (opts.html) {
    htmlPath = join(root, DASHBOARD_HTML);
    await writeFile(htmlPath, renderCockpitHtml(data, { openWith: opts.openWith }));
    written.push(htmlPath);
    // Pass the repo dependency EXPLICITLY so the gitignore-root selection is
    // visible and type-checked at the call site (ignoreCockpit needs `repo`).
    await ignoreCockpit({ root, kind, repo });
  }

  // ── report what was written + the open hint. ──
  logger.success(`Wrote ${written.length} dashboard file(s) for ${data.meta.kbName}:`);
  for (const p of written) logger.detail(p);
  if (htmlPath) {
    logger.info(`open: ${htmlPath}`);
    if (opts.open) logger.detail(`run: explorer.exe "${htmlPath}"  # (or open/xdg-open)`);
  }

  return { written };
}

/**
 * Gitignore the cockpit at the right root so it can never be committed (ADR-0020
 * §6). Mirrors connect.ts's sink-ignore root selection EXACTLY:
 *   - in-repo: ignore `mage/dashboard.html` at the CODE-REPO root (`kb.repo`).
 *   - hub:     ignore `dashboard.html` at the hub root (`kb.root`).
 */
async function ignoreCockpit(kb: {
  root: string;
  repo: string;
  kind: "repo" | "hub";
}): Promise<void> {
  const { root, patterns } =
    kb.kind === "repo"
      ? { root: kb.repo, patterns: [`mage/${DASHBOARD_HTML}`] }
      : { root: kb.root, patterns: [DASHBOARD_HTML] };

  const added = await ensureGitignored(root, patterns);
  if (added.length > 0) {
    logger.detail(`Gitignored the cockpit so it can never be committed: ${added.join(", ")}`);
  }
}
