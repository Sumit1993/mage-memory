import { Command, Option } from "commander";
import { doctor } from "./commands/doctor.js";
import { dream } from "./commands/dream-cmd.js";
import { index } from "./commands/index-cmd.js";
import { ingestCmd } from "./commands/ingest.js";
import { type InitMode, type InitVisibility, init } from "./commands/init.js";
import { link, type Storage } from "./commands/link.js";
import { list } from "./commands/list.js";
import { redactCmd } from "./commands/redact.js";
import { skills } from "./commands/skills-cmd.js";
import { status } from "./commands/status.js";
import { unlink } from "./commands/unlink.js";
import { verify } from "./commands/verify.js";
import { logger } from "./logger.js";

const program = new Command();

program
  .name("mage")
  .description(
    "A portable, self-maintaining knowledge base for software systems — notes navigable as an Obsidian graph, usable by any AI coding agent",
  )
  .version("0.0.2");

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
  .addOption(new Option("--external", "deprecated alias of --hub").hideHelp())
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
    });
  });

// ─── index ───────────────────────────────────────────────────────────────────
program
  .command("index")
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
  .action(async (opts) => {
    await skills({ dir: opts.dir });
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
  .action(async (opts) => {
    const result = await dream({ dir: opts.dir, staleDays: opts.staleDays });
    if (opts.strict && result.findingCount > 0) process.exit(1);
  });

// ─── ingest ──────────────────────────────────────────────────────────────────
program
  .command("ingest")
  .description(
    "Enumerate + classify ingestable sources under <dir> (read-only) — what `mage:learn --from` distills.",
  )
  .argument("<dir>", "directory to scan for ingestable sources")
  .option("--json", "emit the manifest as JSON to stdout (machine-readable)")
  .action(async (dir: string, opts: { json?: boolean }) => {
    await ingestCmd(dir, { json: opts.json });
  });

// ─── redact ──────────────────────────────────────────────────────────────────
program
  .command("redact")
  .description(
    "Deterministically scan a file or stdin for secrets/PII (ADR-0014 Gate 2); --strip emits redacted text",
  )
  .argument("[file]", "file to scan (default: stdin; '-' is also stdin)")
  .option(
    "--strip",
    "print the redacted text to stdout (secret values → [REDACTED:<kind>])",
  )
  .option("--quiet", "suppress the findings report")
  .action(
    async (
      file: string | undefined,
      opts: { strip?: boolean; quiet?: boolean },
    ) => {
      const result = await redactCmd(file, {
        strip: opts.strip,
        quiet: opts.quiet,
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
    "override auto-detected storage: 'in-repo' (hybrid; hub references in-repo docs) or 'hub-owned' (hub owns the docs)",
  )
  .option("-y, --yes", "non-interactive: auto-confirm prompts")
  .action(
    async (
      hubPath: string,
      opts: { project?: string; storage?: Storage; yes?: boolean },
    ) => {
      await link(hubPath, {
        project: opts.project,
        storage: opts.storage,
        yes: opts.yes,
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

// ─── status ────────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Check per-machine link health for one or more code repos")
  .argument("<code-repos...>", "code repos to check")
  .action(async (codeRepos: string[]) => {
    const result = await status({ codeRepos });
    if (!result.passed) process.exit(1);
  });

// ─── doctor ────────────────────────────────────────────────────────────────
program
  .command("doctor")
  .description("Diagnose your environment (Node, git, gh, npx skills, network)")
  .option("--hub <path>", "hub root (default: cwd if it looks like a hub)")
  .action(async (opts) => {
    const result = await doctor({ hub: opts.hub });
    if (!result.passed) process.exit(1);
  });

// Top-level error handling
program.exitOverride();
try {
  await program.parseAsync(process.argv);
} catch (err) {
  const e = err as Error & { code?: string };
  if (e.code === "commander.helpDisplayed" || e.code === "commander.version")
    process.exit(0);
  if (e.code === "commander.help") process.exit(0);
  // Inquirer raises an ExitPromptError on Ctrl+C — treat as normal exit, not error
  if (
    e.message?.includes("force closed the prompt") ||
    e.code === "ERR_USE_AFTER_CLOSE"
  ) {
    logger.detail("Cancelled.");
    process.exit(130);
  }
  logger.error(e.message);
  process.exit(1);
}

// ─── helpers ───────────────────────────────────────────────────────────────

function modeFromOpts(opts: {
  inRepo?: boolean;
  hub?: boolean;
  external?: boolean;
}): InitMode | undefined {
  if (opts.external && !opts.hub) {
    logger.warn("`--external` is deprecated; use `--hub`.");
  }
  const wantsHub = opts.hub || opts.external;
  const picked = [opts.inRepo && "in-repo", wantsHub && "hub"].filter(
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
