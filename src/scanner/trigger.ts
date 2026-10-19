import { posix } from "node:path";
import picomatch from "picomatch";

/** The tool a matcher applies to; `Edit(...)` covers Write, Edit, MultiEdit and NotebookEdit. */
export type MatcherTool = "Bash" | "Edit";

export interface Matcher {
  tool: MatcherTool;
  pattern: string;
  raw: string;
}

export interface Trigger {
  when: string;
  matchers: Matcher[];
  /** `match` entries that are not `Bash(...)`, `Edit(...)` or `Write(...)`; ignored. */
  invalid: string[];
}

export interface ToolTarget {
  kind: MatcherTool;
  /** Bash: the command. Edit: the repo-relative POSIX path, or the absolute POSIX path outside it. */
  text: string;
}

const MATCHER_RE = /^(Bash|Edit|Write)\((.+)\)$/;

function parseMatcher(raw: string): Matcher | null {
  const m = MATCHER_RE.exec(raw.trim());
  const pattern = m?.[2]?.trim();
  if (!m || !pattern) return null;
  return { tool: m[1] === "Bash" ? "Bash" : "Edit", pattern, raw };
}

/**
 * Parse a note's `trigger` field (R1, #282): a prose string, or `{when, match}`. Null when
 * the field is absent or has no non-empty `when`. Globs only, never regex, so a per-call
 * match cannot be made to backtrack.
 */
export function parseTrigger(value: unknown): Trigger | null {
  if (typeof value === "string") {
    const when = value.trim();
    return when ? { when, matchers: [], invalid: [] } : null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const when = typeof rec.when === "string" ? rec.when.trim() : "";
  if (!when) return null;

  const entries: unknown[] =
    rec.match === undefined || rec.match === null
      ? []
      : Array.isArray(rec.match)
        ? rec.match
        : [rec.match];
  const matchers: Matcher[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const raw = typeof entry === "string" ? entry : String(entry);
    const parsed = typeof entry === "string" ? parseMatcher(entry) : null;
    if (parsed) matchers.push(parsed);
    else invalid.push(raw);
  }
  return { when, matchers, invalid };
}

const WIN = process.platform === "win32";

function isAbsolutePosix(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}

/** Resolve `filePath` against `cwd`; repo-relative POSIX when inside `repo`, else absolute POSIX. */
function repoRelative(filePath: string, cwd: string, repo: string): string {
  const slash = (p: string): string => p.replace(/\\/g, "/");
  const file = slash(filePath);
  const abs = posix.normalize(isAbsolutePosix(file) ? file : posix.join(slash(cwd), file));
  const base = posix.normalize(slash(repo)).replace(/\/+$/, "");
  const fold = (p: string): string => (WIN ? p.toLowerCase() : p);
  if (fold(abs) === fold(base)) return ".";
  if (fold(abs).startsWith(`${fold(base)}/`)) return abs.slice(base.length + 1);
  return abs;
}

const FILE_TOOLS: Readonly<Record<string, string>> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** What a matcher is tested against for one tool call, or null for a tool recall does not cover. */
export function toolTarget(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: { cwd: string; repo: string },
): ToolTarget | null {
  if (toolName === "Bash") {
    const command = toolInput.command;
    return typeof command === "string" && command.trim() ? { kind: "Bash", text: command } : null;
  }
  const field = FILE_TOOLS[toolName];
  if (!field) return null;
  const path = toolInput[field];
  if (typeof path !== "string" || !path) return null;
  return { kind: "Edit", text: repoRelative(path, ctx.cwd, ctx.repo) };
}

const BASH_SEPARATORS = /&&|\|\||[;|\n]/;

/** True when `matcher` hits `target`. A Bash matcher tests the whole command and each segment. */
export function matchesTarget(matcher: Matcher, target: ToolTarget): boolean {
  if (matcher.tool !== target.kind) return false;
  if (target.kind === "Bash") {
    const test = picomatch(matcher.pattern, { bash: true, dot: true });
    const segments = target.text
      .split(BASH_SEPARATORS)
      .map((s) => s.trim())
      .filter(Boolean);
    return [target.text.trim(), ...segments].some((candidate) => test(candidate));
  }
  // picomatch's `basename` option disables path matching for patterns with a slash,
  // so it is set per pattern, as gitignore does (#282).
  const test = picomatch(matcher.pattern, {
    dot: true,
    basename: !matcher.pattern.includes("/"),
    nocase: WIN,
  });
  return test(target.text);
}

/** The first of the trigger's matchers that hits `target`, if any. */
export function firstHit(trigger: Trigger, target: ToolTarget): Matcher | undefined {
  return trigger.matchers.find((m) => matchesTarget(m, target));
}
