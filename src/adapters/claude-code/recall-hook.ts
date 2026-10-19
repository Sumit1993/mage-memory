// Runs from cli.ts before the command program loads: never import commander or
// cli-program here (latency, #239). Injects context only, never a decision (#282).

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { parseNote } from "../../note.js";
import { DECISIONS_DIR, recallStatePath, resolveDocsRoot } from "../../paths.js";
import { isGeneratedArtifact, listNotePaths, safeSegment } from "../../scan.js";
import { checkAdmission } from "../../scanner/admission.js";
import {
  type Matcher,
  type Trigger,
  type ToolTarget,
  firstHit,
  parseTrigger,
  toolTarget,
} from "../../scanner/trigger.js";
import { recoverCcFrontmatter } from "./cc-note.js";
import { obj, parseHookPayload, readStdinSafe, str } from "./hook-io.js";

export const RECALL_LIMITS = { maxNotes: 3, maxBytes: 3000, bodyBytes: 800, budgetMs: 1500 } as const;

interface RecallNote {
  relPath: string;
  title: string;
  trigger: Trigger;
  pointer: string;
  body: string;
}

interface Selection {
  chosen: RecallNote[];
  text: string;
}

interface Loaded {
  notes: RecallNote[];
  /** Admitted notes whose trigger has no valid match; counted for --explain only. */
  withoutMatch: number;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");

function titleOf(body: string, relPath: string): string {
  const line = body.split(/\r?\n/).find((l) => l.startsWith("# "));
  return line ? line.slice(2).trim() : basename(relPath);
}

/** The body cut at the last newline before `bodyBytes`, with a pointer to the full note. */
function truncatedBody(body: string, relPath: string): string {
  const text = body.trim();
  if (byteLength(text) <= RECALL_LIMITS.bodyBytes) return text;
  const head = Buffer.from(text, "utf8").subarray(0, RECALL_LIMITS.bodyBytes).toString("utf8");
  const clean = head.replace(/�+$/, "");
  const cut = clean.lastIndexOf("\n");
  return `${(cut > 0 ? clean.slice(0, cut) : clean).trimEnd()}\n… (truncated; read ${relPath})`;
}

async function loadNote(root: string, relPath: string, parseAll: boolean): Promise<RecallNote | "no-match" | null> {
  const raw = await readFile(join(root, relPath), "utf8").catch(() => null);
  if (raw === null) return null;
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const frontmatterText = FRONTMATTER_RE.exec(text)?.[1];
  if (frontmatterText === undefined) return null;
  if (!parseAll && !frontmatterText.includes("match:")) return null;
  try {
    const { frontmatter, body } = parseNote(text);
    if (checkAdmission(frontmatter, text).length > 0) return null;
    const recovered = recoverCcFrontmatter(frontmatter).frontmatter;
    const trigger = parseTrigger(recovered.trigger);
    const pointer = str(recovered.pointer);
    if (!trigger || !pointer) return null;
    if (trigger.matchers.length === 0) return "no-match";
    return { relPath, title: titleOf(body, relPath), trigger, pointer, body: truncatedBody(body, relPath) };
  } catch {
    return null; // a malformed note is skipped, never fatal
  }
}

async function loadAdmitted(root: string, parseAll: boolean): Promise<Loaded> {
  const paths = (await listNotePaths(root)).filter(
    (p) => !isGeneratedArtifact(p) && !p.split("/").includes(DECISIONS_DIR),
  );
  const loaded = await Promise.all(paths.map((p) => loadNote(root, p, parseAll)));
  const notes: RecallNote[] = [];
  let withoutMatch = 0;
  for (const item of loaded) {
    if (item === "no-match") withoutMatch += 1;
    else if (item) notes.push(item);
  }
  return { notes, withoutMatch };
}

function render(tool: string, notes: RecallNote[]): string {
  const head = `mage recall: ${notes.length} note(s) for this ${tool} call.`;
  const blocks = notes.map(
    (n) => `## ${n.title} (${n.relPath})\nwhen: ${n.trigger.when}\npointer: ${n.pointer}\n${n.body}`,
  );
  return [head, ...blocks].join("\n\n");
}

/** Up to `maxNotes` notes inside `maxBytes`; a note that does not fit is skipped, not chosen. */
function select(tool: string, hits: RecallNote[]): Selection {
  const chosen: RecallNote[] = [];
  for (const note of hits) {
    if (chosen.length >= RECALL_LIMITS.maxNotes) break;
    if (byteLength(render(tool, [...chosen, note])) <= RECALL_LIMITS.maxBytes) chosen.push(note);
  }
  return { chosen, text: chosen.length > 0 ? render(tool, chosen) : "" };
}

async function readInjected(root: string, session: string): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(recallStatePath(root, session), "utf8"));
    const list = obj(parsed)?.injected;
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeInjected(root: string, session: string, injected: Set<string>): Promise<void> {
  const file = recallStatePath(root, session);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ injected: [...injected] }));
}

