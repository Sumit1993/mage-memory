// Deterministic (wing + keywords) signature extraction (ADR-0019 §2). PURE — NO
// model, NO fs, NO network. Where the distill reader (reader.ts) emits CLUSTERS of
// salient signals for first-sight note-drafting, this emits SIGNATURES — coarse,
// stable `(wing + tags)` keys the recurrence tally buckets on. The four ADR-0019 §2
// lenses (correction · failure · workflow · preference) drive what a segment yields,
// reusing reader.ts's segment-adjacency rules EXACTLY (the only addition: an
// assistant_msg is a valid correction antecedent — a prompt right after the agent's
// reply is a steer, per the ADR-0015 amendment).
//
// The signature is COARSE on purpose (ADR-0019 §2): the deterministic fold buckets,
// the `mage:promote` skill refines at proposal time. Keyword derivation is the same
// deterministic shape observe/context-match already use — lower-case, tokenize, drop
// stopwords + short tokens, frequency-rank, then SORT alpha for a stable `key`.
//
// REDACTION: a hit's `hint` reaches stdout/a stored file (the proposal), so it runs
// through redact() (idempotent) and is capped — a raw secret never leaves here.

import type { ObserveEvent } from "../observe/types.js";
import { redact } from "../redact.js";
import type { Lens, SignatureHit } from "./types.js";

// ─── consts ──────────────────────────────────────────────────────────────────

/** Max keywords carried in a signature — the coarse-key budget (ADR-0019 §2). */
export const SIG_KEYWORDS = 6;
/** Max length of a hit's redacted human hint (the proposal nudge). */
const HINT_MAX = 160;
/** Min token length to keep — short tokens are noise (mirrors note.ts deriveKeywords). */
const MIN_TOKEN = 3;

/**
 * Deterministic stopwords dropped from keyword derivation. Mirrors note.ts's
 * STOPWORDS so a signature's keywords align with a note's index keywords (the
 * covering-note overlap test compares the two). Kept local so signature derivation
 * has no cross-module coupling beyond the shared vocabulary.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "by", "at",
  "from", "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
  "those", "it", "its", "as", "how", "what", "when", "where", "why", "which", "who",
  "whom", "into", "via", "not", "no", "do", "does", "did", "can", "could", "should",
  "would", "will", "then", "than", "so", "if", "we", "you", "they", "our", "your",
  "their", "using", "use", "used", "about",
]);

// ─── keywordsFromText — deterministic keyword derivation ──────────────────────

/**
 * Derive a stable keyword set from free text (ADR-0019 §2). Lower-case, tokenize on
 * non-(letter|number) across all scripts, drop stopwords + tokens shorter than
 * {@link MIN_TOKEN}, de-dupe. Rank by frequency DESC then alpha ASC, take the first
 * {@link SIG_KEYWORDS}, then SORT alpha so the resulting `key` is order-independent
 * (the same words always produce the same key). PURE, deterministic — no randomness.
 */
export function keywordsFromText(text: string): string[] {
  const freq = new Map<string, number>();
  // Split on non-(letter|number) so non-Latin text still yields tokens; the ASCII
  // stopword set still applies (mirrors note.ts deriveKeywords).
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.trim();
    if (w.length < MIN_TOKEN || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  // Rank: frequency DESC, ties broken alpha ASC — a stable, total order.
  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, SIG_KEYWORDS)
    .map(([w]) => w);
  // SORT alpha for the stable key (order-independent within the chosen set).
  return ranked.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ─── wingFromSegment — the touched-path wing (mirror context-match wingFired) ──

/** A run of events `[start, end)` within a stream — the segment shape this reads. */
interface Seg {
  start: number;
  end: number;
}

/**
 * Derive a segment's wing from its tool_use paths: the FIRST path segment, under
 * `repoRoot` when the path is absolute+under it, that names a wing directory — i.e.
 * the first non-empty segment after the repo prefix. "" when no tool touched a path.
 * Mirrors context-match's path-segment logic (an absolute path under repoRoot is made
 * relative first, so the repo prefix's own dirs don't masquerade as a wing).
 */
export function wingFromSegment(
  events: ObserveEvent[],
  seg: Seg,
  repoRoot: string | null,
): string {
  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e === undefined || e.type !== "tool_use") continue;
    for (const p of e.paths) {
      const segs = pathSegments(p, repoRoot);
      const first = segs[0];
      if (first !== undefined && first.length > 0) return first;
    }
  }
  return "";
}

