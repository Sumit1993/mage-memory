import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENTS_FILE,
  CLAUDE_FILE,
  DECISIONS_DIR,
  INDEX_FILE,
  NOTES_DIR,
  assertSafeName,
  exists,
} from "./paths.js";

const BEGIN = "<!-- BEGIN mage -->";
const END = "<!-- END mage -->";
const CLAUDE_IMPORT = "@AGENTS.md";

export interface AgentsMdOptions {
  /** Relative path (from `root`) to the knowledge base: "mage" in-repo, "." for a hub. */
  docsRel: string;
  kind: "in-repo" | "hub" | "external";
  /** external only: absolute path to the hub root this code repo is registered with. */
  hubPath?: string;
  /** external only: the project name as registered in the hub (its wing). */
  project?: string;
}

function rel(docsRel: string, child: string): string {
  return docsRel === "." ? child : `${docsRel}/${child}`;
}

/**
 * The block written into an EXTERNAL code repo: its durable knowledge lives in a
 * mage hub, so route agents to the hub's per-project entry `<hub>/_index.<project>.md`
 * (ADR-0011 §6 — the per-project entry is the tag-defined wing index, NOT the
 * retired `projects/<name>/mage/INDEX.md`).
 */
function externalBlock(opts: AgentsMdOptions): string {
  const hub = opts.hubPath ?? "";
  const project = opts.project ?? "";
  assertSafeName(project, "project name");
  const projIndex = `${hub}/_index.${project}.md`;
  const hubIndex = `${hub}/${INDEX_FILE}`;
  const hubDecisions = `${hub}/${DECISIONS_DIR}/`;
  return `${BEGIN}
## mage knowledge base (external hub)

This repository's durable knowledge lives in an external **mage hub** at
\`${hub}\`, where this repo is the **${project}** project. mage is a portable,
file-based knowledge base of notes — insight, procedure, and pointers (not
copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read this project's entry point first: \`${projIndex}\` — the ${project} wing
   of the hub index (one line per note: type · title · keywords · → link). Open
   only the notes the task actually touches; don't read everything.
2. For cross-cutting context, read the hub index \`${hubIndex}\` and skim
   \`${hubDecisions}\` for governing decisions.
3. Treat notes as point-in-time. If a note is \`status: stale-suspect\`, or its
   \`last_reviewed\` / \`provenance.commit\` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with \`/mage-learn\` into
the hub. Capture the reusable *insight + procedure + pointers*, never a copy.

**Commit hygiene:** mage never commits for you. It suggests \`git\` commands; you
run them.
${END}`;
}

function mageBlock(opts: AgentsMdOptions): string {
  if (opts.kind === "external") return externalBlock(opts);
  const indexPath = rel(opts.docsRel, INDEX_FILE);
  const notesPath = rel(opts.docsRel, `${NOTES_DIR}/`);
  const decisionsPath = rel(opts.docsRel, `${DECISIONS_DIR}/`);
  const kbDesc =
    opts.kind === "hub"
      ? "This repository is a **mage hub** — a multi-project knowledge base spanning several repos/services."
      : `This repository has a **mage** knowledge base at \`${opts.docsRel}/\`.`;
  return `${BEGIN}
## mage knowledge base

${kbDesc} mage is a portable, file-based knowledge base of notes — insight,
procedure, and pointers (not copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read \`${indexPath}\` first — the always-current index of what's known
   (one line per note: type · title · keywords · → link). Open only the notes
   the task actually touches; don't read everything.
2. Follow the links in those notes (standard markdown \`[text](path.md)\` links)
   and skim \`${decisionsPath}\` for governing decisions.
3. Treat notes as point-in-time. If a note is \`status: stale-suspect\`, or its
   \`last_reviewed\` / \`provenance.commit\` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with \`/mage-learn\`, or
add a note under \`${notesPath}\` and run \`mage index\`. Capture the reusable
*insight + procedure + pointers*, never a copy of the source.

**Commit hygiene:** mage never commits for you. It suggests \`git\` commands; you
run them.
${END}`;
}

/** Insert-or-replace the mage block in AGENTS.md, and ensure CLAUDE.md imports it. */
export async function writeAgentsMd(root: string, opts: AgentsMdOptions): Promise<void> {
  await upsertAgentsFile(join(root, AGENTS_FILE), opts);
  await ensureClaudeImport(join(root, CLAUDE_FILE));
}

async function upsertAgentsFile(path: string, opts: AgentsMdOptions): Promise<void> {
  const block = mageBlock(opts);
  if (!(await exists(path))) {
    await writeFile(
      path,
      `# AGENTS.md\n\nInstructions for AI coding agents working in this repository.\n\n${block}\n`,
    );
    return;
  }
  const current = await readFile(path, "utf8");
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  let next: string;
  if (start >= 0 && end > start) {
    next = current.slice(0, start) + block + current.slice(end + END.length);
  } else if (start >= 0) {
    // Orphaned BEGIN (END missing or truncated) — replace from BEGIN to EOF
    // rather than appending a second block.
    next = `${current.slice(0, start)}${block}\n`;
  } else {
    next = `${current.replace(/\n*$/, "")}\n\n${block}\n`;
  }
  if (next !== current) await writeFile(path, next);
}

async function ensureClaudeImport(path: string): Promise<void> {
  if (!(await exists(path))) {
    await writeFile(path, `# CLAUDE.md\n\n${CLAUDE_IMPORT}\n`);
    return;
  }
  const current = await readFile(path, "utf8");
  if (current.includes(CLAUDE_IMPORT)) return;
  await writeFile(path, `${current.replace(/\n*$/, "")}\n\n${CLAUDE_IMPORT}\n`);
}
