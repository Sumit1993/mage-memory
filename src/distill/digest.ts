// The earned-signal digest builder (ADR-0029). PURE — NO model, NO fs, NO network.
//
// This is the pivot after TWO pre-registered gates killed deterministic candidate-SELECTION
// (Faultline 0/62 — ADR-0027; prose-keyed 0/55 — ADR-0028). Both kills triangulated that the durable
// earned lessons are single-session friction/derivation ARCS in the failure + external-command stream,
// needing model synthesis + judgment a model-free core cannot do — and the gates' recall agents (models
// reading a digest) FOUND them. So mage stops trying to DECIDE what a lesson is and instead does what it
// is good at: cheap, offline NARROWING + COMPRESSION + neutral annotation of the just-closed chapter into
// a read-only DIGEST. The host agent mines it and stages the durable ones via inline `mage stage`
// (ADR-0009 — model in the host, never in mage's engine; the deterministic layer is the digest-builder,
// not the selector).
//
// The digest carries three earned-signal types (ADR-0029 §3), flat per-type sections, chronological
// within each (the agent stitches cross-type arcs from content — recall-proven), explicitly framed as
// RAW MATERIAL, never a claim (ADR-0029 §4–§5). Bounding is dedup-first + capped with NO silent caps
// (§6). Reuses the conservative `failureSkeleton` and the substantive-correction filter that ADR-0028
// landed; adds the external-command channel (the richest missed gems lived there, surfaced by neither
// dead detector).

import type { ObserveEvent } from "../observe/types.js";
import { redact } from "../redact.js";

// ─── tunable bounds (provisional; soak/gate-tunable — belong in thresholds.ts when wired) ──────

/** Default per-section caps (keep-most-recent on overflow; the rest spill to `mage distill`). */
export const DEFAULT_FAILURE_CAP = 30;
export const DEFAULT_COMMAND_CAP = 30;
export const DEFAULT_CORRECTION_CAP = 25;
/** Total rendered `additionalContext` char budget — the final guard against a giant chapter. */
export const DEFAULT_CHAR_BUDGET = 4000;

const CORRECTION_TEXT_MAX = 320;
const PRECEDED_BY_MAX = 100;
const FAILURE_TEXT_MAX = 180;
const COMMAND_TEXT_MAX = 180;
const MIN_CORRECTION_WORDS = 3;
const MIN_CORRECTION_CHARS = 12;

// ─── conservative failure-skeleton normalization (reused from ADR-0028) ────────────────────────

/** Cap on a failure skeleton (the dedup key). */
const SKELETON_MAX = 200;

/**
 * Harness-protocol failures — never a domain lesson, just a tool-usage rule the agent hit and fixed.
 * Default = Claude Code's Edit/Read protocol strings; dropped before the digest so they never flood it.
 * PARAMETERIZED (ADR-0027 §8) — another harness passes its own.
 */
export const DEFAULT_PROTOCOL_PATTERNS: readonly RegExp[] = [
  /file has not been read yet/i,
  /string to replace (was )?not found/i, // CC's real wording omits "was".
  /found \d+ matches of the string to replace/i,
  /no replacement was performed/i,
  /old_string and new_string are exactly the same/i,
  /has been (unexpectedly )?modified (since|after) read/i,
  /this operation requires permission/i,
  /permission for this action was denied/i, // CC auto-mode permission gate.
  /the user (doesn't|does not) want to (proceed|take this action)/i,
  /request interrupted by user/i,
  /is temporarily unavailable/i, // transient model-availability blip, never a lesson.
  /file does not exist\. note: your current working directory/i, // CC cwd-confusion wrapper.
];

/** True iff a raw failure string is a known harness-protocol failure (not a domain lesson). */
export function isProtocolFailure(
  raw: string,
  patterns: readonly RegExp[] = DEFAULT_PROTOCOL_PATTERNS,
): boolean {
  return patterns.some((re) => re.test(raw));
}

/**
 * Reduce a raw failure string to a CONSERVATIVE skeleton (the dedup key). Lowercase, then strip ONLY
 * clearly-variable parts (URLs, paths, UUIDs/hashes, long numbers, quoted specifics) so the SAME error
 * with a different URL/path still collapses, while the structural phrase + short status codes survive so
 * DIFFERENT errors do not. Miss-don't-manufacture: when unsure, keep a specific (a missed collapse is
 * lossless) rather than strip it (a manufactured collapse misleads). Returns "" when nothing structural
 * survives (such a failure does not dedup — shown verbatim). PURE + idempotent.
 */
export function failureSkeleton(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/g, " "); // URLs
  s = s.replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, " "); // ISO timestamps
  s = s.replace(/[a-z]:\\[^\s"']+/g, " "); // windows paths
  s = s.replace(/\.{1,2}\/[\w./@-]+/g, " "); // ./ ../ relative paths
  s = s.replace(/(?:\/[\w.@-]+){2,}\/?/g, " "); // absolute unix paths (>=2 segments)
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, " "); // UUIDs
  s = s.replace(/\b[0-9a-f]{7,}\b/g, " "); // long hex ids
  s = s.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, "``"); // quoted specifics
  s = s.replace(/\b\d{4,}\b/g, " "); // long numbers (1-3 digit status codes survive)
  s = s.replace(/\s+/g, " ").trim();
  if (!/[a-z]/.test(s)) return ""; // no structural phrase left → do not dedup-bucket it.
  return s.slice(0, SKELETON_MAX);
}

