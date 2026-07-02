// The 0.0.9 "setup-integrity" health checks for `mage doctor`: KB structure,
// capture-sink gitignore coverage (THE leak guard), and connection/hook-drift.
// Governed by ADR-0021 and the connect-doesnt-ensure-ignores gotcha. Each helper
// pushes one or more DoctorChecks onto the shared array.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type ClaudeSettings,
  diffMageHooks,
  hasCommandeerHooks,
  readClaudeSettings,
  removeMageHooks,
  resolveSettingsTarget,
  upsertMageHooks,
  writeClaudeSettings,
} from "../adapters/claude-code/settings.js";
import { LAYOUT_LEAVES, mageMigrate } from "../commands/migrate.js";
import type { DoctorCheck, DoctorOptions } from "../commands/doctor.js";
import { detectRedactHook } from "../git-hooks.js";
import { ensureGitignored } from "../gitignore.js";
import {
  AGENTS_FILE,
  INDEX_FILE,
  META_DIR,
  META_FILE,
  METADATA_SCHEMA,
  STATE_DIR,
  exists,
  learningsPath,
  looksLikeHub,
  ownedDocsRoots,
  readHubMetadata,
  readMetadata,
  type resolveDocsRoot,
} from "../paths.js";
import { run } from "../shell.js";
import { scanNotes } from "../scan.js";
import { index } from "../commands/index-cmd.js";

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
    await pushNoKbCheck(checks, opts);
    return;
  }

  pushKbStructureChecks(checks, kb, await exists(join(kb.root, INDEX_FILE)));
  // Recall readiness (ADR-0033): the index must reflect what's on disk, and the AGENTS.md
  // awareness block must not steer the agent at retired commands. Both surfaced by the
  // 2026-07-02 soak (9-line index for 62 notes; `/mage-learn` in a stale block).
  await pushIndexFreshnessCheck(checks, kb, opts);
  await pushAgentsBlockCheck(checks, opts);
  // Resolve connection state ONCE: the sink-leak severity depends on whether
  // capture is actually wired (connected), and the connection check reports it.
  const conn = await resolveConnection(opts);
  await pushSinkIgnoreCheck(checks, kb, opts, conn.diff.connected);
  // Tell "never connected" (benign, fresh KB) apart from "was capturing, now
  // disconnected" (a regression) using the sink's capture history.
  const hadCapture = await learningsHasHistory(kb.root);
  await pushConnectionCheck(checks, conn, hadCapture, opts);
  // Gate-2 redaction pre-commit hook (detect+nudge; never installed by --fix) and
  // metadata schema drift (advisory; --fix migrates in place). Both fail-open.
  await pushRedactHookCheck(checks, kb, conn.diff.connected);
  await pushSchemaDriftCheck(checks, kb, opts);
  // Pre-fold state layout drift (ADR-0025): an OLD `.learnings`/`.metrics`/`.staging`
  // dir at a docs root; --fix relocates it under `.mage/`.
  await pushLayoutDriftCheck(checks, kb, opts);
  // Hub-aware: a per-project liveness rollup when run AT a hub (Decision 11B).
  if (kb.kind === "hub") await pushHubProjectsCheck(checks, kb.repo);
}

/**
 * The no-KB case, with bare-parent detection (Decision 1). `resolveDocsRoot` walks
 * UP only, so when it finds nothing we ALSO peek one level DOWN: if the cwd sits
 * directly above one or more mage KBs/hubs but is itself neither, it is a "bare
 * parent" — capture binds to the session's cwd and never down-scans, so a session
 * started here captures into nothing. Warn loudly (no down-scan magic — we never
 * treat the children as the KB). Otherwise, the benign "no KB here" note.
 */
