// Gate-0 on native-memory writes: scrub in flight, deny a generated index, ask the ladder
// once per session. A failed secret scan denies; any other error passes, because a secret
// in the committed KB is published and a missed ladder is not (ADR-0053, #282).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Command } from "commander";
import { parseNote } from "../../note.js";
import { isUnder, ladderMarkerPath, NOTES_DIR, resolveDocsRoot } from "../../paths.js";
import { redact } from "../../redact.js";
import { isGeneratedArtifact, safeSegment } from "../../scan.js";
import { RUNGS } from "../../scanner/admission.js";
import { recoverCcFrontmatter } from "./cc-note.js";
import { obj, parseHookPayload, readStdinSafe, str } from "./hook-io.js";

const DENY_REASON = "mage owns this file; `mage index` regenerates it. Do not add lines here.";

const SCAN_FAILED_REASON = "mage could not scan this write for secrets";

export const LADDER_TEXT = [
  "mage:ladder (asked once this session; write again and it passes)",
  "Before saving this memory, take each fact in it to the highest rung that can carry it.",
  "Build that, then keep as a note only what no rung above can carry. Copy the template that fits.",
  "",
  "1 impossible: a deny rule in .claude/settings.json",
  '  {"permissions": {"deny": ["Edit(generated/**)", "Write(generated/**)"]}}',
  "2 check: a test, lint rule or pre-commit check that fails on the mistake",
  "  # .git/hooks/pre-commit",
  "  if git diff --cached -U0 -- src | grep -q '^+.*console\\.log'; then echo \"use logger, not console.log\"; exit 1; fi",
  "3 hook: a PreToolUse hook in .claude/settings.json that blocks with a reason",
  '  {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "node .claude/hooks/commit-issue.mjs"}]}]}}',
  "  The script reads the tool call JSON on stdin; to block it prints",
  '  {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "commit subjects need (#N)"}}',
  "4 rule: one line in AGENTS.md carrying an id",
  "  - Keep commit subjects under 60 characters. [mage:repo/rule/short-commit-subjects]",
  "5 note: add to the note's frontmatter",
  "  rung: note",
  '  trigger: {when: "<the moment it matters>", match: ["Bash(<cmd> *)", "Edit(<glob>)"]}',
  '  pointer: "[<source>](<path or issue>)"',
  "A memory that carries rung: is never stopped.",
].join("\n");

/** The pure decision for a PreToolUse Write/Edit — unit-testable, no stdout. */
export type MemoryDecision =
  | { kind: "deny"; reason: string }
  | {
      kind: "rewrite";
      updatedInput: Record<string, unknown>;
      reason: string;
      slug: string;
      masked: number;
    }
  | { kind: "pass" };

const PASS: MemoryDecision = { kind: "pass" };

type MemoryTarget = { abs: string; rel: string; flat: boolean };

/** Where a write lands: under `notes/`, or a flat `.md` at the docs root; null for anything else. */
function memoryTarget(root: string, filePath: string, cwd: string): MemoryTarget | null {
  const notesDir = join(root, NOTES_DIR);
  const candidates = isAbsolute(filePath)
    ? [filePath]
    : [resolve(cwd, filePath), resolve(root, filePath)];
  for (const abs of candidates) {
    if (isUnder(notesDir, abs) && abs !== notesDir) {
      return { abs, rel: relative(root, abs).split(sep).join("/"), flat: false };
    }
  }
  // POSIX-normalize before the structural checks: on native Windows `relative` yields
  // backslashes and a `sub\note.md` write would pass for flat (isGeneratedArtifact wants "/").
  const rel = relative(root, filePath).split(sep).join("/");
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  if (rel.includes("/") || !rel.endsWith(".md")) return null;
  return { abs: resolve(root, rel), rel, flat: true };
}

function rewriteReason(masked: number): string {
  return masked > 0
    ? `mage scrubbed ${masked} secret/PII value(s) before this memory reached disk.`
    : "mage scanned this memory write — no secrets found.";
}

/** The file as it will read after the call: the Write content, or the Edit applied to the file on disk. */
async function effectiveContent(
  toolName: "Write" | "Edit",
  input: Record<string, unknown>,
  abs: string,
): Promise<string> {
  if (toolName === "Write") return str(input.content) ?? "";
  const newStr = str(input.new_string) ?? "";
  const oldStr = str(input.old_string);
  const existing = await readFile(abs, "utf8").catch(() => null);
  if (existing === null) return newStr;
  return oldStr !== undefined ? existing.replace(oldStr, () => newStr) : existing;
}

/** True when the frontmatter, after Claude Code's `metadata:` nesting is unwrapped, names a rung. */
function carriesRung(content: string): boolean {
  try {
    const rung = recoverCcFrontmatter(parseNote(content).frontmatter).frontmatter.rung;
    return typeof rung === "string" && (RUNGS as readonly string[]).includes(rung);
  } catch {
    return false; // unparseable frontmatter does not carry a rung
  }
}

