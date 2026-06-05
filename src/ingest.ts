import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import { DIST_DIR, GIT_DIR, NODE_MODULES_DIR, OBSIDIAN_DIR } from "./paths.js";
import { type NoteFrontmatter, noteTitle, parseNote } from "./note.js";

/**
 * What kind of ingestable source a file is, in classification priority order.
 * This is the DETERMINISTIC manifest the `mage:learn --from <dir>` skill consumes
 * to decide what to distill (ADR-0013); the tool itself never writes notes/skills.
 */
export type IngestKind =
  | "skill"
  | "note"
  | "prose"
  | "transcript"
  | "feeder-ecc"
  | "feeder-native";

/** One classified, ingestable source file. */
export interface IngestSource {
  /** posix path relative to the scanned dir */
  relPath: string;
  kind: IngestKind;
  /** Best-effort human title (frontmatter name/id, or H1, or first line). */
  title?: string;
  /** Short description — only populated for skills (first line of `description`). */
  summary?: string;
}

/** Directories the ingest walk never descends into (matches the scanner boundary). */
const SKIP_DIRS = new Set<string>([GIT_DIR, NODE_MODULES_DIR, DIST_DIR, OBSIDIAN_DIR]);

/** Prose extensions OTHER than `.md` (which has its own dedicated branch). */
const PROSE_EXT = new Set<string>([".markdown", ".txt"]);

/** `metadata.type` values that mark a native-memory feeder file. */
const NATIVE_TYPES = new Set<string>(["user", "feedback", "project", "reference"]);

/** A path segment that marks an ECC instinct tree. */
const INSTINCTS_SEGMENT = "instincts";

/**
 * Recursively walk `dir` and return a deterministic, read-only manifest of
 * ingestable sources, one per ingestable FILE, sorted by relPath. Binary/code
 * files (and anything under {@link SKIP_DIRS}) are omitted. Classification is by
 * basename + extension + frontmatter, in the priority documented inline; an
 * unparseable file degrades to prose/transcript (or is skipped) rather than
 * throwing, so a single bad file never aborts the scan. This is the enumerator
 * behind `mage:learn --from` (ADR-0013) — it NEVER writes.
 */
export async function scanIngestSources(dir: string): Promise<IngestSource[]> {
  const out: IngestSource[] = [];
  await walk(dir, dir, out);
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;
}

async function walk(cur: string, root: string, out: IngestSource[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(cur, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    // Never follow symlinks: a link to an ancestor or outside the root could
    // recurse out of bounds (ingest takes an arbitrary user-supplied dir).
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(cur, e.name), root, out);
      continue;
    }
    if (!e.isFile()) continue;
    const abs = join(cur, e.name);
    const relPath = toPosix(relative(root, abs));
    const source = await classify(abs, relPath, e.name);
    if (source) out.push(source);
  }
}

/**
 * Classify a single file. Returns null when the file is not ingestable (binary,
 * image, code, or a YAML/markdown file that matches no rule). Cheap by design:
 * only files that could plausibly carry frontmatter are read.
 */