/** Forget what was injected this session (compaction drops it from the model's context). */
export async function clearRecallState(root: string, session: string | undefined): Promise<void> {
  if (!session || !safeSegment(session)) return;
  await rm(recallStatePath(root, session), { force: true }).catch(() => undefined);
}

interface Context {
  root: string;
  tool: string;
  target: ToolTarget;
}

async function contextOf(payload: Record<string, unknown>, cwdOverride?: string): Promise<Context | null> {
  const tool = str(payload.tool_name);
  const input = obj(payload.tool_input);
  if (!tool || !input) return null;
  const cwd = cwdOverride ?? str(payload.cwd) ?? process.cwd();
  const resolved = await resolveDocsRoot(cwd).catch(() => null);
  if (!resolved) return null;
  const target = toolTarget(tool, input, { cwd, repo: resolved.repo });
  return target ? { root: resolved.root, tool, target } : null;
}

/** The additionalContext text for one PreToolUse call, or null. Records what it injected. */
export async function recallContext(
  payload: Record<string, unknown>,
  opts: { cwd?: string } = {},
): Promise<string | null> {
  const ctx = await contextOf(payload, opts.cwd);
  if (!ctx) return null;
  const { notes } = await loadAdmitted(ctx.root, false);
  const hits = notes.filter((n) => firstHit(n.trigger, ctx.target) !== undefined);
  if (hits.length === 0) return null;

  const sessionId = str(payload.session_id);
  const session = sessionId && safeSegment(sessionId) ? sessionId : undefined;
  const injected = session ? await readInjected(ctx.root, session) : new Set<string>();
  const { chosen, text } = select(
    ctx.tool,
    hits.filter((n) => !injected.has(n.relPath)),
  );
  if (chosen.length === 0) return null;

  if (session) {
    for (const n of chosen) injected.add(n.relPath);
    await writeInjected(ctx.root, session, injected).catch(() => undefined);
  }
  return text;
}

/** The `--explain` report: which admitted notes match this call and what would be injected. */
export async function explainRecall(
  payload: Record<string, unknown>,
  opts: { cwd?: string } = {},
): Promise<string> {
  const ctx = await contextOf(payload, opts.cwd);
  if (!ctx) return "recall: no knowledge base, or a tool call recall does not cover";
  const { notes, withoutMatch } = await loadAdmitted(ctx.root, true);
  const width = Math.max(0, ...notes.map((n) => n.relPath.length));
  const rows = notes.map((n) => {
    const hit: Matcher | undefined = firstHit(n.trigger, ctx.target);
    const label = hit ? "match" : "skip";
    const matchers = hit ? hit.raw : n.trigger.matchers.map((m) => m.raw).join(", ");
    return `  ${label.padEnd(5)}  ${n.relPath.padEnd(width)}  ${matchers}`;
  });
  const hits = notes.filter((n) => firstHit(n.trigger, ctx.target) !== undefined);
  const { chosen, text } = select(ctx.tool, hits);
  return [
    `recall: ${ctx.tool} ${JSON.stringify(ctx.target.text)}`,
    ...rows,
    `  ${withoutMatch} admitted note(s) have no trigger.match`,
    `would inject ${chosen.length} note(s), ${byteLength(text)} bytes`,
  ].join("\n");
}

/** Entry for `mage recall-hook`: hook JSON on stdin, additionalContext JSON on stdout. */
export async function runRecallHook(argv: string[]): Promise<void> {
  setTimeout(() => process.exit(0), RECALL_LIMITS.budgetMs).unref();
  try {
    const { values } = parseArgs({
      args: argv,
      options: { cwd: { type: "string" }, explain: { type: "boolean" } },
      strict: false,
    });
    const cwd = typeof values.cwd === "string" ? values.cwd : undefined;
    const raw = await readStdinSafe();
    const payload = raw.trim().length === 0 ? null : parseHookPayload(raw);
    if (!payload) return;
    if (values.explain === true) {
      process.stdout.write(`${await explainRecall(payload, { cwd })}\n`);
      return;
    }
    const text = await recallContext(payload, { cwd });
    if (text === null) return;
    const out = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } };
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch {
    // Fail open: recall must never break the agent's tool call.
  }
}
