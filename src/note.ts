import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
 * Frontmatter is a leading `---` fence, its YAML body, then a closing `---` on
 * its own line; everything after is the note body. We split it by hand and parse
 * only the YAML — pinned to **1.1** to match the prior js-yaml engine, so quoted
 * dates stay quoted and unquoted ones keep their timestamp semantics (no churn).
 * Unlike the previous gray-matter engine, the `yaml` parser has NO executable
 * engines: an untrusted note can never run code on open.
 */
const YAML_VERSION = "1.1" as const;
const FENCE_OPEN = /^---[ \t]*\r?\n/;
const FENCE_CLOSE = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/;

/** Parse note text into frontmatter + body. Tolerates a missing frontmatter block. */
export function parseNote(raw: string): Note {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip a BOM
  const open = FENCE_OPEN.exec(text);
  if (!open) return { frontmatter: {}, body: text };
  const rest = text.slice(open[0].length);
  const close = FENCE_CLOSE.exec(rest);
  if (!close) return { frontmatter: {}, body: text }; // unterminated fence → no frontmatter
  const block = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  // `logLevel: "error"` keeps real parse errors throwing (callers skip the note)
  // while silencing the library's console warnings — mage owns its own output.
  const data = block.trim() === "" ? {} : parseYaml(block, { version: YAML_VERSION, logLevel: "error" });
  return {
    frontmatter: (data ?? {}) as NoteFrontmatter,
    body,
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
  // `stringifyYaml` ends with a newline; `lineWidth: 0` disables wrapping so long
  // values (descriptions, URLs) stay on one line. version 1.1 keeps date strings quoted.
  const yaml = stringifyYaml(clean, { version: YAML_VERSION, lineWidth: 0 });
  return `---\n${yaml}---\n${body}`;
}

// ─── derivations (used by `mage index`) ────────────────────────────────────

/** First-segment of the first tag: `billing/payments` -> `billing`. Null if untagged. */
export function noteWing(fm: NoteFrontmatter): string | null {
  const first = normalizeTags(fm.tags)[0];
  return first ? first.split("/")[0] ?? null : null;
}

/**
 * Every tag's `{wing, room}`, de-duped by wing preserving order (first wins).
 * `noteWings(fm)[0]` is the *primary* wing — equals `noteWing(fm)` for tagged
 * notes. Empty for untagged notes. This is the primitive multi-home rides on
 * (ADR-0012 §5): a note is indexed under every wing it is tagged with.
 */
export function noteWings(fm: NoteFrontmatter): Array<{ wing: string; room: string }> {
  const out: Array<{ wing: string; room: string }> = [];
  const seen = new Set<string>();
  for (const tag of normalizeTags(fm.tags)) {
    const parts = tag.split("/");
    const wing = parts[0];
    if (!wing || seen.has(wing)) continue;
    seen.add(wing);
    out.push({ wing, room: parts.slice(1).join("/") });
  }
  return out;
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
