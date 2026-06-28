// Claude Code capture-inbox ingest (ADR-0032 §"Curation posture", ADR-0033).
//
// Gate-0 (memory-hook.ts) lands a scrubbed CC native-memory write FLAT at the
// docs-root top as an "inbox" file. Those files surface in recall immediately
// (scanNotes walks the whole root) but never reach `mage groom`, which only reads
// `.mage/staging/`. This module is the missing lift: at `mage groom` time it MOVES
// each inbox capture into staging as a clean mage draft (CC frontmatter stripped,
// the already-Gate-0-scrubbed-and-shaped body kept), so the existing
// surface/accept/reject flow promotes it to `notes/` with a provenance stamp
// (ADR-0031). The ADR-0032 §4 covered-arm drops a capture an existing note already
// covers; everything else is staged for human judgment.
//
// Detector: a flat root `.md` whose frontmatter carries CC's `metadata.node_type:
// memory` discriminator — set on every native-memory file, never on a hand-authored
// mage note. Two on-disk shapes are handled robustly:
//   - post-renormalization (the live 2026-06-27 spike shape): `name: ""`, the mage
//     `type`/`created` moved under `metadata`, body already H1'd + folded + scrubbed;
//   - raw native (e.g. if Gate-0 failed open): `name` kebab, a top-level
//     `description`, a raw `[[wikilink]]` body.
// So the title falls back from the body H1, the description folds only when absent
// from the body, wikilinks are rewritten idempotently, and the body is re-scrubbed
// (redact is idempotent) as a backstop.

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type NoteFrontmatter, parseNote, writeNote } from "../../note.js";
import { stagingPath } from "../../paths.js";
import { redact } from "../../redact.js";
import { isGeneratedArtifact, scanNotes } from "../../scan.js";
import {
  composeDraft,
  draftSig,
  lessonCoveringNote,
  readStagedDrafts,
  slugify,
  uniqueSlug,
  writeDraft,
} from "../../grooming/staging.js";
import { deKebab, mapType, rewriteWikilinks } from "./schema-map.js";

/**
 * Fail-soft diagnostics go to STDERR, never stdout. ingestCaptureInbox runs at the
 * top of EVERY `mage groom` — including `--json`, whose stdout must stay a single
 * JSON line — so a `logger.warn` (which writes to stdout) would corrupt that
 * contract. stderr is visible in a terminal and ignored by JSON consumers.
 */
function warnStderr(msg: string): void {
  process.stderr.write(`⚠ ${msg}\n`);
}

