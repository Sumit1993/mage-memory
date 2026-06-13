import { platform } from "node:os";
import { buildReport, renderReport } from "../doctor/report.js";
import { pushKbChecks } from "../doctor/kb-checks.js";
import { pushLinkChecks } from "../doctor/link-checks.js";
import { hasGh, hasGit } from "../git.js";
import { logger } from "../logger.js";
import { absolutePath, exists, looksLikeHub, resolveDocsRoot } from "../paths.js";
import { which } from "../shell.js";

export interface DoctorOptions {
  hub?: string;
  /** Self-heal: ensure the capture sinks are gitignored, then re-evaluate. */
  fix?: boolean;
  /** Emit a redacted, content-free support bundle instead of the normal render. */
  report?: boolean;
  /** Working directory for KB resolution (test isolation; default process.cwd()). */
  cwd?: string;
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

const REQUIRED_NODE_MAJOR = 18;

/**
 * Diagnostic checks. Reports environment, tool availability, network reach, and —
 * when run inside a mage KB — KB structure, capture-sink gitignore coverage (THE
 * leak guard), and connection/hook-drift health (ADR-0021; setup-integrity gotcha).
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
  const kb = await resolveDocsRoot(opts.cwd ?? process.cwd());
  await pushKbChecks(checks, kb, opts);
  // Link integrity (two-way code-repo<->hub references; `--fix` heals a stale
  // back-reference after a move). Only meaningful inside a KB.
  if (kb) await pushLinkChecks(checks, opts);

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

  renderChecks(checks, passed);
  const me = await which("mage");
  if (me) logger.detail("(mage itself is on PATH)");

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

  // 4. Skills install method (Claude Code plugin — informational)
  checks.push(checkSkillsInstall());

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

  // 6. Network probe (optional — checks if GitHub is reachable)
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

function checkSkillsInstall(): DoctorCheck {
  // mage's skills ship as a Claude Code plugin; install is user-driven via slash
  // commands, so there is nothing to probe from the CLI — surface the how-to.
  return {
    name: "skills (Claude Code plugin)",
    ok: true,
    detail:
      "install with `/plugin marketplace add Sumit1993/mage-memory` then `/plugin install mage@mage`",
    optional: true,
  };
}

function pad(s: string): string {
  return s.padEnd(20);
}
