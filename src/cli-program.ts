import { Command, Option } from "commander";
import { autonomy } from "./commands/autonomy.js";
import { connect, connectAllProjects } from "./commands/connect.js";
import { dashboard } from "./commands/dashboard-cmd.js";
import { OPEN_WITH_TARGETS } from "./dashboard/html.js";
import { disconnect } from "./commands/disconnect.js";
import { distillCmd } from "./commands/distill-cmd.js";
import { doctor } from "./commands/doctor.js";
import { dream } from "./commands/dream-cmd.js";
import { groomCmd } from "./commands/groom-cmd.js";
import { index } from "./commands/index-cmd.js";
import { ingestCmd } from "./commands/ingest.js";
import { type InitMode, type InitVisibility, init } from "./commands/init.js";
import { link, type Storage } from "./commands/link.js";
import { list } from "./commands/list.js";
import { mageMigrate, reportMigrate } from "./commands/migrate.js";
import { buildNudgeCommand } from "./adapters/claude-code/nudge.js";
import { buildObserveCommand } from "./commands/observe.js";
import { promoteCmd } from "./commands/promote-cmd.js";
import { redactCmd } from "./commands/redact.js";
import { skills } from "./commands/skills-cmd.js";
import { stageCmd } from "./commands/stage-cmd.js";
import { status } from "./commands/status.js";
import { unlink } from "./commands/unlink.js";
import { verify } from "./commands/verify.js";
import { mageVersion } from "./version.js";