/** The `cc-session:<uuid>` source pointers a draft/capture carries (for re-ingest dedup). */
function sourceSessions(fm: NoteFrontmatter): string[] {
  const sources = (fm as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  return sources.filter((s): s is string => typeof s === "string" && s.startsWith("cc-session:"));
}

/** rm a file, returning whether it is now gone (force suppresses ENOENT). */
async function safeRm(path: string): Promise<boolean> {
  try {
    await rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** The recoverable graveyard for covered captures — under `.mage/` (git-ignored, unindexed). */
function coveredDir(stagingDir: string): string {
  return join(stagingDir, ".covered");
}

/** CC's frontmatter discriminator — present on every native-memory file, never on a mage note. */
const CC_MEMORY_NODE_TYPE = "memory";

/** A CC capture inbox file's frontmatter (either on-disk shape — see file header). */
interface InboxFrontmatter {
  /** kebab slug (raw native) or "" (post-renormalization, blanked by CC). */
  name?: string;
  /** one-line summary (raw native only); folds into the body when not already there. */
  description?: string;
  /** top-level created (raw native); the post-renorm date lives under metadata. */
  created?: string;
  metadata?: {
    /** the "memory" discriminator. */
    node_type?: string;
    /** the mage type (post-renorm) or a raw CC type — mapType handles both. */
    type?: string;
    created?: string;
    /** the CC session UUID → a `cc-session:` source pointer. */
    originSessionId?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * True iff this frontmatter is a Claude Code capture (carries `metadata.node_type:
 * memory`). A hand-authored mage note at the docs root never matches, so it is left
 * untouched by the ingest.
 */
export function isCaptureInboxNote(fm: NoteFrontmatter): boolean {
  const meta = (fm as InboxFrontmatter).metadata;
  return !!meta && typeof meta === "object" && meta.node_type === CC_MEMORY_NODE_TYPE;
}

/** First `YYYY-MM-DD` of a string- or Date-ish value, else undefined. */
function isoDate(v: unknown): string | undefined {
  // YAML 1.1 parses an UNQUOTED `created: 2026-06-01` into a JS Date, not a string —
  // accept both so an unquoted-date capture keeps its date (parity with flatten.ts).
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v !== "string") return undefined;
  const m = v.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : undefined;
}

/**
 * Map a parsed CC inbox capture to a clean mage draft (frontmatter + body). PURE —
 * no fs, no redact. Strips CC's `name`/`metadata`/`node_type`; routes the body
 * through the same `composeDraft` builder as `mage stage` so an ingested capture and
 * a CLI draft are shaped identically. The wing is intentionally NOT guessed here —
 * the ingested draft is cross-cutting and `mage groom` owns the wing at promotion
 * (ADR-0032 §"groom owns the wing + final schema").
 */
export function mapInboxNote(
  fm: NoteFrontmatter,
  body: string,
  slug: string,
): { frontmatter: NoteFrontmatter; body: string } {
  const f = fm as InboxFrontmatter;
  const meta = f.metadata ?? {};

  // Title: the body H1 wins (post-renorm `name` is blank); else a de-kebab'd `name`
  // (raw native, where CC kept it); else the slug. composeDraft preserves an existing
  // H1 and only prepends `# <title>` when the body has none.
  const h1 = body?.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const name = (f.name ?? "").trim();
  const title = h1 || deKebab(name) || deKebab(slug);

  // Rewrite wikilinks idempotently, then fold a top-level `description` into the body
  // lead ONLY if it isn't already there (Gate-0 folded it; a raw native file did not).
  // Containment guard so a CC-truncated frontmatter description (a prefix of the
  // folded text) still matches and is not re-folded.
  const withLinks = rewriteWikilinks(body ?? "");
  const description = (f.description ?? "").trim();
  const foldedBody = description && !withLinks.includes(description)
    ? `${description}\n\n${withLinks}`
    : withLinks;

  const draft = composeDraft({
    title,
    type: mapType(typeof meta.type === "string" ? meta.type : undefined),
    body: foldedBody,
    created: isoDate(meta.created) ?? isoDate(f.created),
  });

  const sessionId = typeof meta.originSessionId === "string" ? meta.originSessionId : undefined;
  const frontmatter: NoteFrontmatter = {
    ...draft.frontmatter,
    ...(sessionId ? { sources: [`cc-session:${sessionId}`] } : {}),
  };
  return { frontmatter, body: draft.body };
}

/** One capture lifted from the inbox into `.mage/staging/`. */
export interface IngestedCapture {
  /** staging slug (post de-collision). */
  slug: string;
  /** the root-relative inbox filename it came from. */
  from: string;
  /** secrets/PII scrubbed at the ingest backstop (Gate-0 already scrubbed Gate-0 files). */
  masked: number;
}

/** A capture dropped at the door because an existing committed note already covers it. */
export interface CoveredCapture {
  from: string;
  /** notes-relative path of the covering note. */
  by: string;
}

/** The result of an inbox ingest pass. */
export interface InboxIngestResult {
  ingested: IngestedCapture[];
  covered: CoveredCapture[];
}

/**
 * Lift CC capture-inbox files from the docs-root top into `.mage/staging/` as clean
 * mage drafts, MOVING each (the root file is removed once the capture is safely
 * elsewhere). A capture an existing committed note already covers (ADR-0032 §4
 * covered-arm) is NOT staged into the active batch, but it is never destroyed — it
 * is archived to `.mage/staging/.covered/` (git-ignored, recoverable) rather than
 * deleted, because the root file is the capture's only durable copy and the cover
 * heuristic is deliberately loose. Fail-soft per file: a parse/map/redact/fs error
 * on one inbox file is logged (to stderr) and skipped, never aborting the batch
 * (mirrors the scanNotes/observe fail-open contract). Returns what was ingested +
 * archived.
 */
export async function ingestCaptureInbox(root: string): Promise<InboxIngestResult> {
  const result: InboxIngestResult = { ingested: [], covered: [] };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return result; // no readable root → nothing to ingest
  }
  const inboxNames = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !isGeneratedArtifact(e.name))
    .map((e) => e.name)
    .sort();
  if (inboxNames.length === 0) return result;

  // Resolve dedup context once. The covered-arm compares against COMMITTED notes
  // only — exclude the inbox batch itself, since scanNotes walks the whole root and
  // a capture would otherwise "cover" its own root representation and be dropped.
  const inboxSet = new Set(inboxNames);
  const stagingDir = stagingPath(root);
  const [allNotes, staged] = await Promise.all([scanNotes(root), readStagedDrafts(stagingDir)]);
  const committed = allNotes.filter((n) => !inboxSet.has(n.relPath));
  const taken = new Set(staged.map((d) => d.slug));
  // Idempotency: a prior ingest may have staged a capture whose root file lingered
  // (e.g. a post-write rm failed); re-seeing it must NOT re-stage a `-2` duplicate.
  // Key on the capture's IDENTITY — `<cc-session>::<slug>` — NOT the session alone:
  // ONE Claude session legitimately writes MANY distinct memories, so a session-only
  // key drops every sibling capture after the first (silent data loss). Built from the
  // PRE-EXISTING staged drafts only (the lingering-file case is cross-run); within a
  // run, `uniqueSlug`/`taken` already separates two distinct captures.
  const identity = (session: string, slug: string) => `${session}::${slug}`;
  const stagedIdentity = new Set(
    staged.flatMap((d) => sourceSessions(d.frontmatter).map((s) => identity(s, d.slug))),
  );

  for (const name of inboxNames) {
    const path = join(root, name);
    try {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        continue; // unreadable now (vanished/locked) — leave it for next pass
      }

      // The whole tail (parse → map → redact → sig → cover → write) is fail-soft:
      // one pathological capture skips itself, never killing the batch.
      const parsed = parseNote(raw);
      if (!isCaptureInboxNote(parsed.frontmatter)) continue; // a hand-authored root note — leave it

      const stem = name.replace(/\.md$/i, "");
      const mapped = mapInboxNote(parsed.frontmatter, parsed.body, stem);
      // Backstop scrub: Gate-0 already scrubbed its files, but a raw native file
      // (Gate-0 off / failed open) may not have. redact() is idempotent on scrubbed text.
      const { text: body, findings } = redact(mapped.body);

      // Already ingested as THIS capture (same cc-session AND same slug) but the root
      // file survived a prior run — drop the duplicate source, don't re-stage. Identity
      // is (session, slug): two distinct memories from one session have different slugs,
      // so only the genuine re-seen file is dropped, never a sibling capture.
      const sessions = sourceSessions(mapped.frontmatter);
      const baseSlug = slugify(stem);
      if (sessions.some((s) => stagedIdentity.has(identity(s, baseSlug)))) {
        if (!(await safeRm(path))) {
          warnStderr(`mage: ${name} is already staged but could not be removed — remove it by hand.`);
        }
        continue;
      }

      // §4 covered-arm: a capture an existing committed note already covers does not
      // enter the active batch — ARCHIVE it (recoverable), never destroy it.
      const sig = draftSig(mapped.frontmatter, body, stem);
      const cover = lessonCoveringNote(sig, committed);
      if (cover) {
        const archived = await archiveCovered(stagingDir, stem, taken, mapped.frontmatter, body);
        if (archived) {
          taken.add(archived);
          await safeRm(path);
          result.covered.push({ from: name, by: cover.relPath });
        } else {
          warnStderr(`mage: could not archive covered capture ${name} — leaving it at the root.`);
        }
        continue;
      }

      const slug = uniqueSlug(slugify(stem), taken);
      await writeDraft(stagingDir, slug, mapped.frontmatter, body);
      taken.add(slug);
      // Stage succeeded; now remove the source. If the rm fails, the capture is SAFE
      // (it is staged) — warn so the user clears the lingering root file before it is
      // re-seen (the cc-session dedup above keeps it from re-staging meanwhile).
      if (!(await safeRm(path))) {
        warnStderr(`mage: staged ${name} but could not remove the source file — remove it by hand to avoid a re-ingest.`);
      }
      result.ingested.push({ slug, from: name, masked: findings.length });
    } catch (err) {
      warnStderr(`mage: skipping inbox capture ${name} (${(err as Error).message})`);
    }
  }
  return result;
}

/**
 * Archive a covered capture to `.mage/staging/.covered/<slug>.md` (the mapped +
 * scrubbed form, so the graveyard never holds raw secrets). Returns the slug written,
 * or null on failure (so the caller leaves the root file in place rather than lose it).
 */
async function archiveCovered(
  stagingDir: string,
  stem: string,
  taken: ReadonlySet<string>,
  fm: NoteFrontmatter,
  body: string,
): Promise<string | null> {
  try {
    const dir = coveredDir(stagingDir);
    await mkdir(dir, { recursive: true });
    const slug = uniqueSlug(slugify(stem), taken);
    await writeNote(join(dir, `${slug}.md`), fm, body);
    return slug;
  } catch {
    return null;
  }
}
