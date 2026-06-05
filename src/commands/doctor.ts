import { platform } from "node:os";
import { hasGh, hasGit } from "../git.js";
import { logger } from "../logger.js";
import { absolutePath, exists, looksLikeHub } from "../paths.js";
import { which } from "../shell.js";

export interface DoctorOptions {
  hub?: string;
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
 * Diagnostic checks. Reports environment, tool availability, network reach,
 * and (if cwd is a hub) basic hub structure.
 *
 * Notes:
 *  - No symlinks anywhere → platform check just reports OS; junctions/symlinks irrelevant
 *  - Skills ship as a Claude Code plugin (`/plugin install mage@mage`) — informational
 */
export async function doctor(opts: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // 1. Node version
  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "node version",
    ok: nodeMajor >= REQUIRED_NODE_MAJOR,
    detail: `v${process.versions.node} (need >= ${REQUIRED_NODE_MAJOR})`,
  });

  // 2. Platform
  checks.push({
    name: "platform",
    ok: true,
    detail: platform(),
  });

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
    detail: gh ? "available" : "missing (optional; required for `init --external --visibility private|public`)",
    optional: true,
  });

  // 4. Skills install method (Claude Code plugin — informational)
  checks.push(checkSkillsInstall());

  // 5. Hub check (if cwd or --hub looks like one)
  const hubCandidate = opts.hub ? absolutePath(opts.hub) : process.cwd();
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
    checks.push({
      name: "github reachable",
      ok: false,
      detail: `unreachable (${(err as Error).message}) — local-only init still works`,
      optional: true,
    });
  }

  // Render
  logger.info("=== Environment ===");
  for (const c of checks) {
    if (c.ok) logger.success(`${pad(c.name)}: ${c.detail}`);
    else if (c.optional) logger.warn(`${pad(c.name)}: ${c.detail}`);
    else logger.error(`${pad(c.name)}: ${c.detail}`);
  }

  const passed = checks.every((c) => c.ok || c.optional);
  logger.blank();
  if (passed) logger.success("All required checks passed.");
  else logger.error("Some required checks failed.");

  const me = await which("mage");
  if (me) logger.detail("(mage itself is on PATH)");

  return { passed, checks };
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
