import { platform } from "node:os";
import { mageInstalledIn, mageSkillsInstalled } from "../adapters/claude-code/plugins.js";
import { buildReport, renderReport } from "../doctor/report.js";
import { evaluateGenreTells, renderGenreTells } from "../doctor/genre-tells.js";
import { pushKbChecks } from "../doctor/kb-checks.js";
import { pushLinkChecks } from "../doctor/link-checks.js";
import { analyzeDream } from "../dream.js";
import { hasGh, hasGit } from "../git.js";
import { logger } from "../logger.js";
import { absolutePath, codeRepoDocsRoot, exists, findCodeRepoRoot, looksLikeHub, readHubMetadata, resolveDocsRoot } from "../paths.js";
import { which } from "../shell.js";

export { mageInstalledIn };

export interface DoctorOptions {
  hub?: string;
  /** Self-heal: ensure the capture sinks are gitignored, then re-evaluate. */
  fix?: boolean;
  /** Emit a redacted, content-free support bundle instead of the normal render. */
  report?: boolean;
  /** Working directory for KB resolution (test isolation; default process.cwd()). */
  cwd?: string;
  /** Gather checks WITHOUT rendering or the network probe — for the setup readiness footer. */
  quiet?: boolean;
  /** Probe network reachability (GitHub). Injected opt-in (default false). */
  network?: boolean;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** false = required, true = nice-to-have. */
  optional?: boolean;
}

export interface DoctorResult {
  passed: boolean;
  checks: DoctorCheck[];
}

const REQUIRED_NODE_MAJOR = 20;

/**
 * The recall+skills checks the setup readiness footer surfaces — "can the agent find
 * and act on the knowledge", the layer beyond capture plumbing (see plan-readiness-doctor).
 */
const READINESS_CHECKS = new Set([
  "skills (Claude Code plugin)",
  "INDEX.md",
  "index freshness",
  "AGENTS.md awareness",
  // ADR-0042: an external/hybrid KB the harness cannot reach is a recall failure the
  // setup footer must surface at connect/link time, not weeks later.
  "KB access grant",
]);

/**
 * Diagnostic checks. Reports environment, tool availability, network reach, and —
 * when run inside a mage KB — KB structure, capture-sink gitignore coverage (THE
 * leak guard), connection/hook-drift health, and genre tells (ADR-0021; ADR-0041).
 *
 * Notes:
 *  - No symlinks anywhere → platform check just reports OS; junctions/symlinks irrelevant
 *  - Skills ship as a Claude Code plugin (`/plugin install mage@mage`) — informational
 *  - `--fix` self-heals the gitignore coverage check (calls ensureGitignored)
 *  - `--report` prints a redacted, content-free bundle (no paths/keywords/secrets)
 */
export async function doctor(opts: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  await pushEnvChecks(checks, opts);
  const startDir = absolutePath(opts.cwd ?? process.cwd());
  const codeRepo = await findCodeRepoRoot(startDir);
  const resolvedKb = await resolveDocsRoot(startDir);
  const kb = resolvedKb ?? (codeRepo ? { root: codeRepoDocsRoot(codeRepo), kind: "repo", repo: codeRepo } : null);
  const genreTellsReport = kb ? await evaluateGenreTells(kb) : null;
  await pushKbChecks(checks, kb, opts, genreTellsReport);
  // Link integrity (two-way code-repo<->hub references; `--fix` heals a stale
  // back-reference after a move). Only meaningful inside a KB.
  if (kb) await pushLinkChecks(checks, opts);

  // Merge-candidate annotations (annotate-never-reject, info-tier). Signal A annotates
  // directly; Signal B only above threshold, worded as a candidate, not a verdict.
  if (kb) {
    try {
      const hubMeta = kb.kind === "hub" ? await readHubMetadata(kb.root) : null;
      const report = await analyzeDream(kb.root, { hubMeta });
      const { signalA, signalB } = report.mergeCandidates;
      for (const p of signalA) {
        checks.push({
          name: "merge candidate",
          ok: true,
          optional: true,
          detail: `note pair answers-one-question? \u2014 ${p.noteA} \u2194 ${p.noteB} ${p.reason}; merge candidates`,
        });
      }
      for (const p of signalB) {
        checks.push({
          name: "merge candidate",
          ok: true,
          optional: true,
          detail: `note pair merge candidate \u2014 ${p.noteA} \u2194 ${p.noteB} (${p.reason}; review suggested)`,
        });
      }
    } catch {
      // Fail-open: merge-candidate detection must never break doctor.
    }
  }

  const passed = checks.every((c) => c.ok || c.optional);

  if (opts.report) {
    const bundle = await buildReport({
      checks,
      docsRoot: kb?.root ?? null,
      repoRoot: kb?.repo ?? null,
    });
    process.stdout.write(`${renderReport(bundle)}\n`);
    return { passed, checks };
  }

  if (!opts.quiet) {
    renderChecks(checks, passed);
    if (genreTellsReport) {
      renderGenreTells(genreTellsReport);
    }
    const me = await which("mage");
    if (me) logger.detail("(mage itself is on PATH)");
  }

  return { passed, checks };
}

// ─── environment checks (unchanged behavior) ─────────────────────────────────