async function pushNoKbCheck(checks: DoctorCheck[], opts: DoctorOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const children = await childKbCount(cwd);
  if (children > 0) {
    checks.push({
      name: "mage KB",
      ok: false,
      // Advisory severity, LOUD message: a parent-dir invocation may be intentional,
      // but the capture-binds-to-nothing gotcha must be impossible to miss.
      optional: true,
      detail:
        `BARE PARENT — this dir sits directly above ${children} mage KB(s)/hub(s) but is itself ` +
        "neither. mage binds capture to the session's cwd and only walks UP, so a session started " +
        "HERE captures into nothing. `cd` into a project, or run `mage init --hub` to make this a hub.",
    });
    return;
  }
  checks.push({
    name: "mage KB",
    ok: true,
    detail: "No mage KB here — run `mage init` to create one (env checks above still apply)",
    optional: true,
  });
}

/**
 * Count the immediate children of `dir` that are a mage KB (`<child>/mage/metadata.json`)
 * or a hub (`looksLikeHub`). Bounded to one level (immediate children) — this is a
 * "is cwd a bare parent" probe, NOT a recursive discovery scan. Fail-open to 0 so
 * doctor never throws on an unreadable dir.
 */
async function childKbCount(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of entries) {
    if (name.startsWith(".") || name === META_DIR) continue; // skip hidden + this dir's own mage/
    const child = join(dir, name);
    if ((await exists(join(child, META_DIR, META_FILE))) || (await looksLikeHub(child))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Per-project liveness rollup for a hub (Decision 11B). For each registered project:
 * is its code repo present on THIS machine, and is capture wired there
 * (`<code_repo>/.claude/settings.local.json` carrying mage hooks)? Advisory — a code
 * repo may simply not be cloned here, and an unconnected project is a nudge, not a
 * hub failure. Reads each project's settings once; never throws.
 */
async function pushHubProjectsCheck(checks: DoctorCheck[], hub: string): Promise<void> {
  const meta = await readHubMetadata(hub).catch(() => null);
  const projects = meta?.projects ?? [];
  if (projects.length === 0) {
    checks.push({
      name: "hub projects",
      ok: true,
      optional: true,
      detail: "no projects registered yet — `mage link <hub>` from each code repo",
    });
    return;
  }

  let present = 0;
  let connected = 0;
  const issues: string[] = [];
  for (const p of projects) {
    if (!p.code_repo_path || !(await exists(p.code_repo_path))) {
      issues.push(`${p.name} (code repo absent here)`);
      continue;
    }
    present += 1;
    const read = await readClaudeSettings(resolveSettingsTarget({ cwd: p.code_repo_path }).path);
    if (diffMageHooks(read.settings).connected) {
      connected += 1;
    } else {
      issues.push(`${p.name} (not connected)`);
    }
  }

  const summary = `${projects.length} registered · ${present} present · ${connected} connected`;
  const ok = issues.length === 0;
  checks.push({
    name: "hub projects",
    ok,
    optional: true,
    detail: ok
      ? summary
      : `${summary} — ${issues.join("; ")} (run \`mage connect --all-projects\` from the hub)`,
  });
}

/**
 * True iff the KB's capture sink holds any session history (a `*.jsonl`) — evidence
 * capture WAS wired at some point. Lets the connection check report a
 * was-connected-now-disconnected KB instead of treating it like a fresh one.
 */
async function learningsHasHistory(root: string): Promise<boolean> {
  try {
    const entries = await readdir(learningsPath(root));
    return entries.some((e) => e.endsWith(".jsonl"));
  } catch {
    return false; // no .mage/learnings/ dir → never captured.
  }
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
 * Recall readiness: the generated index must reflect the notes on disk. Compares the
 * canonical on-disk count (scanNotes) to the count INDEX.md advertises in its header
 * (`> N notes …`) — a mismatch means the agent reads a stale map of the KB (the soak's
 * 9-line index for 62 notes). Advisory (a just-added, not-yet-indexed note is a common,
 * benign miss) but loud. `--fix` regenerates. Skipped when INDEX.md is absent — the
 * structure check already nags that. Fail-open: any read error → no check pushed.
 */
async function pushIndexFreshnessCheck(
  checks: DoctorCheck[],
  kb: Kb,
  opts: DoctorOptions,
): Promise<void> {
  // The index the agent actually reads: a repo's own maintained index at kb.root, but for
  // an EXTERNAL code repo (kind "hub" whose root is a project subdir UNDER the hub) it's the
  // HUB's root index — the vestigial projects/<name>/INDEX.md is never consulted (ADR-0011 §6).
  const indexRoot = kb.kind === "hub" && kb.root !== kb.repo ? kb.repo : kb.root;
  const indexPath = join(indexRoot, INDEX_FILE);
  if (!(await exists(indexPath))) return; // absence handled by pushKbStructureChecks
  let onDisk: number;
  let advertised: number | null;
  try {
    onDisk = (await scanNotes(indexRoot)).length;
    advertised = parseIndexCount(await readFile(indexPath, "utf8"));
  } catch {
    return; // fail-open — doctor never throws
  }
  if (advertised === null) return; // unrecognized header shape → don't false-alarm

  if (advertised !== onDisk && opts.fix) {
    await index({ dir: indexRoot, quiet: true }).catch(() => {});
    advertised = parseIndexCount(await readFile(indexPath, "utf8").catch(() => "")) ?? advertised;
  }

  if (advertised === onDisk) {
    checks.push({ name: "index freshness", ok: true, detail: `index reflects ${onDisk} note(s)` });
    return;
  }
  checks.push({
    name: "index freshness",
    ok: false,
    optional: true, // a freshness nag, not a leak — warn loudly, don't hard-fail
    detail: `STALE — index reflects ${advertised}, ${onDisk} note(s) on disk → run \`mage index\``,
  });
}

/** The `> N notes across M wing(s).` header count in an INDEX.md body, or null. */
function parseIndexCount(body: string): number | null {
  const m = body.match(/^>\s*(\d+)\s+notes?\b/m);
  return m ? Number(m[1]) : null;
}

/** Old slash-style skill names, retired for the `mage:` plugin namespace (ADR-0013). */
const RETIRED_SKILL_TOKENS = [
  "/mage-learn",
  "/mage-distill",
  "/mage-groom",
  "/mage-graduate",
  "/mage-optimize",
  "/mage-guide",
];

/**
 * Recall readiness: the mage-owned AGENTS.md block must not steer the agent at retired
 * command names. The 2026-07-02 soak found prismalens's block still saying `/mage-learn`
 * (now `mage:learn`), so the agent invoked a command that no longer exists. Advisory —
 * re-run `mage link`/`mage init` to refresh. (A full template-drift compare rides the
 * version-stamp enabler; see plan-readiness-doctor.) Fail-open on a missing/unreadable file.
 */
async function pushAgentsBlockCheck(checks: DoctorCheck[], opts: DoctorOptions): Promise<void> {
  // The AGENTS.md the SESSION reads sits at its cwd (the code repo for an external KB, the
  // repo/hub root otherwise) — NOT at kb.repo, which for an external repo is the hub.
  const cwd = opts.cwd ?? process.cwd();
  let block: string;
  try {
    block = mageBlockOf(await readFile(join(cwd, AGENTS_FILE), "utf8"));
  } catch {
    return; // no AGENTS.md / unreadable → nothing to verify
  }
  if (!block) return; // no mage block → not our concern here

  const retired = RETIRED_SKILL_TOKENS.filter((t) => block.includes(t));
  checks.push(
    retired.length === 0
      ? { name: "AGENTS.md awareness", ok: true, detail: "no retired command names" }
      : {
          name: "AGENTS.md awareness",
          ok: false,
          optional: true,
          detail: `STALE — block uses retired command name(s) ${retired.join(", ")} → re-run \`mage link\`/\`mage init\` to refresh`,
        },
  );
}

/** The text between the mage AGENTS.md markers, or "" when absent. */
function mageBlockOf(agents: string): string {
  const b = agents.indexOf("<!-- BEGIN mage -->");
  const e = agents.indexOf("<!-- END mage -->");
  return b >= 0 && e > b ? agents.slice(b, e) : "";
}

/**
 * THE leak guard. Verify the capture sink (`.mage/`) is git-ignored by querying a
 * FILE PATH under the dir (a bare-dir `check-ignore` won't match a `dir/` pattern
 * when the dir doesn't exist — the gotcha). On a miss the check fails and nudges
 * `--fix`. With `opts.fix` we call ensureGitignored (the same patterns connect/init
 * write) and re-evaluate so a fixed run passes.
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
  const prefix = kb.kind === "repo" ? "mage/" : "";
  const probes = [`${prefix}${STATE_DIR}/probe`];

  // Guard the write on the root existing: an external repo can resolve to a hub
  // project dir not yet materialized on disk — writing a .gitignore there would
  // throw ENOENT, and doctor must never throw. Nothing to ignore yet anyway.
  const added = opts.fix && (await exists(root)) ? await ensureGitignored(root, patterns) : [];
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
 * sink (`.mage/`) — a missing cockpit ignore is not a failure (it's only written
 * on `--html`) — but `--fix` adds it here for completeness.
 */
export function sinkIgnoreSpec(kb: Kb): { root: string; patterns: string[] } {
  if (kb.kind === "repo") {
    return {
      root: kb.repo,
      patterns: [`mage/${STATE_DIR}/`, "mage/dashboard.html"],
    };
  }
  return {
    root: kb.root,
    patterns: [`${STATE_DIR}/`, `**/${STATE_DIR}/`, "dashboard.html"],
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
  /**
   * Absolute path of the settings file the connection state was read from — the
   * CONNECTED scope when connected, else the local path. This is the `--fix`
   * target for the hook-block-drift refresh.
   */
  settingsPath: string;
  /** Parsed settings at {@link settingsPath} (null when absent/malformed). */
  settings: ClaudeSettings | null;
}

/**
 * Read connection state once: local settings first, then user settings as a
 * fallback, returning the connected diff (with its scope, path, and parsed
 * settings). Shared by the sink-leak severity decision, the connection-health
 * check, and the `--fix` hook-block refresh so settings are read once.
 */
async function resolveConnection(opts: DoctorOptions): Promise<Connection> {
  const cwd = opts.cwd ?? process.cwd();
  const localPath = resolveSettingsTarget({ cwd }).path;
  const localRead = await readClaudeSettings(localPath);
  // Drive the commandeer flag off the INSTALLED hooks so a commandeer-wired settings
  // file is drift-checked for its mage:memory:* rows (else a stale commandeer command
  // across a version bump is silently never detected/fixed), while a base-only file is
  // not falsely flagged as "missing commandeer rows".
  let diff = diffMageHooks(localRead.settings, { commandeer: hasCommandeerHooks(localRead.settings) });
  let scope = "local";
  let settingsPath = localPath;
  let settings = localRead.settings;

  if (!diff.connected) {
    const userPath = resolveSettingsTarget({ user: true }).path;
    const userRead = await readClaudeSettings(userPath);
    const userDiff = diffMageHooks(userRead.settings, { commandeer: hasCommandeerHooks(userRead.settings) });
    if (userDiff.connected) {
      diff = userDiff;
      scope = "user";
      settingsPath = userPath;
      settings = userRead.settings;
    }
  }

  return { diff, scope, settingsPath, settings };
}

/**
 * Connection health / hook-drift, from the already-resolved Connection:
 *  - not connected anywhere → advisory (optional) nudge `mage connect`; a fresh,
 *    healthy post-`mage init` KB must NOT make `doctor` exit 1 just for this.
 *    `--fix` deliberately does NOT wire from scratch here (Decision 7: repair
 *    drift, never connect-from-scratch — that is `mage connect`'s job).
 *  - connected but drifted (missing/stale/extra mage:* ids) → with `--fix`, refresh
 *    the block IN PLACE (the version-bump self-heal); without it, a REQUIRED
 *    failure nudging re-connect.
 *  - matches → ok with the connected scope.
 */
async function pushConnectionCheck(
  checks: DoctorCheck[],
  conn: Connection,
  hadCapture: boolean,
  opts: DoctorOptions,
): Promise<void> {
  const { diff, scope } = conn;

  if (!diff.connected) {
    // --fix never wires a never-connected (or intentionally `disconnect`'d) repo
    // from scratch — that crosses from "repair" into "connect". Stay a nudge even
    // under --fix.
    checks.push(
      hadCapture
        ? {
            name: "connection",
            ok: false,
            // Capture history but no hooks now → this KB WAS connected and lost it
            // (a settings reset, a mage upgrade, or an intentional `mage disconnect`).
            detail:
              "DISCONNECTED — capture history exists but no mage hooks are wired now; " +
              "run `mage connect` to resume (unless `mage disconnect` was intentional)",
            optional: true,
          }
        : {
            name: "connection",
            ok: false,
            detail: "not connected; run `mage connect`",
            optional: true,
          },
    );
    return;
  }

  if (!diff.matches) {
    // Connected but the hook block drifted. With --fix, rewrite it to the current
    // MAGE_HOOKS set in place and re-evaluate. Best-effort: a write failure (or a
    // refresh that somehow still mismatches) degrades to the normal nudge — doctor
    // must never throw and must never silently claim a fix it did not make.
    if (opts.fix) {
      const after = await refreshHookBlock(conn);
      if (after?.matches) {
        checks.push({
          name: "connection",
          ok: true,
          detail: `${scope}: refreshed drifted mage hook block`,
        });
        return;
      }
    }

    const missing = diff.missingIds.length > 0 ? diff.missingIds.join(",") : "none";
    const stale = diff.staleIds.length > 0 ? diff.staleIds.join(",") : "none";
    checks.push({
      name: "connection",
      ok: false,
      detail:
        `hook block out of date (mage:* drift: missing=[${missing}] stale=[${stale}]); ` +
        `re-run \`mage connect\`${opts.fix ? " (auto-fix could not be applied)" : ""}`,
    });
    return;
  }

  checks.push({ name: "connection", ok: true, detail: `${scope}: mage hooks current` });
}

/**
 * Rewrite the drifted mage hook block in the connected settings file to the
 * current MAGE_HOOKS set, returning the post-write diff (or null on any failure —
 * doctor never throws). We STRIP every mage:* group first (`removeMageHooks`) then
 * re-add (`upsertMageHooks`): upsert alone is replace-by-id and would leave behind
 * an EXTRA renamed/removed id, so a strip+add is what guarantees `matches` after.
 * Non-mage groups and other top-level keys are preserved by both helpers.
 */
async function refreshHookBlock(conn: Connection): Promise<MageDiff | null> {
  try {
    // Preserve the commandeer tier across the strip+re-add if it was wired (detected by
    // the mage:memory:* id family). --fix repairs drift; it must never silently strip
    // Gate-0. A base-only block stays base.
    const commandeer = hasCommandeerHooks(conn.settings);
    const cleared = removeMageHooks(conn.settings).settings;
    const refreshed = upsertMageHooks(cleared, { commandeer });
    await writeClaudeSettings(conn.settingsPath, refreshed);
    return diffMageHooks(refreshed, { commandeer });
  } catch {
    return null;
  }
}

/**
 * Detect-and-nudge the Gate-2 redaction pre-commit hook (ADR-0018 §7), which blocks
 * a commit that stages a live secret. `mage connect` installs it; `doctor` only
 * DETECTS — it never installs (Decision 7: --fix repairs drift, it does not wire
 * from scratch). Scope:
 *   - kind "hub" is skipped — this covers BOTH true hubs (not a code repo mage
 *     connects, Decision 5) AND external-mode projects (resolveDocsRoot reports them
 *     as kind "hub"; their notes commit to the hub, not the code repo, so the code
 *     repo has no note-commit to gate). External-mode Gate-2 placement is a
 *     deliberate deferral, not an oversight.
 *   - non-git KBs are skipped: there is no pre-commit hook to speak of.
 * Severity is advisory throughout: Gate 1 (inline `mage redact`) still applies, and
 * a human's own pre-commit hook (foreign) is theirs to keep — we only suggest
 * adding the staged-secret check to it.
 */
async function pushRedactHookCheck(
  checks: DoctorCheck[],
  kb: Kb,
  connected: boolean,
): Promise<void> {
  if (kb.kind !== "repo") return; // hubs + external-mode KBs (see doc above)

  const status = await detectRedactHook(kb.repo);
  if (status === "not-a-repo") return; // no pre-commit hook concept here

  if (status === "present") {
    checks.push({
      name: "redact hook",
      ok: true,
      detail: "Gate-2 redaction pre-commit hook installed",
    });
    return;
  }

  if (status === "foreign") {
    checks.push({
      name: "redact hook",
      ok: true,
      optional: true,
      detail:
        "a non-mage pre-commit hook is present — add `mage redact --check --staged` to it " +
        "for staged-secret blocking",
    });
    return;
  }

  // absent
  checks.push({
    name: "redact hook",
    ok: false,
    // Advisory: Gate 1 still applies and the leak only matters at the tracked write.
    optional: true,
    detail: connected
      ? "Gate-2 redaction pre-commit hook missing — run `mage connect` to install it"
      : "Gate-2 redaction pre-commit hook not installed — `mage connect` adds it when you wire capture",
  });
}

/**
 * Detect metadata schema drift (a pre-`mage.v2` file) and, with `--fix`, migrate it
 * in place. The lenient readers already normalize v1 → v2 in memory, so a drifted
 * file is never *broken* — this only makes the upgrade durable on disk, so the
 * check is advisory (optional). `--fix` routes through {@link mageMigrate}, wrapped
 * so doctor never throws.
 */
async function pushSchemaDriftCheck(
  checks: DoctorCheck[],
  kb: Kb,
  opts: DoctorOptions,
): Promise<void> {
  const onDisk = await readOnDiskSchema(kb);
  if (onDisk === null) return; // unreadable/absent — the structure check covers it

  if (onDisk === METADATA_SCHEMA) {
    checks.push({ name: "metadata schema", ok: true, detail: `current (${METADATA_SCHEMA})` });
    return;
  }

  if (opts.fix) {
    try {
      // `kb.repo` is the migration anchor for BOTH kinds: the code-repo root for a
      // repo KB (holds mage/metadata.json), the hub root for a hub/external KB
      // (holds metadata.json). mageMigrate resolves the KB from there. Report the
      // file COUNT when >1 so a walk-up that also migrates an enclosing repo (a hub
      // nested inside a code repo) is visible, not masked by the single-file detail.
      const res = await mageMigrate({ dir: kb.repo });
      const n = res.migrated.length;
      checks.push({
        name: "metadata schema",
        ok: true,
        detail:
          n === 0
            ? `current (${METADATA_SCHEMA})`
            : n === 1
              ? `migrated ${onDisk} → ${METADATA_SCHEMA}`
              : `migrated ${n} metadata files → ${METADATA_SCHEMA}`,
      });
      return;
    } catch {
      // Fall through to the advisory nudge — doctor never throws.
    }
  }

  checks.push({
    name: "metadata schema",
    ok: false,
    optional: true, // the lenient reader keeps a v1 KB fully working.
    detail: `metadata is ${onDisk} (current ${METADATA_SCHEMA}) — run \`mage migrate\` or \`mage doctor --fix\``,
  });
}

/**
 * The pre-fold transient dot-dirs (ADR-0025); a leftover one is layout drift. Derived
 * from {@link LAYOUT_LEAVES} (migrate.ts) — the single source of the pre-fold names —
 * so the drift probe and the mover can never disagree on which dirs to relocate.
 */
const OLD_LAYOUT_DIRS = LAYOUT_LEAVES.map((l) => l.from);

/**
 * Detect pre-fold state-layout drift (ADR-0025): an OLD `.learnings`/`.metrics`/
 * `.staging` dir, or a leftover `.redactignore` file, at any docs root this KB owns
 * (the resolved root, plus every hub `projects/<name>/` when run at a hub). The state
 * fold moves them under `.mage/` and into `metadata.redact`. With `--fix` we route
 * through {@link mageMigrate} (which relocates dirs fail-safe and folds the file) and
 * re-probe so a fixed run passes. Advisory (optional): the runtime reads from the new
 * paths, so a leftover old dir is `ls -a` clutter, not a functional break. Fail-open:
 * an unreadable root or a migrate error degrades to the nudge — doctor never throws.
 */
async function pushLayoutDriftCheck(
  checks: DoctorCheck[],
  kb: Kb,
  opts: DoctorOptions,
): Promise<void> {
  const roots = await ownedDocsRoots(kb);
  let drift = await anyOldLayout(roots);
  if (!drift) return; // already folded (or never had pre-fold artifacts).

  if (opts.fix) {
    try {
      await mageMigrate({ dir: kb.repo });
      drift = await anyOldLayout(roots); // re-probe: a clean migrate clears the drift.
    } catch {
      // Fall through to the advisory nudge — doctor never throws.
    }
  }

  checks.push(
    drift
      ? {
          name: "state layout",
          ok: false,
          optional: true, // runtime uses the new paths; this is tidiness + future-proofing.
          detail:
            "pre-fold state at the docs root (.learnings/.metrics/.staging or .redactignore) — " +
            "run `mage migrate` or `mage doctor --fix` to move it under `.mage/`",
        }
      : { name: "state layout", ok: true, detail: "state consolidated under `.mage/`" },
  );
}

/** True iff any owned docs root still holds a pre-fold dir or a `.redactignore`. */
async function anyOldLayout(roots: string[]): Promise<boolean> {
  for (const root of roots) {
    for (const dir of OLD_LAYOUT_DIRS) {
      if (await exists(join(root, dir))) return true;
    }
    if (await exists(join(root, ".redactignore"))) return true;
  }
  return false;
}

/**
 * The on-disk metadata schema for this KB, or null when absent/unreadable/foreign.
 * Keyed off `kb.repo` (NOT `kb.root`) for both kinds — that is where the metadata
 * file physically lives:
 *   - repo KB: kb.repo is the code-repo root → mage/metadata.json (readMetadata).
 *   - hub KB:  kb.repo is the HUB root → metadata.json (readHubMetadata). For an
 *     EXTERNAL-mode KB resolveDocsRoot sets root=<hub>/projects/<project> (no
 *     metadata.json there) but repo=<hub>, so reading kb.root would ENOENT→null and
 *     silently skip the check; kb.repo targets the hub's real metadata. For a true
 *     hub repo===root, so this is a no-op.
 * The readers preserve the ON-DISK `schema` field (they normalize the rest), so a
 * v1 file reports "mage.v1". Fail-open: a foreign schema throws in the reader,
 * which we swallow to null (doctor never throws on a malformed metadata file).
 */
async function readOnDiskSchema(kb: Kb): Promise<string | null> {
  try {
    if (kb.kind === "repo") {
      const meta = await readMetadata(kb.repo);
      return meta?.schema ?? null;
    }
    const hub = await readHubMetadata(kb.repo);
    return hub?.schema ?? null;
  } catch {
    return null;
  }
}