/**
 * Construct the fully-configured mage commander program.
 *
 * This is side-effect-free on import: it does not parse argv, install an
 * exit override, or touch `process` — callers (the CLI entry, a docs
 * generator) decide what to do with the returned `Command`. The CLI entry
 * (src/cli.ts) is the only place that parses; keeping the parse there, and
 * unconditional, is deliberate — the published `mage` bin is a symlink, so a
 * `import.meta.url`/`require.main` main-module guard would silently no-op it.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("mage")
    .description(
      "A portable, self-maintaining knowledge base for software systems — notes navigable as an Obsidian graph, usable by any AI coding agent",
    )
    .version(mageVersion());

  // ─── init ──────────────────────────────────────────────────────────────────
  program
    .command("init")
    .description(
      "Initialize mage: an in-repo knowledge base, or a standalone hub",
    )
    .argument(
      "[name]",
      "hub name or path — creates a hub there (bare name → ./<name>, like `git init`)",
    )
    .option(
      "--in-repo",
      "scaffold the knowledge base inside this code repo's mage/",
    )
    .option(
      "--hub",
      "create a standalone hub (vs an in-repo KB) at the current dir or <name>",
    )
    .addOption(
      new Option("--external", "removed in 0.0.10 — use --hub").hideHelp(),
    )
    .option(
      "--name <name>",
      "deprecated: pass the hub name as the positional argument instead",
    )
    .option(
      "-d, --dir <path>",
      "hub mode: explicit hub directory (overrides <name>)",
    )
    .option("--private", "hub mode: create as private GitHub repo (requires gh)")
    .option("--public", "hub mode: create as public GitHub repo (requires gh)")
    .option("--local", "hub mode: skip GitHub — local-only hub")
    .option(
      "--owner <user>",
      "hub mode: GitHub owner (auto-detected via `gh api user`)",
    )
    .option(
      "--project <name>",
      "in-repo mode: project name (default: basename of code repo)",
    )
    .option(
      "-y, --yes",
      "non-interactive: use defaults (detect in-repo vs hub from the cwd)",
    )
    .option(
      "--no-connect",
      "skip auto-wiring capture hooks after an in-repo init",
    )
    .action(async (name: string | undefined, opts) => {
      const mode = modeFromOpts(opts);
      if (name && opts.inRepo) {
        throw new Error(
          "A hub name/path implies a hub — drop --in-repo or the name argument.",
        );
      }
      const visibility = visibilityFromOpts(opts);
      await init({
        mode,
        name: name ?? opts.name,
        dir: opts.dir,
        visibility,
        owner: opts.owner,
        project: opts.project,
        yes: opts.yes,
        connect: opts.connect,
      });
    });

  // ─── index ───────────────────────────────────────────────────────────────────
  program
    .command("index", { hidden: true })
    .description(
      "(Re)generate INDEX.md — the always-loaded index of notes (deterministic, idempotent)",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .action(async (opts) => {
      await index({ dir: opts.dir });
    });

  // ─── skills ──────────────────────────────────────────────────────────────────
  program
    .command("skills")
    .description(
      "(Re)generate one auto-loaded skill per wing into .claude/skills/ and .agents/skills/",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .option(
      "--metrics",
      "read-only: fold the context-match rollup and report skill-load match rates (never regenerates skills)",
    )
    .option("--json", "metrics mode: emit the rows as JSON instead of a table")
    .option(
      "--quiet",
      "metrics mode: fold + write the rollup silently (the Stop-hook path)",
    )
    .action(async (opts) => {
      await skills({
        dir: opts.dir,
        metrics: opts.metrics,
        json: opts.json,
        quiet: opts.quiet,
      });
    });

  // ─── dream ───────────────────────────────────────────────────────────────────
  program
    .command("dream")
    .description(
      "Report knowledge-base health, read-only: stale, superseded-but-active, dangling links, orphans",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .option(
      "--stale-days <n>",
      "flag notes whose last_reviewed is older than N days (default 180)",
      (v) => Number.parseInt(v, 10),
    )
    .option("--strict", "exit non-zero if any findings (for hooks/CI)")
    .option(
      "--apply",
      "apply ONE confirmed Proposal JSON from stdin (the single writer; never commits)",
    )
    .option(
      "--reject",
      "append ONE Proposal JSON from stdin to the rejected-edit buffer (back off)",
    )
    .action(async (opts) => {
      const result = await dream({
        dir: opts.dir,
        staleDays: opts.staleDays,
        apply: opts.apply,
        reject: opts.reject,
      });
      if (opts.strict && result.findingCount > 0) process.exit(1);
    });

  // ─── ingest ──────────────────────────────────────────────────────────────────
  program
    .command("ingest", { hidden: true })
    .description(
      "Enumerate + classify ingestable sources under <dir> (read-only) — what `mage:learn --from` distills.",
    )
    .argument("<dir>", "directory to scan for ingestable sources")
    .option("--json", "emit the manifest as JSON to stdout (machine-readable)")
    .action(async (dir: string, opts: { json?: boolean }) => {
      await ingestCmd(dir, { json: opts.json });
    });

  // ─── distill ─────────────────────────────────────────────────────────────────
  program
    .command("distill", { hidden: true })
    .description(
      "Read observed .mage/learnings into note candidates (plumbing behind mage:groom Phase 1)",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .option("--json", "emit the candidate manifest as JSON")
    .option(
      "--seen <session:offset>",
      "advance the distill watermark after a batch is dispositioned",
    )
    .action(async (opts: { dir?: string; json?: boolean; seen?: string }) => {
      await distillCmd({ dir: opts.dir, json: opts.json, seen: opts.seen });
    });

  // ─── promote ─────────────────────────────────────────────────────────────────
  program
    .command("promote", { hidden: true })
    .description(
      "Fold observed .mage/learnings into recurring note candidates (plumbing behind mage:groom Phase 2)",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .option("--json", "emit the note-candidate manifest as JSON")
    .option(
      "--seen <session:offset>",
      "advance the promote offset after a batch is dispositioned",
    )
    .action(async (opts: { dir?: string; json?: boolean; seen?: string }) => {
      await promoteCmd({ dir: opts.dir, json: opts.json, seen: opts.seen });
    });

  // ─── stage ─────────────────────────────────────────────────────────────────────
  program
    .command("stage", { hidden: true })
    .description(
      "Stage a short lesson draft into .mage/staging/ (frictionless inline capture — the organic grooming loop)",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .option(
      "-t, --title <title>",
      "lesson title (required — drives the H1 and slug)",
    )
    .option("--type <type>", "note type (default: gotcha)")
    .option("--tags <wing/room,...>", "comma-separated wing/room tags")
    .option(
      "--wing <wing>",
      "convenience wing (prepended as a tag when none homes there)",
    )
    .option("--body <text>", "lesson body (else read from stdin)")
    .option("--json", "emit the result as JSON")
    .action(
      async (opts: {
        dir?: string;
        title?: string;
        type?: string;
        tags?: string;
        wing?: string;
        body?: string;
        json?: boolean;
      }) => {
        await stageCmd(opts);
      },
    );

  // ─── groom ───────────────────────────────────────────────────────────────────────
  program
    .command("groom", { hidden: true })
    .description(
      "Surface / accept / reject the staged lesson batch (plumbing behind the mage:groom skill)",
    )
    .option(
      "-d, --dir <path>",
      "where to look for the knowledge base (default: cwd; walks up for in-repo)",
    )
    .option("--json", "emit the batch / disposition as JSON")
    .option(
      "--accept <slugs|all>",
      "promote these staged drafts to notes/ and re-index",
    )
    .option(
      "--reject <slugs|all>",
      "discard these staged drafts and record their keys",
    )
    .action(
      async (opts: {
        dir?: string;
        json?: boolean;
        accept?: string;
        reject?: string;
      }) => {
        await groomCmd(opts);
      },
    );

  // ─── observe ─────────────────────────────────────────────────────────────────
  // Registration lives next to the handler (commands/observe.ts) so the flag list
  // and the ObserveOptions contract can't drift apart.
  program.addCommand(buildObserveCommand(), { hidden: true });
  // The boundary-nudge adapter (adapters/claude-code/nudge.ts) — fired from the SessionStart hook.
  program.addCommand(buildNudgeCommand(), { hidden: true });

  // ─── redact ──────────────────────────────────────────────────────────────────
  program
    .command("redact", { hidden: true })
    .description(
      "Deterministically scan a file or stdin for secrets/PII (ADR-0014 Gate 2); --strip emits redacted text",
    )
    .argument("[file]", "file to scan (default: stdin; '-' is also stdin)")
    .option(
      "--strip",
      "print the redacted text to stdout (secret values → [REDACTED:<kind>])",
    )
    .option("--quiet", "suppress the findings report")
    .option("--staged", "scan staged git changes (the pre-commit gate)")
    .option("--check", "report-only intent for hooks")
    .action(
      async (
        file: string | undefined,
        opts: {
          strip?: boolean;
          quiet?: boolean;
          staged?: boolean;
          check?: boolean;
        },
      ) => {
        const result = await redactCmd(file, {
          strip: opts.strip,
          quiet: opts.quiet,
          staged: opts.staged,
          check: opts.check,
        });
        if (result.blocked) process.exit(2);
      },
    );

  // ─── link ──────────────────────────────────────────────────────────────────
  program
    .command("link")
    .description(
      "Link this code repo to an existing hub (auto-detects storage based on mage/ content)",
    )
    .argument("<hub-path>", "path to the hub root")
    .option(
      "--project <name>",
      "project name in the hub (default: basename of code repo)",
    )
    .option(
      "--storage <kind>",
      "override auto-detected storage: 'repo-owned' (hybrid; the repo keeps its docs) or 'hub-owned' (the hub owns the docs)",
    )
    .option("-y, --yes", "non-interactive: auto-confirm prompts")
    .option("--no-connect", "skip auto-wiring capture hooks after link")
    .action(
      async (
        hubPath: string,
        opts: {
          project?: string;
          storage?: string;
          yes?: boolean;
          connect?: boolean;
        },
      ) => {
        await link(hubPath, {
          project: opts.project,
          storage: coerceStorage(opts.storage),
          yes: opts.yes,
          connect: opts.connect,
        });
      },
    );

  // ─── unlink ────────────────────────────────────────────────────────────────
  program
    .command("unlink")
    .description(
      "Remove a mage linkage from this code repo (updates both metadata files)",
    )
    .option(
      "--hub <path>",
      "specific hub to unlink from (default: primary hub or the only hub_ref)",
    )
    .option(
      "--delete-hub-side",
      "for hub-owned slots: also delete <hub>/projects/<project>/ dir",
    )
    .option("-y, --yes", "non-interactive: auto-confirm prompts")
    .action(async (opts) => {
      await unlink({
        hub: opts.hub,
        deleteHubSide: opts.deleteHubSide,
        yes: opts.yes,
      });
    });

  // ─── verify ────────────────────────────────────────────────────────────────
  program
    .command("verify")
    .description(
      "Sanity-check a hub's structure (and optionally linked code repos)",
    )
    .argument("[code-repos...]", "code repos to verify alongside the hub")
    .option("--hub <path>", "hub root (default: cwd)")
    .action(async (codeRepos: string[], opts) => {
      const result = await verify({ hub: opts.hub, codeRepos });
      if (!result.passed) process.exit(1);
    });

  // ─── list ──────────────────────────────────────────────────────────────────
  program
    .command("list")
    .description("List the projects in this hub")
    .option("--hub <path>", "hub root (default: cwd)")
    .action(async (opts) => {
      await list({ hub: opts.hub });
    });

  // ─── migrate ─────────────────────────────────────────────────────────────────
  program
    .command("migrate")
    .description(
      "Upgrade this KB's metadata to the current schema (idempotent; never commits)",
    )
    .option(
      "--dir <path>",
      "where to look for the knowledge base (default: cwd; walks up)",
    )
    .action(async (opts: { dir?: string }) => {
      reportMigrate(await mageMigrate({ dir: opts.dir }));
    });

  // ─── status ────────────────────────────────────────────────────────────────
  program
    .command("status")
    .description("Check per-machine link health for one or more code repos")
    .argument("<code-repos...>", "code repos to check")
    .action(async (codeRepos: string[]) => {
      const result = await status({ codeRepos });
      if (!result.passed) process.exit(1);
    });

  // ─── autonomy ────────────────────────────────────────────────────────────────
  program
    .command("autonomy")
    .description(
      "Show or set this KB's opt-in grooming autonomy level (operator | approver | overseer; ADR-0030; never commits)",
    )
    .argument("[level]", "the level to set: operator | approver | overseer (omit to show the current level)")
    .option("--dir <path>", "where to look for the knowledge base (default: cwd; walks up)")
    .action(async (level: string | undefined, opts: { dir?: string }) => {
      await autonomy({ level, dir: opts.dir });
    });

  // ─── doctor ────────────────────────────────────────────────────────────────
  program
    .command("doctor")
    .description(
      "Diagnose env + KB & connection health; --fix repairs ignores; --report bundles logs",
    )
    .option("--hub <path>", "hub root (default: cwd if it looks like a hub)")
    .option("--fix", "add any missing capture-sink ignore rules")
    .option(
      "--report",
      "print a redacted, content-free support bundle for issues",
    )
    .action(async (opts) => {
      const result = await doctor({
        hub: opts.hub,
        fix: opts.fix,
        report: opts.report,
      });
      if (!result.passed) process.exit(1);
    });

  // ─── dashboard ──────────────────────────────────────────────────────────────
  program
    .command("dashboard")
    .description(
      "Generate this KB's dashboard (Dashboard.md + Knowledge.base; --html adds the interactive cockpit)",
    )
    .option("--html", "also generate the self-contained dashboard.html cockpit")
    .option("--hub <path>", "hub root")
    .option("--open", "print the command to open the html")
    .addOption(
      new Option(
        "--open-with <target>",
        "where clicking a note opens it: file (relative link, works anywhere) | obsidian | vscode",
      )
        .choices([...OPEN_WITH_TARGETS])
        .default("file"),
    )
    .action(async (opts) => {
      await dashboard({
        hub: opts.hub,
        html: opts.html,
        open: opts.open,
        openWith: opts.openWith,
      });
    });

  // ─── connect ──────────────────────────────────────────────────────────────
  program
    .command("connect")
    .description(
      "Wire mage capture hooks into this repo's Claude Code settings (.claude/settings.local.json; personal + gitignored)",
    )
    .option(
      "--user",
      "target the personal ~/.claude/settings.json instead of the repo-local file",
    )
    .option(
      "--all-projects",
      "from a hub: wire every registered project's code repo (repo-local each)",
    )
    .option("--no-git-hook", "skip installing the redaction pre-commit hook")
    .option("-y, --yes", "non-interactive: skip the confirmation prompt")
    .action(async (opts) => {
      if (opts.allProjects) {
        await connectAllProjects({ yes: opts.yes, gitHook: opts.gitHook });
      } else {
        await connect({ user: opts.user, yes: opts.yes, gitHook: opts.gitHook });
      }
    });

  // ─── disconnect ───────────────────────────────────────────────────────────
  program
    .command("disconnect")
    .description(
      "Remove mage's capture hooks from this repo's Claude Code settings (leaves host hooks intact)",
    )
    .option(
      "--user",
      "target the personal ~/.claude/settings.json instead of the repo-local file",
    )
    .option("--no-git-hook", "skip removing the redaction pre-commit hook")
    .option(
      "-y, --yes",
      "non-interactive: accepted for symmetry (no destructive prompt)",
    )
    .action(async (opts) => {
      await disconnect({ user: opts.user, yes: opts.yes, gitHook: opts.gitHook });
    });

  return program;
}

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Coerce a user-supplied `--storage` value to the v2 vocabulary, accepting the
 * pre-0.0.10 alias `in-repo` for `repo-owned` (mirrors the lenient metadata read).
 */
