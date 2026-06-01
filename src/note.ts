import matter from "gray-matter";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export type NoteStatus = "active" | "stale-suspect" | "superseded" | "archived";

export interface Provenance {
  repo?: string;
  commit?: string;
  /** The work-unit slug this note was distilled from. */
  work?: string;
}

/**
 * Note frontmatter. EVERYTHING is optional — a note is valid as plain markdown
 * (graceful degradation, Q5). `type` plus one `#wing/room` tag are recommended.
 * Unknown keys are preserved across read/write.
 */
export interface NoteFrontmatter {
  /**
   * Suggested, open vocabulary (never enforced):
   * interface | tooling | topology | relationship | playbook | gotcha |
   * pointer | trail | decision | spec | plan | tasks | principle | note
   */
  type?: string;
  /** `#wing/room` scoping; stored without the leading '#'. */
  tags?: string[];
  created?: string;
  updated?: string;
  /** For staleness / re-verification. */
  provenance?: Provenance;
  /** POINTERS to canonical sources (url | ticket | file:line) — never copies (ADR-0004). */
  sources?: string[];
  status?: NoteStatus;
  /** Cheap staleness signal. */
  last_reviewed?: string;
  /** Optional; the index falls back to title + headers + tags. */
  keywords?: string[];
  // relationship-type extras (open vocab):
  breaks_on?: string | string[];
  contract_anchors?: string | string[];
  owners?: string | string[];
  [key: string]: unknown;
}

export interface Note {
  frontmatter: NoteFrontmatter;
  body: string;
}

/** Read + parse a note file. */
export async function readNote(path: string): Promise<Note> {
  return parseNote(await readFile(path, "utf8"));
}

/**
 * gray-matter ships executable frontmatter engines (JavaScript / CoffeeScript)
 * that RUN CODE when a note opens with e.g. ` ---js `. mage only ever uses YAML,
 * so we hard-disable those engines — a crafted/untrusted note can't execute code.
 */
const blockEngine = (_input: string): never => {
  throw new Error("mage: executable frontmatter engines are disabled (YAML only)");
};
const SAFE_MATTER_OPTIONS = {
  engines: { javascript: blockEngine, js: blockEngine, coffee: blockEngine },
};

/** Parse note text into frontmatter + body. Tolerates a missing frontmatter block. */
export function parseNote(raw: string): Note {
  const parsed = matter(raw, SAFE_MATTER_OPTIONS);
  return {
    frontmatter: (parsed.data ?? {}) as NoteFrontmatter,
    body: parsed.content ?? "",
  };
}

/** Write a note (frontmatter + body) to disk. */
export async function writeNote(path: string, fm: NoteFrontmatter, body: string): Promise<void> {
  await writeFile(path, stringifyNote(fm, body));
}

/** Serialize frontmatter + body. Omits the frontmatter block entirely when empty. */
export function stringifyNote(fm: NoteFrontmatter, body: string): string {
  const clean = stripUndefined(fm);
  if (Object.keys(clean).length === 0) {
    return body.endsWith("\n") ? body : `${body}\n`;
  }
  return matter.stringify(body, clean);
}

// ─── derivations (used by `mage index`) ────────────────────────────────────

/** First-segment of the first tag: `billing/payments` -> `billing`. Null if untagged. */
export function noteWing(fm: NoteFrontmatter): string | null {
  const first = normalizeTags(fm.tags)[0];
  return first ? first.split("/")[0] ?? null : null;
}

/** Second-segment of the first tag: `billing/payments` -> `payments`. Null if none. */
export function noteRoom(fm: NoteFrontmatter): string | null {
  const first = normalizeTags(fm.tags)[0];
  if (!first) return null;
  const parts = first.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : null;
}

/** Bare `wing/room` tags (strip leading '#', trim, drop empties). */
export function normalizeTags(tags: NoteFrontmatter["tags"]): string[] {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : [tags];
  return arr
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^#/, "").trim())
    .filter((t) => t.length > 0);
}

/** The note title: first markdown H1, else the filename (sans extension). */
export function noteTitle(body: string, filePath: string): string {
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim();
  return basename(filePath).replace(/\.md$/i, "");
}

/** All `##`..`######` header texts, in document order. */
export function noteHeaders(body: string): string[] {
  const out: string[] = [];
  const re = /^#{2,6}\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "by", "at",
  "from", "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
  "those", "it", "its", "as", "how", "what", "when", "where", "why", "which", "who",
  "whom", "into", "via", "not", "no", "do", "does", "did", "can", "could", "should",
  "would", "will", "then", "than", "so", "if", "we", "you", "they", "our", "your",
  "their", "using", "use", "used", "about",
]);

/**
 * Deterministic keyword derivation for an index line. Uses frontmatter
 * `keywords` verbatim when present; otherwise derives from title + headers +
 * tag rooms. Deterministic (insertion-ordered, no randomness) so the generated
 * index is golden-file stable.
 */
export function deriveKeywords(
  fm: NoteFrontmatter,
  body: string,
  filePath: string,
  max = 12,
): string[] {
  if (fm.keywords && fm.keywords.length > 0) {
    return fm.keywords.filter((k): k is string => typeof k === "string").slice(0, max);
  }
  const text = [
    noteTitle(body, filePath),
    ...noteHeaders(body),
    ...normalizeTags(fm.tags).map((t) => t.replace(/\//g, " ")),
  ].join(" ");
  const seen = new Set<string>();
  const out: string[] = [];
  // Split on non-(letter|number) across all scripts so non-Latin titles still
  // yield keywords; the ASCII stopword set still applies. Deterministic.
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.trim();
    if (w.length < 3 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

// ─── internal ──────────────────────────────────────────────────────────────

function stripUndefined(fm: NoteFrontmatter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
