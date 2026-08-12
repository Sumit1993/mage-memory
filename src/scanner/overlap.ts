/**
 * Merge-candidate detection — two deterministic signals over memory-genre notes.
 *
 * Read-only, no side effects, no runtime dependency beyond Node builtins.
 * Rides the scan that `mage index` already performs (every note body is read once).
 *
 * Signal A — structural, high precision:
 *   Pairs of notes that link *each other* AND share a `#wing/room` tag.
 *
 * Signal B — lexical, narrowing only:
 *   TF-IDF cosine over note BODIES. Capped at top 5 pairs, high threshold.
 *   Worded as a candidate, never a verdict (ADR-0009: engine narrows, host judges).
 *
 * Both signals operate over memory-genre notes only (genre-map.ts decides genre).
 */

import { posix } from "node:path";
import { extractLinks, extractWikiLinks } from "../links.js";
import { genreOf } from "./genre-map.js";

// ─── public types ──────────────────────────────────────────────────────────

export interface MergePair {
  noteA: string;
  noteB: string;
  /** Human-readable reason this pair was flagged. */
  reason: string;
}

export interface MergeCandidates {
  /** Signal A: mutual links in a shared room (structural, high-precision). */
  signalA: MergePair[];
  /** Signal B: TF-IDF cosine similarity over bodies (lexical, narrowing only). */
  signalB: MergePair[];
}

// ─── input type ────────────────────────────────────────────────────────────

export interface OverlapNote {
  relPath: string;
  type: string;
  /** Normalized tags (no leading `#`). */
  tags: string[];
  /** The note body (markdown after frontmatter). */
  body: string;
}

// ─── Signal B tuning ───────────────────────────────────────────────────────

/** Top-N cap on Signal B pairs. */
const SIGNAL_B_CAP = 5;
/** Minimum cosine similarity for Signal B (high threshold — narrowing, not asserting). */
const SIGNAL_B_THRESHOLD = 0.45;

// ─── entry point ───────────────────────────────────────────────────────────

/**
 * Compute both merge-candidate signals. Pure + synchronous.
 * Only memory-genre notes are considered (plan, doc, decision, work, unclassified excluded).
 */
export function detectMergeCandidates(notes: OverlapNote[]): MergeCandidates {
  const memoryNotes = notes.filter((n) => genreOf(n.type) === "memory");

  const signalA = computeSignalA(memoryNotes);
  const signalB = computeSignalB(memoryNotes);

  return { signalA, signalB };
}

// ─── Signal A — structural: mutual links in a shared room ──────────────────

/** Strip fenced + inline code so example links are not treated as real. */
function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/**
 * Collect all link targets from a note body (both markdown and wikilinks).
 * Returns basenames (without `.md`) for uniform comparison.
 */
function allLinkTargets(body: string): Set<string> {
  const stripped = stripCode(body);
  const targets = new Set<string>();
  for (const t of extractLinks(stripped)) {
    // Normalize: take the basename and strip .md
    targets.add(posix.basename(t, ".md"));
  }
  for (const t of extractWikiLinks(stripped)) {
    targets.add(posix.basename(t, ".md"));
  }
  return targets;
}

/**
 * Extract all `wing/room` tag strings from a note's tags.
 * Each tag is already in `wing/room` form; we return the full tag for room-level comparison.
 */
function wingRoomTags(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    // A tag like "eng/api" already encodes wing + room
    if (tag.includes("/")) out.add(tag);
  }
  return out;
}

function computeSignalA(notes: OverlapNote[]): MergePair[] {
  const pairs: MergePair[] = [];
  // Pre-compute link targets and tags for each note
  const linkTargets = notes.map((n) => allLinkTargets(n.body));
  const tagSets = notes.map((n) => wingRoomTags(n.tags));

  for (let i = 0; i < notes.length; i++) {
    const aBase = posix.basename(notes[i]!.relPath, ".md");
    for (let j = i + 1; j < notes.length; j++) {
      const bBase = posix.basename(notes[j]!.relPath, ".md");

      // Check mutual link: A links B AND B links A
      const aLinksB = linkTargets[i]!.has(bBase);
      const bLinksA = linkTargets[j]!.has(aBase);
      if (!aLinksB || !bLinksA) continue;

      // Check shared wing/room tag
      const sharedTags: string[] = [];
      for (const tag of tagSets[i]!) {
        if (tagSets[j]!.has(tag)) sharedTags.push(tag);
      }
      if (sharedTags.length === 0) continue;

      pairs.push({
        noteA: notes[i]!.relPath,
        noteB: notes[j]!.relPath,
        reason: `link each other and share #${sharedTags[0]}`,
      });
    }
  }

  // Deterministic sort by noteA then noteB
  pairs.sort((a, b) => a.noteA < b.noteA ? -1 : a.noteA > b.noteA ? 1 : a.noteB < b.noteB ? -1 : 1);
  return pairs;
}

// ─── Signal B — lexical: TF-IDF cosine over note bodies ────────────────────

/**
 * Tokenize a note body for TF-IDF. Splits on non-word boundaries, lowercases,
 * drops short tokens and markdown/frontmatter artifacts. This reads the actual
 * body content, NOT deriveKeywords (which reads only title/headers/tags and
 * caps at 12 tokens — see issue #153).
 */
function tokenize(body: string): string[] {
  return body
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

/** Build a term-frequency map for a single document. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

/** Build inverse document frequency from all documents. */
function inverseDocFrequency(docs: Map<string, number>[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    // Standard IDF with +1 smoothing to avoid division by zero
    idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  }
  return idf;
}

/** Build TF-IDF vector for a document. */
function tfidfVector(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vec = new Map<string, number>();
  for (const [term, freq] of tf) {
    const idfVal = idf.get(term) ?? 0;
    vec.set(term, freq * idfVal);
  }
  return vec;
}

/** Cosine similarity between two sparse vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, val] of a) {
    normA += val * val;
    const bVal = b.get(term);
    if (bVal !== undefined) dot += val * bVal;
  }
  for (const val of b.values()) {
    normB += val * val;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface ScoredPair {
  noteA: string;
  noteB: string;
  score: number;
}

function computeSignalB(notes: OverlapNote[]): MergePair[] {
  if (notes.length < 2) return [];

  // 1. Tokenize all note bodies
  const tfMaps = notes.map((n) => termFrequency(tokenize(n.body)));

  // 2. Build IDF across the corpus
  const idf = inverseDocFrequency(tfMaps);

  // 3. Build TF-IDF vectors
  const vectors = tfMaps.map((tf) => tfidfVector(tf, idf));

  // 4. Pairwise cosine similarity
  const scored: ScoredPair[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const score = cosineSimilarity(vectors[i]!, vectors[j]!);
      if (score >= SIGNAL_B_THRESHOLD) {
        scored.push({
          noteA: notes[i]!.relPath,
          noteB: notes[j]!.relPath,
          score,
        });
      }
    }
  }

  // 5. Sort by score descending, cap at top 5
  scored.sort((a, b) => b.score - a.score);
  const capped = scored.slice(0, SIGNAL_B_CAP);

  return capped.map((s) => ({
    noteA: s.noteA,
    noteB: s.noteB,
    reason: `TF-IDF cosine ${s.score.toFixed(2)} over note bodies`,
  }));
}