function coerceStorage(value: string | undefined): Storage | undefined {
  if (value === undefined) return undefined;
  if (value === "in-repo" || value === "repo-owned") return "repo-owned";
  if (value === "hub-owned") return "hub-owned";
  throw new Error(
    `Unknown --storage '${value}'. Use 'repo-owned' (legacy 'in-repo' is accepted) or 'hub-owned'.`,
  );
}

function modeFromOpts(opts: {
  inRepo?: boolean;
  hub?: boolean;
  external?: boolean;
}): InitMode | undefined {
  if (opts.external) {
    throw new Error(
      "`--external` was removed in 0.0.10 — use `--hub` to create a standalone hub.",
    );
  }
  const picked = [opts.inRepo && "in-repo", opts.hub && "hub"].filter(
    Boolean,
  ) as InitMode[];
  if (picked.length === 0) return undefined;
  if (picked.length > 1) {
    throw new Error("Pick exactly one of --in-repo or --hub");
  }
  return picked[0];
}

function visibilityFromOpts(opts: {
  private?: boolean;
  public?: boolean;
  local?: boolean;
}): InitVisibility | undefined {
  const picked = [
    opts.private && "private",
    opts.public && "public",
    opts.local && "local",
  ].filter(Boolean) as InitVisibility[];
  if (picked.length === 0) return undefined;
  if (picked.length > 1) {
    throw new Error(
      `Pick exactly one of --private, --public, --local (got: ${picked.join(", ")})`,
    );
  }
  return picked[0];
}
