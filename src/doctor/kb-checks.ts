// The 0.0.9 "setup-integrity" health checks for `mage doctor`: KB structure,
// capture-sink gitignore coverage (THE leak guard), and connection/hook-drift.
// Governed by ADR-0021 and the connect-doesnt-ensure-ignores gotcha. Each helper
// pushes one or more DoctorChecks onto the shared array.

import { join } from "node:path";
import {
  diffMageHooks,
  readClaudeSettings,
  resolveSettingsTarget,
} from "../claude-settings.js";
import type { DoctorCheck, DoctorOptions } from "../commands/doctor.js";
import { ensureGitignored } from "../gitignore.js";
import { INDEX_FILE, LEARNINGS_DIR, METRICS_DIR, exists, type resolveDocsRoot } from "../paths.js";
import { run } from "../shell.js";

type ResolvedKb = Awaited<ReturnType<typeof resolveDocsRoot>>;
type Kb = NonNullable<ResolvedKb>;

/**
 * Append KB structure, gitignore-coverage, and connection-health checks. With no
 * KB, append a single informational (optional) "no KB here" note so a bare-env
 * `doctor` never fails on the absence of a KB.
 */
export async function pushKbChecks(
  checks: DoctorCheck[],
  kb: ResolvedKb,
  opts: DoctorOptions,
): Promise<void> {
  if (!kb) {
    checks.push({
      name: "mage KB",
      ok: true,
      detail: "No mage KB here — run `mage init` to create one (env checks above still apply)",
      optional: true,
    });
    return;
  }

  pushKbStructureChecks(checks, kb, await exists(join(kb.root, INDEX_FILE)));
  // Resolve connection state ONCE: the sink-leak severity depends on whether
  // capture is actually wired (connected), and the connection check reports it.
  const conn = await resolveConnection(opts);
  await pushSinkIgnoreCheck(checks, kb, opts, conn.diff.connected);
  pushConnectionCheck(checks, conn);
}

/** KB structure: confirm the docs root, then flag a missing INDEX.md (advisory). */
function pushKbStructureChecks(checks: DoctorCheck[], kb: Kb, hasIndex: boolean): void {
  checks.push({ name: "KB structure", ok: true, detail: `KB: ${kb.kind} at ${kb.root}` });
  checks.push({
    name: "INDEX.md",
    ok: hasIndex,
    detail: hasIndex ? "present" : "missing — run `mage index`",
    // Missing INDEX is a freshness nag, not a leak: keep it advisory.
    optional: hasIndex ? undefined : true,
  });
}

/**
 * THE leak guard. Verify each capture sink (.learnings/, .metrics/) is git-ignored
 * by querying a FILE PATH under the dir (a bare-dir `check-ignore` won't match a
 * `dir/` pattern when the dir doesn't exist — the gotcha). On a miss the check
 * fails and nudges `--fix`. With `opts.fix` we call ensureGitignored (the same
 * patterns connect/init write) and re-evaluate so a fixed run passes.
 *
 * Severity tracks real risk: an un-ignored sink only leaks once capture is ON, so
 * a miss is a REQUIRED failure when `connected`, but an advisory (optional) warn
 * when not yet connected (the sink isn't being written yet — still nudge `--fix`).
 */
async function pushSinkIgnoreCheck(
  checks: DoctorCheck[],
  kb: Kb,
  opts: DoctorOptions,
  connected: boolean,
): Promise<void> {
  const { root, patterns } = sinkIgnoreSpec(kb);
  const prefix = kb.kind === "in-repo" ? "mage/" : "";
  const probes = [`${prefix}${LEARNINGS_DIR}/probe`, `${prefix}${METRICS_DIR}/probe`];

  const added = opts.fix ? await ensureGitignored(root, patterns) : [];
  const unignored = await unignoredProbes(root, probes);

  if (unignored.length === 0) {
    const note = added.length > 0 ? ` (added: ${added.join(", ")})` : "";
    checks.push({ name: "gitignore (sinks)", ok: true, detail: `capture sinks ignored${note}` });
    return;
  }

  checks.push({
    name: "gitignore (sinks)",
    ok: false,
    detail:
      `capture sink(s) NOT git-ignored: ${unignored.join(", ")} — ` +
      "run `mage doctor --fix` (or `mage connect`) to add the rules",
    // Not yet connected → capture isn't writing, so this is a warn, not a leak.
    optional: connected ? undefined : true,
  });
}