/**
 * Split a touched path into lower-cased segments. An absolute path under `repoRoot`
 * is made relative first (so the repo prefix's own segments don't spuriously name a
 * wing); otherwise the raw path is split on "/". Mirrors context-match.pathSegments.
 */
function pathSegments(rawPath: string, repoRoot: string | null): string[] {
  let p = rawPath;
  if (repoRoot !== null && isAbsoluteUnder(rawPath, repoRoot)) {
    p = rawPath.slice(repoRoot.length);
  }
  return p
    .split("/")
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);
}

/** True iff `p` is `repoRoot` followed by a "/" boundary (strictly under it). */
function isAbsoluteUnder(p: string, repoRoot: string): boolean {
  if (!p.startsWith(repoRoot)) return false;
  const rest = p.slice(repoRoot.length);
  return rest.length === 0 || rest.startsWith("/");
}

// ─── segmentSignatures — the SET of (wing+keywords) hits for one segment ───────

/**
 * Extract the SET of signature hits from one segment's events across the four
 * ADR-0019 §2 lenses, deduped by `key` WITHIN the segment (a recurring pattern in
 * one chatty segment is one hit, not many — distinct-session counting happens above
 * in the tally). The terminator at the segment tail is structural, never a signal.
 *
 * Lens mapping (mirrors reader.ts extractSegment adjacency EXACTLY):
 *   ① correction — a user_prompt whose nearest preceding NON-TERMINATOR event is a
 *      tool_use OR an assistant_msg (the "agent acted / replied → human reacted"
 *      adjacency; the assistant_msg antecedent is the ADR-0015 amendment). Keyed by
 *      the prompt text.
 *   ② failure    — a tool_use with ok:false. Keyed by error_summary (→ detail → name).
 *   ③ workflow   — a tool name repeated ≥2 in the segment. Keyed by tool + path
 *      basenames.
 *   ④ preference — a salient tool_use (non-empty detail OR paths) not part of a
 *      repeat. Keyed by tool + path basenames / detail.
 *
 * Each hit's keywords come from {@link keywordsFromText} (corrections/failures over
 * the text; workflow/preference over tool + path basenames). The wing is the
 * segment's {@link wingFromSegment} (shared by every hit in the segment — a segment
 * is one chapter of work). De-duped by `key`; lens of the FIRST hit for a key wins
 * the recorded lens (the bucket merges lenses upstream in the fold).
 */