// ─── substantive-correction filter (reused from ADR-0028) ──────────────────────────────────────

/** Contradiction cues — a correction carrying one is a stronger steer. Annotation only, never a filter. */
const CUE_RE = /\b(no|nope|don'?t|instead|actually|wrong|should|rather|revert|undo)\b/i;

/** True iff the text carries a contradiction cue. */
export function hasContradictionCue(text: string): boolean {
  return CUE_RE.test(text);
}

/** Bare continuation/ack tokens — a whole prompt that is just one of these waves the agent on. */
const CONTINUATION_TOKENS: ReadonlySet<string> = new Set([
  "continue", "next", "ok", "okay", "yes", "y", "yep", "yeah", "sure", "k", "go", "proceed",
  "commit", "done", "good", "great", "perfect", "nice", "cool", "thanks", "thank you", "ty",
  "go ahead", "do it", "continue please", "please continue", "keep going", "carry on",
]);

/** A "resume from where you left off" continuation PHRASE (drops the harness resume, keeps real steers). */
const CONTINUATION_PHRASE_RE =
  /^(please\s+)?(continue|resume|carry on|pick up|keep going|go on)\b.*\b(left off|where (you|we|i) (left|were)|you left)/i;

/** Compaction / local-command / system boilerplate that rides in as a "user" turn but never steers. */
const BOILERPLATE_RE: readonly RegExp[] = [
  /^this session is being continued/i,
  /continue the conversation from where it left off/i,
  /^\s*caveat: the messages below/i,
  /\[request interrupted/i,
  /^\s*<command-(name|message|args)/i,
  /^\s*<local-command/i,
  /^\s*<system-reminder/i,
  /^\s*api error/i,
];

/**
 * True iff a user prompt is a SUBSTANTIVE correction worth surfacing (ADR-0028 §3 / ADR-0029 §3). Drops
 * obvious noise only — boilerplate, slash-commands, bare continuations, and very short acks WITHOUT a
 * contradiction cue. Does NOT classify correction-vs-next-task (the agent culls).
 */
export function isSubstantiveCorrection(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.startsWith("/")) return false;
  if (BOILERPLATE_RE.some((re) => re.test(t))) return false;
  const lower = t.toLowerCase();
  const bare = lower.replace(/[.!…\s]+$/u, "").trim();
  if (CONTINUATION_TOKENS.has(bare)) return false;
  if (CONTINUATION_PHRASE_RE.test(t)) return false;
  if (hasContradictionCue(t)) return true; // a terse-but-real steer survives.
  if (t.split(/\s+/u).filter(Boolean).length < MIN_CORRECTION_WORDS) return false;
  if (t.length < MIN_CORRECTION_CHARS) return false;
  return true;
}

// ─── external-command extraction (the channel ADR-0029 §3 promotes to first-class) ─────────────

/**
 * External / network CLI tools whose invocations carry earned operational knowledge (auth quirks, API
 * gotchas, derivation/recon arcs) — the stream where the richest missed gems lived (a 6-command npm/GH
 * name recon; a `curl` SVG workaround), yet neither dead detector surfaced commands at all. Local
 * dev-loop verbs (git/node/python/make + `npm test|run|install`) are deliberately excluded as noise.
 */
const EXTERNAL_CLI_RE =
  /\b(curl|wget|gh|kubectl|aws|gcloud|az|terraform|docker|podman|psql|mysql|mongosh?|redis-cli|ssh|scp|rsync|helm|vault|flyctl|heroku|vercel|netlify|cloudflared)\b/;
/** npm/pnpm/yarn only for NETWORK subcommands (registry queries/publishes), not local builds. */
const NPM_NETWORK_RE = /\b(npm|pnpm|yarn)\s+(view|info|search|publish|audit|outdated|dist-tag|access|owner|whoami)\b/;

/** True iff a Bash command string is an external/network command worth surfacing. */
export function isExternalCommand(command: string): boolean {
  return EXTERNAL_CLI_RE.test(command) || NPM_NETWORK_RE.test(command);
}

// ─── the digest data model ─────────────────────────────────────────────────────────────────────

export type DigestKind = "failure" | "command" | "correction";

/** One displayed digest line (redacted). `count` is a dedup artifact (compression), never a value claim. */
export interface DigestItem {
  text: string;
  /** How many identical occurrences this chapter collapsed into this line (>=1). */
  count: number;
  /** Corrections only: carries a contradiction cue. */
  cue?: boolean;
  /** Corrections only: a short line for what the agent did immediately before. */
  precededBy?: string;
}

/** One per-type section: items in chronological order, capped, with a spill count. */
export interface DigestSection {
  kind: DigestKind;
  items: DigestItem[];
  /** Distinct items before the cap (items.length + spilled === total). */
  total: number;
  /** Distinct items dropped by the cap (kept-most-recent); 0 when nothing spilled. */
  spilled: number;
}

/** The earned-signal digest of one closed chapter. */
export interface Digest {
  failures: DigestSection;
  commands: DigestSection;
  corrections: DigestSection;
  /** True when every section is empty — the nudge surfaces nothing. */
  isEmpty: boolean;
}

/** Options for {@link computeDigest}. */
export interface DigestOptions {
  failureCap?: number;
  commandCap?: number;
  correctionCap?: number;
  protocolPatterns?: readonly RegExp[];
}

// ─── computeDigest — PURE narrowing of one chapter's events into the digest ────────────────────

interface Agg {
  text: string;
  count: number;
  firstIdx: number;
  cue?: boolean;
  precededBy?: string;
}

/**
 * Narrow one closed chapter's events into the {@link Digest} (ADR-0029 §3–§6). PURE — no model, no fs.
 * Failures: drop protocol noise, dedup by {@link failureSkeleton} (display the first raw example, count
 * occurrences). Commands: external/network Bash only, exact-dedup by redacted text. Corrections: the
 * {@link isSubstantiveCorrection} filter, each with its preceding action + cue. Every section is ordered
 * by first occurrence (chronological — NOT by frequency: recurrence is a poor value proxy), then capped
 * keeping the MOST RECENT with a spill count (no silent caps). All text is redacted.
 */
export function computeDigest(events: ObserveEvent[], opts: DigestOptions = {}): Digest {
  const protocol = opts.protocolPatterns ?? DEFAULT_PROTOCOL_PATTERNS;

  const failures = new Map<string, Agg>();
  const commands = new Map<string, Agg>();
  const corrections: Agg[] = []; // corrections are distinct events — no dedup.

  let prevType: ObserveEvent["type"] | null = null;
  let lastAction = "";

  events.forEach((e, idx) => {
    if (e.type === "user_prompt") {
      if ((prevType === "tool_use" || prevType === "assistant_msg") && isSubstantiveCorrection(e.text)) {
        corrections.push({
          text: redact(oneLine(e.text)).text.slice(0, CORRECTION_TEXT_MAX),
          count: 1,
          firstIdx: idx,
          cue: hasContradictionCue(e.text),
          precededBy: lastAction,
        });
      }
      prevType = "user_prompt";
      return;
    }
    if (e.type === "tool_use") {
      if (e.ok === false) {
        const raw = e.error_summary ?? e.detail ?? `${e.tool} failed`;
        if (!isProtocolFailure(raw, protocol)) {
          const display = redact(oneLine(raw)).text.slice(0, FAILURE_TEXT_MAX);
          const key = failureSkeleton(raw) || `verbatim:${display}`; // no skeleton → dedup on display.
          bump(failures, key, display, idx);
        }
      }
      if (e.tool === "Bash" && e.detail !== null && isExternalCommand(e.detail)) {
        const display = redact(oneLine(e.detail)).text.slice(0, COMMAND_TEXT_MAX);
        bump(commands, display, display, idx); // exact-dedup by redacted command text.
      }
      lastAction = redact(toolLine(e)).text.slice(0, PRECEDED_BY_MAX);
      prevType = "tool_use";
      return;
    }
    if (e.type === "assistant_msg" || e.type === "skill_load" || e.type === "session_start") {
      prevType = e.type;
    }
    // terminators (compact/session_end): structural only.
  });

  const failSec = sectionOf("failure", [...failures.values()], opts.failureCap ?? DEFAULT_FAILURE_CAP);
  const cmdSec = sectionOf("command", [...commands.values()], opts.commandCap ?? DEFAULT_COMMAND_CAP);
  const corrSec = sectionOf("correction", corrections, opts.correctionCap ?? DEFAULT_CORRECTION_CAP);

  return {
    failures: failSec,
    commands: cmdSec,
    corrections: corrSec,
    isEmpty: failSec.items.length === 0 && cmdSec.items.length === 0 && corrSec.items.length === 0,
  };
}

/** Record an occurrence under `key`: first sighting wins display + order; later sightings bump count. */
function bump(map: Map<string, Agg>, key: string, display: string, idx: number): void {
  const cur = map.get(key);
  if (cur === undefined) map.set(key, { text: display, count: 1, firstIdx: idx });
  else cur.count += 1;
}

/** Order an aggregate set chronologically, cap keeping the MOST RECENT, record the spill. */
function sectionOf(kind: DigestKind, aggs: Agg[], cap: number): DigestSection {
  const ordered = [...aggs].sort((a, b) => a.firstIdx - b.firstIdx);
  const total = ordered.length;
  const kept = total > cap ? ordered.slice(total - cap) : ordered; // keep-most-recent.
  const items: DigestItem[] = kept.map((a) => ({
    text: a.text,
    count: a.count,
    ...(kind === "correction" ? { cue: a.cue, precededBy: a.precededBy } : {}),
  }));
  return { kind, items, total, spilled: Math.max(0, total - cap) };
}

/** One-liner for a salient tool_use: `tool: <detail | joined-paths>` (the correction's context). */
function toolLine(e: Extract<ObserveEvent, { type: "tool_use" }>): string {
  const body = e.detail !== null && e.detail.trim().length > 0 ? e.detail : e.paths.join(",");
  return `${e.tool}: ${body}`.trim();
}

/** Collapse to a single trimmed line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ─── renderDigest — the additionalContext markdown (raw material, never a claim) ───────────────

/** The non-claim banner (ADR-0029 §5) — the artifact must read as raw material the agent judges. */
const BANNER =
  "mage — earned-signal inventory from the last chapter. Raw material, NOT lessons: mage is not " +
  "claiming any of these is worth keeping, and most are noise. If you recognize a durable lesson " +
  "(a gotcha, a hard-won procedure, an environment/API constraint), capture it with `mage stage`. " +
  "Nothing below is ranked by importance — it is in the order it happened.";

/**
 * Render a {@link Digest} as the `additionalContext` markdown. Three flat per-type sections in
 * chronological order, dedup counts shown as plain "(×N)" compression metadata, an explicit spill line
 * per capped section (no silent caps → points at `mage distill`), and a total char budget as the final
 * guard. Returns "" for an empty digest (the nudge then surfaces nothing). PURE.
 */
export function renderDigest(d: Digest, charBudget: number = DEFAULT_CHAR_BUDGET): string {
  if (d.isEmpty) return "";
  const lines: string[] = [BANNER, ""];

  renderSection(lines, "Failures", d.failures, (it) =>
    `- ${it.text}${it.count > 1 ? ` (×${it.count})` : ""}`,
  );
  renderSection(lines, "External commands", d.commands, (it) =>
    `- ${it.text}${it.count > 1 ? ` (×${it.count})` : ""}`,
  );
  renderSection(lines, "Corrections", d.corrections, (it) =>
    `- "${it.text}"${it.cue ? " [steer]" : ""}${it.precededBy ? ` — after: ${it.precededBy}` : ""}`,
  );

  let out = lines.join("\n").trimEnd();
  if (out.length > charBudget) {
    out = `${out.slice(0, charBudget)}\n… (truncated — run \`mage distill\` for the full chapter)`;
  }
  return out;
}

/** Render one non-empty section with its items + an explicit spill line; no-op when empty. */
function renderSection(
  lines: string[],
  title: string,
  section: DigestSection,
  fmt: (it: DigestItem) => string,
): void {
  if (section.items.length === 0) return;
  lines.push(`## ${title} (${section.total})`);
  for (const it of section.items) lines.push(fmt(it));
  if (section.spilled > 0) {
    lines.push(`(+${section.spilled} more — run \`mage distill\` for the full set)`);
  }
  lines.push("");
}
