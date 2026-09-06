import {
  findCodeRepoRoot,
  outOfRepoKbTargets,
  readMetadata,
  resolveHubGrant,
} from "./paths.js";
import {
  readClaudeSettings,
  resolveSettingsTarget,
} from "./adapters/claude-code/settings.js";

export type ReachGrantStatus =
  | { kind: "not-applicable" }               // no external hub configured, in-repo KB, or resolve threw
  | { kind: "absent"; roots: string[] }      // external hub configured but directory does not exist on disk
  | { kind: "mismatch"; details: string[] }  // external hub directory exists but points to a different remote
  | { kind: "missing"; roots: string[] }     // hub present, no grant in either settings scope
  | { kind: "granted"; roots: string[] };

/** The same resolution `connect` grants and `doctor` checks (ADR-0043 §5), read across both settings scopes. */
export async function reachGrantStatus(cwd: string): Promise<ReachGrantStatus> {
  let resolutions: Awaited<ReturnType<typeof resolveHubGrant>>[] = [];
  let targets: ReturnType<typeof outOfRepoKbTargets> = [];
  try {
    const codeRepo = await findCodeRepoRoot(cwd);
    const meta = codeRepo ? await readMetadata(codeRepo) : null;
    targets = meta && codeRepo ? outOfRepoKbTargets(meta, codeRepo) : [];
    // Mirror connect's gate EXACTLY — resolveHubGrant, the same function connect
    // uses to decide what to grant AND what path it grants (ADR-0043 §5's
    // one-shared-function rule). Reporting a target connect would never grant as
    // "missing" would nag for a fix connect will never make; checking the WRONG
    // path (e.g. the derived root when connect actually fell back to hub_path)
    // would report a real grant as missing.
    resolutions = await Promise.all(targets.map((t) => resolveHubGrant(t)));
  } catch {
    return { kind: "not-applicable" }; // unreadable/foreign metadata — schema drift check owns that story
  }
  if (resolutions.length === 0) return { kind: "not-applicable" }; // in-repo KB: nothing lives outside the project root

  const granted = new Set<string>();
  for (const t of [resolveSettingsTarget({ cwd }), resolveSettingsTarget({ user: true })]) {
    const r = await readClaudeSettings(t.path).catch(() => null);
    const dirs = r?.settings?.permissions?.additionalDirectories;
    if (Array.isArray(dirs)) for (const d of dirs) if (typeof d === "string") granted.add(d);
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  const absent: string[] = [];
  for (const [i, resolution] of resolutions.entries()) {
    if (resolution.reason === "mismatch") {
      mismatched.push(resolution.detail ?? "hub mismatch");
      continue;
    }
    if (resolution.reason === "absent") {
      absent.push(targets[i]?.root ?? "the derived hub path");
      continue;
    }
    if (!granted.has(resolution.root as string)) missing.push(resolution.root as string);
  }

  if (mismatched.length > 0) {
    return { kind: "mismatch", details: mismatched };
  }
  if (missing.length > 0) {
    return { kind: "missing", roots: missing };
  }
  if (absent.length > 0) {
    return { kind: "absent", roots: absent };
  }
  return { kind: "granted", roots: resolutions.map((r) => r.root as string) };
}
