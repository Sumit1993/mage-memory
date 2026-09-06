import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENTS_FILE,
  CLAUDE_FILE,
  DECISIONS_DIR,
  INDEX_FILE,
  NOTES_DIR,
  absolutePath,
  assertSafeName,
  exists,
} from "./paths.js";

export const BEGIN = "<!-- BEGIN mage -->";
export const END = "<!-- END mage -->";
const CLAUDE_IMPORT = "@AGENTS.md";

export const KEPT_HAND_EDITS_MARKER = "has hand edits and was left as is";

export function keptHandEditsWarning(path: string): string {
  return `${path}: the mage block between <!-- BEGIN mage --> and <!-- END mage --> ${KEPT_HAND_EDITS_MARKER}. Re-run with --force-agents-md to regenerate it (your edits in the block will be lost).`;
}

export function blockHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

const STAMP_RE = /^<!-- mage-block-hash: ([0-9a-f]{12}) -->\r?\n/;

function innerOf(block: string): string {
  const b = block.indexOf(BEGIN);
  const e = block.indexOf(END);
  if (b >= 0 && e > b) {
    const afterBegin = block.indexOf("\n", b);
    if (afterBegin >= 0 && afterBegin < e) {
      let beforeEnd = e;
      if (beforeEnd > 0 && block[beforeEnd - 1] === "\n") {
        beforeEnd--;
        if (beforeEnd > 0 && block[beforeEnd - 1] === "\r") {
          beforeEnd--;
        }
      }
      return block.slice(afterBegin + 1, beforeEnd);
    }
  }
  return block;
}

export function stampOf(block: string): string | null {
  const inner = innerOf(block);
  const m = inner.match(STAMP_RE);
  return m?.[1] ?? null;
}

export function bodyOf(block: string): string {
  const inner = innerOf(block);
  return inner.replace(STAMP_RE, "");
}

function stampedBlock(body: string): string {
  return `${BEGIN}\n<!-- mage-block-hash: ${blockHash(body)} -->\n${body}\n${END}`;
}

/**
 * Which AGENTS.md block to write, discriminated on the reconciled `kind`
 * (`repo` | `hub`; ADR-0009/0012 vocabulary). A code repo's KB additionally
 * carries its on-disk `mode` (`in-repo` | `hybrid` | `external`) — the three
 * metadata modes — which selects the wording; a hub has no mode. This mirrors the
 * metadata split exactly: `kind` is the runtime umbrella, `mode` the on-disk shape.
 * (Previously a single 4-value `kind` blended the two, colliding with the
 * `ResolvedDocsRoot.kind` = `repo|hub` reconcile.)
 */
export interface RepoAgentsMd {
  kind: "repo";
  /** The on-disk metadata mode; picks the in-repo / hybrid / external template. */
  mode: "in-repo" | "hybrid" | "external";
  /** Relative path (from `root`) to the KB — "mage" for a code repo. */
  docsRel: string;
  /** external/hybrid only: absolute path to the hub root this repo is registered with. */
  hubPath?: string;
  /** external/hybrid only: the project name as registered in the hub (its wing). */
  project?: string;
}
export interface HubAgentsMd {
  kind: "hub";
  /** Relative path (from `root`) to the KB — "." for a hub. */
  docsRel: string;
}
export type AgentsMdOptions = RepoAgentsMd | HubAgentsMd;

export interface AgentsMdWriteResult {
  /** What happened to AGENTS.md. `kept-hand-edits`: the block on disk was edited by hand and was left alone. */
  agents: "created" | "written" | "unchanged" | "kept-hand-edits";
  /** Absolute path of the AGENTS.md examined. */
  path: string;
}

function rel(docsRel: string, child: string): string {
  return docsRel === "." ? child : `${docsRel}/${child}`;
}

/**
 * The block written into an EXTERNAL code repo: its durable knowledge lives in a
 * mage hub, so route agents to the hub index and name this repo's wing. The entry
 * is the always-present hub `INDEX.md` (ADR-0011 §6 — NOT the retired
 * `projects/<name>/mage/INDEX.md`); in a large/hierarchical hub the wing links
 * out to its own `_index.<project>.md`, which only exists in that mode.
 */
function externalBlock(opts: RepoAgentsMd): string {
  const hub = opts.hubPath ?? "";
  const project = opts.project ?? "";
  assertSafeName(project, "project name");
  const projIndex = `${hub}/_index.${project}.md`;
  const hubIndex = `${hub}/${INDEX_FILE}`;
  const hubDecisions = `${hub}/${DECISIONS_DIR}/`;
  return `## mage knowledge base (hub-linked)

This repository's durable knowledge lives in a **mage hub** at
\`${hub}\`, where this repo is the **${project}** project. mage is a portable,
file-based knowledge base of notes — insight, procedure, and pointers (not
copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read the hub index first: \`${hubIndex}\` — find the **${project}** wing (its
   notes are grouped there; in a large hub the wing links out to its own
   \`${projIndex}\`). One line per note: type · title · keywords · → link. Open
   only the notes the task touches; don't read everything.
2. Skim \`${hubDecisions}\` for the hub's governing decisions.
3. Treat notes as point-in-time. If a note is \`status: stale-suspect\`, or its
   \`last_reviewed\` / \`provenance.commit\` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with \`mage:learn\` into
the hub. Capture the reusable *insight + procedure + pointers*, never a copy.

**Capture lessons inline, at first sight.** When you learn something durable
mid-task, stage a SHORT draft right then — \`mage stage --title "..." --tags
wing/room\` (body on stdin; it is scrubbed and parked in \`.staging/\`). No per-note
confirm; you batch-review the drafts later with \`mage:groom\`. Don't wait for a
session boundary — capture at first sight.

**Commit hygiene:** mage never commits for you. It suggests \`git\` commands; you
run them.`;
}