export function segmentSignatures(
  events: ObserveEvent[],
  seg: { start: number; end: number },
  repoRoot: string | null,
): SignatureHit[] {
  const wing = wingFromSegment(events, seg, repoRoot);

  // First pass: per-tool counts so the workflow lens (repeat ≥2) can fire.
  const toolCounts = new Map<string, number>();
  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e !== undefined && e.type === "tool_use") {
      toolCounts.set(e.tool, (toolCounts.get(e.tool) ?? 0) + 1);
    }
  }

  // Second pass: walk in causal order, classify each event into a lens, dedupe by key.
  const byKey = new Map<string, SignatureHit>();
  // The type of the immediately-preceding NON-TERMINATOR event — the correction
  // adjacency. Updated by EVERY non-terminator; terminators leave it untouched.
  let prevType: ObserveEvent["type"] | null = null;

  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e === undefined) continue;

    if (e.type === "user_prompt") {
      // Lens ①: a prompt right after a tool_use OR an assistant_msg is a correction.
      if (prevType === "tool_use" || prevType === "assistant_msg") {
        addHit(byKey, wing, "correction", keywordsFromText(e.text), `correction: ${e.text}`);
      }
      prevType = "user_prompt";
      continue;
    }

    if (e.type === "tool_use") {
      if (e.ok === false) {
        // Lens ②: the failure — error_summary, falling back to detail, then name.
        const text = e.error_summary ?? e.detail ?? `${e.tool} failed`;
        addHit(byKey, wing, "failure", keywordsFromText(`${e.tool} ${text}`), `failure: ${e.tool} ${text}`);
      }
      const repeated = (toolCounts.get(e.tool) ?? 0) >= 2;
      if (repeated) {
        // Lens ③: a repeated tool — workflow. Keyed by tool + path basenames.
        const body = toolBody(e.tool, e.paths, e.detail);
        addHit(byKey, wing, "workflow", keywordsFromText(body), `workflow: ${body}`);
      } else if (isSalientTool(e)) {
        // Lens ④: a salient non-repeat tool — preference.
        const body = toolBody(e.tool, e.paths, e.detail);
        addHit(byKey, wing, "preference", keywordsFromText(body), `preference: ${body}`);
      }
      prevType = "tool_use";
      continue;
    }

    // assistant_msg / skill_load / session_start: not a lens signal, but they ARE
    // non-terminator events, so they update the correction-adjacency prevType.
    if (e.type === "assistant_msg" || e.type === "skill_load" || e.type === "session_start") {
      prevType = e.type;
    }
    // terminators (compact / session_end): structural only — leave prevType.
  }

  return [...byKey.values()];
}

/** A tool_use is salient iff it failed, carries a non-empty detail, OR touched paths. */
function isSalientTool(e: Extract<ObserveEvent, { type: "tool_use" }>): boolean {
  return e.ok === false || hasContent(e.detail) || e.paths.length > 0;
}

/** True iff a nullable string carries non-whitespace content. */
function hasContent(s: string | null): boolean {
  return s !== null && s.trim().length > 0;
}

/**
 * The keyword-bearing body of a workflow/preference tool_use: the tool name plus its
 * path BASENAMES (a path's leaf is the salient identifier — the dirs are the wing),
 * falling back to a non-empty detail when there are no paths.
 *
 * SECURITY: a path basename flows into keywordsFromText → the signature `key` and
 * `keywords`, both of which reach stdout and the stored promote.json (unlike the
 * hint, addHit does NOT redact these). `e.paths` are STRUCTURED identifiers that
 * ADR-0015 §5 deliberately never routes through scrubField, so a leaf could carry a
 * credential (e.g. a high-entropy token in a filename). We redact() each basename
 * here — masking any secret to `[REDACTED:<kind>]` before it can enter the key or
 * keywords (mirroring reader.ts toolLine). redact() is idempotent, so already-clean
 * leaves round-trip unchanged.
 */
function toolBody(tool: string, paths: string[], detail: string | null): string {
  if (paths.length > 0) {
    const leaves = paths.map((p) => redact(p.split("/").pop() ?? p).text);
    return `${tool} ${leaves.join(" ")}`;
  }
  if (hasContent(detail)) return `${tool} ${detail as string}`;
  return tool;
}

/**
 * Build a hit and record it under its key (first lens for a key wins; the fold merges
 * lenses upstream). A hit with NO keywords is dropped — an empty keyword set yields a
 * degenerate key (`wing::`) that can't be meaningfully bucketed or covered. The hint
 * is REDACTED (idempotent) and capped at {@link HINT_MAX} so no raw secret leaves.
 */
function addHit(
  byKey: Map<string, SignatureHit>,
  wing: string,
  lens: Lens,
  keywords: string[],
  rawHint: string,
): void {
  if (keywords.length === 0) return;
  const key = `${wing}::${keywords.join(",")}`;
  if (byKey.has(key)) return; // first hit for this key wins the lens.
  byKey.set(key, {
    key,
    wing,
    keywords,
    lens,
    hint: redact(rawHint).text.slice(0, HINT_MAX),
  });
}
