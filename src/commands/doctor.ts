import { platform } from "node:os";
import { hasGh, hasGit } from "../git.js";
import { logger } from "../logger.js";
import { absolutePath, exists, looksLikeHub } from "../paths.js";
import { run, which } from "../shell.js";

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
 *  - Skill install delegated to vercel-labs/skills → check `npx skills` is reachable
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

  // 4. npx skills reachable (the skill installer we delegate to)
  const skills = await checkNpxSkills();
  checks.push(skills);

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

async function checkNpxSkills(): Promise<DoctorCheck> {
  // `npx skills --help` resolves the package + prints help. If it succeeds (or
  // exits 0/2 — some CLIs return non-zero on --help), the installer is reachable.
  // We don't actually want to install anything; we just want to confirm npm can
  // fetch the package.
  const r = await run("npx", ["-y", "skills", "--help"], { });
  if (r.code === 0 || r.stdout.length > 0) {
    return { name: "npx skills", ok: true, detail: "reachable (vercel-labs/skills)" };
  }
  return {
    name: "npx skills",
    ok: false,
    detail: `not reachable (exit ${r.code}). Required for \`npx skills add github:Sumit1993/mage-memory\`. Network may be blocked or npm misconfigured.`,
    optional: true, // mark optional so doctor doesn't fail outright — install surfaces the issue when actually invoked
  };
}

function pad(s: string): string {
  return s.padEnd(20);
}