/**
 * True exactly once per session, for a write that carries no rung: creating the marker is
 * the test, so a marker that cannot be written (or already exists) means no deny (#282).
 */
async function askLadderOnce(
  root: string,
  session: string | undefined,
  toolName: "Write" | "Edit",
  input: Record<string, unknown>,
  abs: string,
): Promise<boolean> {
  if (!session || !safeSegment(session)) return false;
  if (carriesRung(await effectiveContent(toolName, input, abs))) return false;
  const marker = ladderMarkerPath(root, session);
  try {
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide what to do with a PreToolUse Write/Edit. Reads the filesystem only via
 * resolveDocsRoot and the ladder marker; returns a {@link MemoryDecision}.
 */
export async function memoryPreToolUse(
  payload: Record<string, unknown>,
  opts: { cwd?: string } = {},
): Promise<MemoryDecision> {
  const toolName = str(payload.tool_name);
  if (toolName !== "Write" && toolName !== "Edit") return PASS;
  const input = obj(payload.tool_input);
  const filePath = input && str(input.file_path);
  if (!input || !filePath) return PASS;

  const cwd = opts.cwd ?? str(payload.cwd) ?? process.cwd();
  const resolved = await resolveDocsRoot(cwd).catch(() => null);
  if (!resolved) return PASS;

  const target = memoryTarget(resolved.root, filePath, cwd);
  if (target === null) return PASS; // subdir / outside the root / non-.md → never touched

  // A generated index at the docs root → mage owns it (isGeneratedArtifact covers
  // MEMORY.md/INDEX.md/_index.*.md + IDENTITY/AGENTS/CLAUDE/Dashboard at the root).
  if (target.flat && isGeneratedArtifact(target.rel)) return { kind: "deny", reason: DENY_REASON };

  // Gate-0's irreplaceable job: scrub the raw bytes before they reach disk. No YAML parse,
  // so malformed frontmatter can never skip it.
  const field = toolName === "Write" ? "content" : "new_string";
  const raw = str(input[field]);
  let scrubbed: { text: string; masked: number } | null = null;
  if (raw !== undefined) {
    try {
      const { text, findings } = redact(raw);
      scrubbed = { text, masked: findings.length };
    } catch {
      return { kind: "deny", reason: SCAN_FAILED_REASON };
    }
  }

  const session = str(payload.session_id);
  const ask = await askLadderOnce(resolved.root, session, toolName, input, target.abs).catch(
    () => false, // the ladder fails open; the scrub above does not
  );
  if (ask) return { kind: "deny", reason: LADDER_TEXT };

  if (scrubbed === null) return PASS;
  if (!target.flat && scrubbed.masked === 0) return PASS; // clean notes/ write: leave the host's prompt alone
  return {
    kind: "rewrite",
    updatedInput: { ...input, [field]: scrubbed.text },
    reason: rewriteReason(scrubbed.masked),
    slug: target.rel.replace(/\.md$/, ""),
    masked: scrubbed.masked,
  };
}

// ─── stdout emit (Claude Code hook JSON contracts) ─────────────────────────────

/** Emit a PreToolUse decision. PASS emits nothing (preserves the host's permission flow). */
export function emitPreToolUse(d: MemoryDecision): void {
  if (d.kind === "pass") return;
  const hookSpecificOutput: Record<string, unknown> = {
    hookEventName: "PreToolUse",
    permissionDecision: d.kind === "deny" ? "deny" : "allow",
    permissionDecisionReason: d.reason,
  };
  if (d.kind === "rewrite") hookSpecificOutput.updatedInput = d.updatedInput;
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
}

// ─── CLI registration (kept next to the handler) ───────────────────────────────

/**
 * Build the hidden `memory-hook` plumbing command. Reads the hook JSON on stdin and emits
 * the deny/rewrite JSON for a PreToolUse Write/Edit. Wrapped fail-open: any error →
 * silent exit 0, so a capture gate never breaks the agent's tool calls.
 */
export function buildMemoryHookCommand(): Command {
  return new Command("memory-hook")
    .description(
      "Hook-fired Claude Code Gate-0 capture gate: on PreToolUse, scrub a native-memory write, deny a write to a generated index, and ask the ladder once per session (ADR-0032/0035/0060; never blocks the host on error)",
    )
    .option(
      "--cwd <dir>",
      "working directory used to locate the knowledge base (overrides the hook JSON cwd; defaults to it, then process.cwd())",
    )
    .action(async (opts: { cwd?: string }) => {
      try {
        const raw = await readStdinSafe();
        const payload = raw.trim().length === 0 ? null : parseHookPayload(raw);
        if (!payload) return;
        if (str(payload.hook_event_name) === "PreToolUse") {
          emitPreToolUse(await memoryPreToolUse(payload, { cwd: opts.cwd }));
        }
      } catch {
        // Fail open: a capture gate must never break the agent's tool calls.
      }
    });
}