async function pushEnvChecks(checks: DoctorCheck[], opts: DoctorOptions): Promise<void> {
  // 1. Node version
  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "node version",
    ok: nodeMajor >= REQUIRED_NODE_MAJOR,
    detail: `v${process.versions.node} (need >= ${REQUIRED_NODE_MAJOR})`,
  });

  // 2. Platform
  checks.push({ name: "platform", ok: true, detail: platform() });

  // 3. Required tools
  const git = await hasGit();
  checks.push({ name: "git", ok: git, detail: git ? "available" : "MISSING (required)" });

  const npx = await which("npx");
  checks.push({
    name: "npx",
    ok: npx,
    detail: npx ? "available" : "MISSING (required — comes with Node)",
  });

  const gh = await hasGh();
  checks.push({
    name: "gh (GitHub CLI)",
    ok: gh,
    detail: gh
      ? "available"
      : "missing (optional; required for `init --hub --visibility private|public`)",
    optional: true,
  });

  // 4. Skills reachable? (mage's plugin must be installed for mage:learn/groom to exist)
  checks.push(await checkSkillsInstall());

  // 5. Hub check (if cwd or --hub looks like one)
  const hubCandidate = opts.hub ? absolutePath(opts.hub) : (opts.cwd ?? process.cwd());
  if (await exists(hubCandidate)) {
    const isHub = await looksLikeHub(hubCandidate);
    if (isHub) {
      checks.push({ name: "hub at cwd", ok: true, detail: hubCandidate });
    } else {
      checks.push({
        name: "hub at cwd",
        ok: true,
        detail: `not a hub (cwd is ${hubCandidate}) — run from a hub or pass --hub`,
        optional: true,
      });
    }
  }

  // 6. Network probe (optional — checks if GitHub is reachable). Injected opt-in:
  // skipped in quiet mode or unless explicitly requested via `opts.network`.
  if (opts.quiet || !opts.network) return;
  try {
    const r = await fetch("https://github.com", { method: "HEAD", signal: AbortSignal.timeout(5000) });
    checks.push({
      name: "github reachable",
      ok: r.ok,
      detail: r.ok ? "OK" : `HTTP ${r.status}`,
      optional: true,
    });
  } catch (err) {
    // Never echo err.message: Node embeds the target address in network errors
    // (e.g. `connect ECONNREFUSED 127.0.0.1:3128`). Surface only the error code,
    // which is address-free. Belt-and-suspenders with report.ts scrubText.
    const code = (err as { code?: string } | null)?.code;
    checks.push({
      name: "github reachable",
      ok: false,
      detail: `unreachable (network error${code ? `: ${code}` : ""}) — local-only init still works`,
      optional: true,
    });
  }
}

// ─── render ──────────────────────────────────────────────────────────────────

function renderChecks(checks: DoctorCheck[], passed: boolean): void {
  logger.info("=== Environment & KB health ===");
  for (const c of checks) {
    if (c.ok) logger.success(`${pad(c.name)}: ${c.detail}`);
    else if (c.optional) logger.warn(`${pad(c.name)}: ${c.detail}`);
    else logger.error(`${pad(c.name)}: ${c.detail}`);
  }

  logger.blank();
  if (passed) logger.success("All required checks passed.");
  else logger.error("Some required checks failed.");
}

/**
 * Are mage's skills reachable to the host agent? They ship as a Claude Code plugin, so
 * the hooks can nudge "capture with mage:learn" but that skill only EXISTS once the plugin
 * is installed (the 2026-07-02 soak ran for weeks with it uninstalled). Installing is a
 * user-driven global act, so doctor DETECTS and instructs — it never installs. Reads the
 * host plugin registry; a `mage@<marketplace>` key means reachable. Fail-open (absent/
 * unreadable registry → not installed). Advisory, never a hard fail.
 */
async function checkSkillsInstall(): Promise<DoctorCheck> {
  const installed = await mageSkillsInstalled();
  if (installed) {
    return { name: "skills (Claude Code plugin)", ok: true, detail: `reachable (${installed})` };
  }
  return {
    name: "skills (Claude Code plugin)",
    ok: false,
    optional: true, // user-driven global install — instruct, never auto-fix
    detail:
      "mage plugin NOT installed — mage:learn / mage:groom are unreachable → " +
      "`/plugin marketplace add Sumit1993/mage-memory` then `/plugin install mage@mage`",
  };
}

/**
 * A compact recall+skills readiness summary, printed at the END of `connect`/`link` so
 * setup can't silently leave a unit half-wired (the soak's uninstalled-plugin and
 * stale-index drift would have surfaced right here). Runs doctor quietly (local, no
 * network) and shows only the readiness-relevant checks that are NOT ok; a clean run
 * prints one success line. Advisory — never throws, never blocks the command it trails.
 */
export async function readinessFooter(cwd: string): Promise<void> {
  try {
    const { checks } = await doctor({ cwd, quiet: true });
    const problems = checks.filter((c) => READINESS_CHECKS.has(c.name) && !c.ok);
    logger.blank();
    if (problems.length === 0) {
      logger.success("readiness: recall + skills ready");
      return;
    }
    logger.info("readiness — before the agent can work the way mage wants:");
    for (const p of problems) logger.warn(`  ${p.name}: ${p.detail}`);
  } catch {
    /* readiness is advisory — never break the command it trails */
  }
}

function pad(s: string): string {
  return s.padEnd(20);
}