async function classify(
  abs: string,
  relPath: string,
  name: string,
): Promise<IngestSource | null> {
  const ext = extname(name).toLowerCase();

  // 1. SKILL.md — an agent skill.
  if (name === "SKILL.md") {
    const fm = await readFrontmatter(abs);
    return {
      relPath,
      kind: "skill",
      title: stringField(fm.name),
      summary: firstLine(stringField(fm.description)),
    };
  }

  // 2. ECC feeder — instinct YAML (by path segment or trigger+confidence shape).
  if (ext === ".yaml" || ext === ".yml") {
    const fm = await readYamlDoc(abs);
    const inInstincts = hasSegment(relPath, INSTINCTS_SEGMENT);
    const looksEcc =
      fm !== null && fm.trigger !== undefined && fm.confidence !== undefined;
    if (inInstincts || looksEcc) {
      return {
        relPath,
        kind: "feeder-ecc",
        title: stringField(fm?.id) ?? stringField(fm?.name),
      };
    }
    // A YAML that matches no rule is not ingestable.
    return null;
  }

  // 3. Native-memory feeder — MEMORY.md (whole-file marker).
  if (name === "MEMORY.md") {
    const { fm, body } = await readMd(abs);
    return { relPath, kind: "feeder-native", title: nativeTitle(fm, body, abs) };
  }
  // 4. Markdown — native-memory (metadata.type), else mage note (type/tags), else prose.
  if (ext === ".md") {
    const { fm, body } = await readMd(abs);
    if (isNativeType(fm)) {
      return { relPath, kind: "feeder-native", title: nativeTitle(fm, body, abs) };
    }
    if (fm.type !== undefined || fm.tags !== undefined) {
      return { relPath, kind: "note", title: noteTitle(body, abs) };
    }
    return { relPath, kind: "prose", title: proseTitle(body, abs) };
  }

  // 5. Transcript — a JSON-lines capture.
  if (ext === ".jsonl") {
    return { relPath, kind: "transcript", title: basename(relPath) };
  }

  // 6. Other prose extensions (.markdown/.txt).
  if (PROSE_EXT.has(ext)) {
    const body = await readText(abs);
    return { relPath, kind: "prose", title: proseTitle(body, abs) };
  }

  // Anything else (binary, images, code) is skipped.
  return null;
}

// ─── readers (cheap, fault-tolerant) ─────────────────────────────────────────

/** Read a markdown file's frontmatter + body; degrades to empty fm on parse error. */
async function readMd(abs: string): Promise<{ fm: NoteFrontmatter; body: string }> {
  const raw = await readText(abs);
  try {
    const { frontmatter, body } = parseNote(raw);
    return { fm: frontmatter, body };
  } catch {
    // Unparseable frontmatter (e.g. a disabled executable engine) → treat as prose.
    return { fm: {}, body: raw };
  }
}

/** Read a SKILL.md's frontmatter only; empty on parse error. */
async function readFrontmatter(abs: string): Promise<NoteFrontmatter> {
  return (await readMd(abs)).fm;
}

/**
 * Parse a BARE YAML document (a `.yaml`/`.yml` whose whole body is YAML, not a
 * fenced frontmatter block) by wrapping it so gray-matter's YAML engine reads it.
 * Returns null when the file is empty or not valid YAML — callers degrade rather
 * than throw.
 */
async function readYamlDoc(abs: string): Promise<NoteFrontmatter | null> {
  const raw = await readText(abs);
  if (raw.trim().length === 0) return null;
  try {
    const { frontmatter } = parseNote(`---\n${raw}\n---\n`);
    return Object.keys(frontmatter).length > 0 ? frontmatter : null;
  } catch {
    return null;
  }
}

function readText(abs: string): Promise<string> {
  return readFile(abs, "utf8");
}

// ─── title derivation ────────────────────────────────────────────────────────

/** Native-feeder title: frontmatter `name`, else the markdown H1 / filename. */
function nativeTitle(fm: NoteFrontmatter, body: string, abs: string): string {
  return stringField(fm.name) ?? noteTitle(body, abs);
}

/** Prose title: the markdown H1, else the first non-empty line, else filename. */
function proseTitle(body: string, abs: string): string {
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim();
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return basename(abs).replace(/\.[^.]+$/, "");
}

// ─── frontmatter helpers ─────────────────────────────────────────────────────

/** True iff `metadata.type` is one of the native-memory feeder types. */
function isNativeType(fm: NoteFrontmatter): boolean {
  const meta = fm.metadata;
  if (typeof meta !== "object" || meta === null) return false;
  const type = (meta as Record<string, unknown>).type;
  return typeof type === "string" && NATIVE_TYPES.has(type);
}

/** Narrow an unknown frontmatter field to a trimmed non-empty string, else undefined. */
function stringField(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** The first line of a multi-line string (trimmed). */
function firstLine(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const first = v.split(/\r?\n/)[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

/** True iff `relPath` contains `seg` as a whole posix path segment. */
function hasSegment(relPath: string, seg: string): boolean {
  return relPath.split("/").includes(seg);
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
