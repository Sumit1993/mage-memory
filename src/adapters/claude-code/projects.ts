import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code stores per-project auto-memory under `~/.claude/projects/<slug>/`,
 * keyed by the LAUNCH CWD. This module discovers those dirs and — critically —
 * recovers each one's TRUE origin cwd from its session transcripts, because the
 * `<slug>` is a lossy path encoding (real dirs containing `-` collide, and the
 * slug is NOT a reversible transform of the cwd: e.g. the slug
 * `-home-sumit-prismalens-org` was observed resolving to the cwd
 * `…/prismalens-org/prismalens-agents`). `mage adopt` routes by the recovered
 * cwd, never the slug (ADR-0034 §4).
 */

/** A discovered Claude Code per-cwd memory directory. */
export interface DiscoveredMemoryDir {
  /** The `<slug>` dir name under `projects/` — lossy; never trust it for routing. */
  slug: string;
  /** Absolute path to the `<slug>/memory/` dir. */
  memoryDir: string;
  /** The TRUE origin cwd recovered from a session transcript, or null if none yielded one. */
  cwd: string | null;
  /** Absolute paths of the memory `.md` files (generated index twins excluded), sorted. */
  files: string[];
}

/** Index twins CC/mage write INTO a memory dir — generated, never adoptable captures. */
const GENERATED_MD = new Set(["MEMORY.md", "INDEX.md"]);

/** First bytes of a transcript scanned for the origin cwd — bounds cost on huge (100MB+) logs. */
const TRANSCRIPT_PREFIX_BYTES = 64 * 1024;

/**
 * The Claude Code config home. Honors `CLAUDE_CONFIG_DIR` (CC's own override),
 * else `~/.claude`. Injectable env keeps it testable.
 */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_CONFIG_DIR;
  return override && override.length > 0 ? override : join(homedir(), ".claude");
}

/** Read at most `bytes` from the head of a file; returns "" if unreadable. */
async function readPrefix(path: string, bytes: number): Promise<string> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(path, "r");
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** The first `cwd` string found among the COMPLETE JSON lines in a transcript's prefix. */
function firstCwdInPrefix(prefix: string): string | null {
  const lines = prefix.split("\n");
  // Drop a trailing partial line (the prefix may cut mid-record).
  const complete = prefix.endsWith("\n") ? lines : lines.slice(0, -1);
  for (const line of complete) {
    if (!line.includes('"cwd"')) continue;
    try {
      const obj = JSON.parse(line) as { cwd?: unknown };
      if (typeof obj.cwd === "string" && obj.cwd.length > 0) return obj.cwd;
    } catch {
      // Partial/invalid record — keep scanning.
    }
  }
  return null;
}

/**
 * Recover the true origin cwd for a CC project dir by reading its session
 * transcripts (the `<slug>/*.jsonl` siblings of `memory/`). All transcripts under
 * one slug share the same cwd, so any that yields one wins; newest-first is just
 * for freshness/determinism. Only the head of each file is read. Null if none has
 * a recoverable `cwd`.
 */
export async function recoverCwd(projectDir: string): Promise<string | null> {
  let transcripts: string[];
  try {
    transcripts = (await readdir(projectDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => join(projectDir, e.name));
  } catch {
    return null;
  }
  const withMtime = await Promise.all(
    transcripts.map(async (p) => ({ p, m: await mtimeMs(p) })),
  );
  withMtime.sort((a, b) => b.m - a.m);
  for (const { p } of withMtime) {
    const cwd = firstCwdInPrefix(await readPrefix(p, TRANSCRIPT_PREFIX_BYTES));
    if (cwd) return cwd;
  }
  return null;
}

async function mtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Adoptable `.md` captures in a memory dir (generated index twins excluded), sorted. */
async function memoryFiles(memoryDir: string): Promise<string[]> {
  try {
    return (await readdir(memoryDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".md") && !GENERATED_MD.has(e.name))
      .map((e) => join(memoryDir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Enumerate every `~/.claude/projects/<slug>/memory/` dir that holds at least one
 * adoptable capture, recovering each one's true origin cwd. Sorted by slug for
 * determinism. Dirs with no memory files are skipped. A missing `projects/` dir
 * (CC never ran) yields `[]`.
 */
export async function discoverMemoryDirs(
  opts: { home?: string } = {},
): Promise<DiscoveredMemoryDir[]> {
  const projects = join(opts.home ?? claudeHome(), "projects");
  let slugs: string[];
  try {
    slugs = (await readdir(projects, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const out: DiscoveredMemoryDir[] = [];
  for (const slug of slugs) {
    const projectDir = join(projects, slug);
    const files = await memoryFiles(join(projectDir, "memory"));
    if (files.length === 0) continue;
    out.push({ slug, memoryDir: join(projectDir, "memory"), cwd: await recoverCwd(projectDir), files });
  }
  return out;
}