function mageBlock(opts: AgentsMdOptions): string {
  if (opts.kind === "repo" && opts.mode === "external") return externalBlock(opts);
  const indexPath = rel(opts.docsRel, INDEX_FILE);
  const notesPath = rel(opts.docsRel, `${NOTES_DIR}/`);
  const decisionsPath = rel(opts.docsRel, `${DECISIONS_DIR}/`);
  const kbDesc = kbDescription(opts);
  return `## mage knowledge base

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
services couple, a faster path to a source — capture it with \`mage:learn\`, or
add a note under \`${notesPath}\` and run \`mage index\`. Capture the reusable
*insight + procedure + pointers*, never a copy of the source.

**Capture lessons inline, at first sight.** When you learn something durable
mid-task, stage a SHORT draft right then — \`mage stage --title "..." --tags
wing/room\` (body on stdin; it is scrubbed and parked in \`.staging/\`). No per-note
confirm; you batch-review the drafts later with \`mage:groom\`. Don't wait for a
session boundary — capture at first sight.

**Commit hygiene:** mage never commits for you. It suggests \`git\` commands; you
run them.`;
}

/**
 * The one-line "what this KB is" sentence, by shape. A hub spans several repos; a
 * hybrid repo stores locally AND is registered with one or more hubs; an in-repo
 * repo just stores locally. (external never reaches here — {@link mageBlock} routes
 * it to {@link externalBlock} — but this stays total over the type.)
 */
function kbDescription(opts: AgentsMdOptions): string {
  if (opts.kind === "hub") {
    return "This repository is a **mage hub** — a multi-project knowledge base spanning several repos/services.";
  }
  if (opts.mode === "hybrid") {
    return `This repository has a **mage** knowledge base at \`${opts.docsRel}/\` and is also registered with one or more external hubs.`;
  }
  return `This repository has a **mage** knowledge base at \`${opts.docsRel}/\`.`;
}

function renderBlock(opts: AgentsMdOptions): string {
  const body = mageBlock(opts);
  return stampedBlock(body);
}

/** Insert-or-replace the mage block in AGENTS.md, and ensure CLAUDE.md imports it. */
export async function writeAgentsMd(
  root: string,
  opts: AgentsMdOptions,
  write: { force?: boolean } = {},
): Promise<AgentsMdWriteResult> {
  const filePath = absolutePath(join(root, AGENTS_FILE));
  const agents = await upsertAgentsFile(filePath, opts, write);
  await ensureClaudeImport(join(root, CLAUDE_FILE));
  return { agents, path: filePath };
}

async function upsertAgentsFile(
  path: string,
  opts: AgentsMdOptions,
  write: { force?: boolean } = {},
): Promise<AgentsMdWriteResult["agents"]> {
  const rendered = renderBlock(opts);
  if (!(await exists(path))) {
    await writeFile(
      path,
      `# AGENTS.md\n\nInstructions for AI coding agents working in this repository.\n\n${rendered}\n`,
    );
    return "created";
  }
  const current = await readFile(path, "utf8");
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);

  if (start < 0) {
    // File without BEGIN: append as today, written
    const next = `${current.replace(/\n*$/, "")}\n\n${rendered}\n`;
    await writeFile(path, next);
    return "written";
  }

  if (end < 0 || end <= start) {
    // BEGIN present, END absent (orphan)
    if (write.force) {
      const next = `${current.slice(0, start)}${rendered}\n`;
      await writeFile(path, next);
      return "written";
    }
    return "kept-hand-edits";
  }

  // Block present. Let onDisk be the BEGIN..END block inclusive and rendered the new stamped block.
  const onDisk = current.slice(start, end + END.length);
  const onDiskBody = bodyOf(onDisk);
  const renderedBody = bodyOf(rendered);
  const onDiskStamp = stampOf(onDisk);

  if (onDiskBody === renderedBody) {
    if (onDisk === rendered) {
      return "unchanged";
    }
    const next = current.slice(0, start) + rendered + current.slice(end + END.length);
    await writeFile(path, next);
    return "written";
  }

  if (onDiskStamp !== null && onDiskStamp === blockHash(onDiskBody)) {
    const next = current.slice(0, start) + rendered + current.slice(end + END.length);
    await writeFile(path, next);
    return "written";
  }

  if (write.force) {
    const next = current.slice(0, start) + rendered + current.slice(end + END.length);
    await writeFile(path, next);
    return "written";
  }

  return "kept-hand-edits";
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