/**
 * The (root, patterns) the layout ignores — mirrors connect.ts/init.ts exactly.
 * Includes the gitignored cockpit (`dashboard.html`, ADR-0020 §6) so `--fix`
 * establishes it safe-by-default. The sink-coverage CHECK probes only the capture
 * sinks (.learnings/.metrics) — a missing cockpit ignore is not a failure (it's
 * only written on `--html`) — but `--fix` adds it here for completeness.
 */
export function sinkIgnoreSpec(kb: Kb): { root: string; patterns: string[] } {
  if (kb.kind === "in-repo") {
    return {
      root: kb.repo,
      patterns: [`mage/${LEARNINGS_DIR}/`, `mage/${METRICS_DIR}/`, "mage/dashboard.html"],
    };
  }
  return {
    root: kb.root,
    patterns: [
      `${LEARNINGS_DIR}/`,
      `**/${LEARNINGS_DIR}/`,
      `${METRICS_DIR}/`,
      `**/${METRICS_DIR}/`,
      "dashboard.html",
    ],
  };
}

/**
 * Of the candidate file probes, return those NOT git-ignored. `git check-ignore`
 * exits 0 (lists ignored args on stdout), 1 (none ignored), or >1 (error — not a
 * repo). On >1 we conservatively treat probes as ignored (no false leak alarm; the
 * env `git` check already covers a missing/broken git).
 */
async function unignoredProbes(repoRoot: string, probes: string[]): Promise<string[]> {
  const r = await run("git", ["-C", repoRoot, "check-ignore", ...probes]);
  if (r.code > 1) return [];
  const ignored = new Set(
    r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  return probes.filter((p) => !ignored.has(p));
}

type MageDiff = ReturnType<typeof diffMageHooks>;
interface Connection {
  diff: MageDiff;
  scope: string;
}

/**
 * Read connection state once: local settings first, then user settings as a
 * fallback, returning the connected diff (with its scope). Shared by the sink-leak
 * severity decision and the connection-health check so settings are read once.
 */
async function resolveConnection(opts: DoctorOptions): Promise<Connection> {
  const cwd = opts.cwd ?? process.cwd();
  const localRead = await readClaudeSettings(resolveSettingsTarget({ cwd }).path);
  let diff = diffMageHooks(localRead.settings);
  let scope = "local";

  if (!diff.connected) {
    const userRead = await readClaudeSettings(resolveSettingsTarget({ user: true }).path);
    const userDiff = diffMageHooks(userRead.settings);
    if (userDiff.connected) {
      diff = userDiff;
      scope = "user";
    }
  }

  return { diff, scope };
}

/**
 * Connection health / hook-drift, from the already-resolved Connection:
 *  - not connected anywhere → advisory (optional) nudge `mage connect`; a fresh,
 *    healthy post-`mage init` KB must NOT make `doctor` exit 1 just for this.
 *  - connected but drifted (missing/stale/extra mage:* ids) → REQUIRED failure,
 *    nudge re-connect (the version-bump nudge from the gotcha's stale-hook-block).
 *  - matches → ok with the connected scope.
 */
function pushConnectionCheck(checks: DoctorCheck[], conn: Connection): void {
  const { diff, scope } = conn;

  if (!diff.connected) {
    checks.push({
      name: "connection",
      ok: false,
      detail: "not connected; run `mage connect`",
      optional: true,
    });
    return;
  }

  if (!diff.matches) {
    const missing = diff.missingIds.length > 0 ? diff.missingIds.join(",") : "none";
    const stale = diff.staleIds.length > 0 ? diff.staleIds.join(",") : "none";
    checks.push({
      name: "connection",
      ok: false,
      detail:
        `hook block out of date (mage:* drift: missing=[${missing}] stale=[${stale}]); ` +
        "re-run `mage connect`",
    });
    return;
  }

  checks.push({ name: "connection", ok: true, detail: `${scope}: mage hooks current` });
}
