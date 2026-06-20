// Faultline — the friction/derivation capture detector (ADR-0027). PURE, model-free
// (ADR-0009): a deterministic fold over the same `.mage/learnings` events the distill
// reader consumes, surfacing FRICTION ARCS (onset→resolution) for the boundary nudge to
// rank and the AGENT to judge. It NARROWS + RANKS; it never claims a lesson.
//
// This file ships the load-bearing PRIMITIVES first (the grill's crux, ADR-0027 §6):
//   - the APPROACH-KEY: a coarse, composite-command-aware fingerprint of HOW an action
//     worked, used to tell "you switched approaches" (friction) from "you retried" (noise).
//   - TOOL EXTERNALITY: a two-bucket "is the knowledge recoverable from the repo?" signal
//     (local file/Bash vs an external CLI), the multiplier in the cost-to-re-derive proxy.
//
// Harness-specific knowledge stays OUT of the detector LOGIC (ADR-0027 §8): the external-verb /
// wrapper / tool / protocol / env-error / stopword sets are DEFAULTS, overridable via opts so
// another harness brings its own without forking. The DEFAULT_* sets below are the Claude-Code
// "adapter profile" — kept here so the detector works out-of-box and the unit tests are
// self-contained; they should be relocated into the ADR-0017 adapter when the nudge integration
// lands (post-gate). The PURE detector itself makes no model/network/fs call.

import type { DistillCluster } from "./types.js";
import type { ObserveEvent } from "../observe/types.js";

// ─── the capture unit (ADR-0027 §3) ──────────────────────────────────────────

/** The three triggers (ADR-0027 §4). `grind` needs no error — concentrated effort on one topic. */
export type FrictionPattern = "failure-pivot" | "correction-reset" | "grind";

/** Whether an action's knowledge lives in the repo (local) or an external system (external). */
export type Externality = "external" | "local";

/**
 * One friction arc — the capture unit. Additively extends {@link DistillCluster}
 * (consumers ignore unknown fields, ADR-0015), populating `signals`/`hint` from ONLY the
 * arc span (this is what fixes the chapter grab-bag). `tried`/`worked` record the falsifier
 * and the resolver (the seed of a future `mage verify-lesson`, ADR-0027 deferred).
 */
export interface FrictionArc extends DistillCluster {
  pattern: FrictionPattern;
  /** 1-based event index of the arc onset in the source stream. */
  onset: number;
  /** 1-based event index of the arc resolution. */
  resolution: number;
  /** The abandoned approach-key (what was tried). null for a grind (no pivot). */
  tried: string | null;
  /** The resolving approach-key (what worked). null for a grind. */
  worked: string | null;
  /** The same-intent token shared across the arc; null when no link was required/found. */
  topic: string | null;
  /** Re-derivation-cost proxy = span events × tool-externality (NOT recurrence). */
  cost: number;
  /** True iff any action in the arc touched an external tool. */
  externality: Externality;
}

// ─── tunable verb/tool sets (DEFAULTS — overridable per harness, ADR-0027 §8) ──

/**
 * External CLIs: the knowledge they surface lives in an external system's behavior (an
 * API's auth quirk, a 403, a service alias), NOT re-readable from the repo — so high
 * cost-to-re-derive. `git`/`npm` are deliberately ABSENT (they straddle; defaulting them
 * to LOCAL keeps the dev-loop noise Phase 0 hated from being amplified, ADR-0027 §6).
 */
export const EXTERNAL_VERBS: ReadonlySet<string> = new Set([
  "curl", "wget", "gh", "kubectl", "aws", "gcloud", "az", "terraform", "docker",
  "docker-compose", "podman", "ssh", "scp", "sftp", "rsync", "psql", "mysql", "mongosh",
  "mongo", "redis-cli", "http", "helm", "vault", "nc", "telnet", "dig", "nslookup",
  "heroku", "flyctl", "fly", "vercel", "netlify", "supabase", "stripe",
]);

/**
 * TRANSPARENT prefixes: the real command is the NEXT token (so `sudo systemctl …` keys on
 * `systemctl`). Skipped while scanning, but scanning continues past them.
 */
export const WRAPPER_VERBS: ReadonlySet<string> = new Set([
  "sudo", "doas", "env", "time", "timeout", "nice", "ionice", "command", "exec", "eval",
  "xargs", "nohup", "stdbuf", "unbuffer", "setsid", "watch",
]);

/**
 * STANDALONE trivial commands + shell control words: their arguments are NOT verbs, so a
 * segment whose command is one of these contributes NO substantive verb (so `cd repo && gh …`
 * keys on `gh`, never on the path `repo`, ADR-0027 §6).
 */
export const NULL_VERBS: ReadonlySet<string> = new Set([
  "cd", "pushd", "popd", "mkdir", "export", "source", ".", "set", "unset", "alias", "umask",
  "readonly", "local", "declare", "then", "do", "done", "fi", "else", "elif", "while", "for",
  "if", "case", "esac", "function", "return",
]);

/** Non-Bash tools that are inherently external (their knowledge is not in the repo). */
export const EXTERNAL_TOOLS: ReadonlySet<string> = new Set(["WebFetch", "WebSearch"]);

/** Tools whose approach-key is `tool:path-stem` (in-repo file operations — always local). */
export const PATH_TOOLS: ReadonlySet<string> = new Set([
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead", "Glob", "Grep", "LS",
]);

/**
 * Tools parsed as a SHELL COMMAND LINE (verb extraction + externality OR). Default: just `Bash`.
 * A harness whose shell tool is `shell`/`run_command`/`terminal` overrides this so the §6
 * parsing machinery applies to it too (otherwise it would degrade to a single constant key).
 */
export const BASH_TOOLS: ReadonlySet<string> = new Set(["Bash"]);

/** Overridable knowledge sets — a harness with different tools/CLIs supplies its own. */
export interface KeyOpts {
  externalVerbs?: ReadonlySet<string>;
  wrapperVerbs?: ReadonlySet<string>;
  nullVerbs?: ReadonlySet<string>;
  externalTools?: ReadonlySet<string>;
  pathTools?: ReadonlySet<string>;
  /** Tools treated as a shell command line. Default {@link BASH_TOOLS}. */
  bashTools?: ReadonlySet<string>;
}

// ─── command parsing (composite-aware, NOT a shell parser, ADR-0027 §6) ───────

/** Command name from a token: after the last `/`, stripped of leading + trailing shell punctuation. */
function cmdName(token: string): string {
  const trimmed = token.replace(/^[("'`$\\]+/, "").replace(/[)"'`;]+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Path stem for a path-tool key: basename (trailing slashes dropped) without its extension. */
function pathStem(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, "");
  const slash = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  const base = slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Flatten subshell / command-substitution wrappers — `$( )`, backticks, and `<( ` / `>( `
 * process substitutions — into plain segment separators, so the inner command's verb is
 * reachable (e.g. `RESULT=$(gh api …)` must expose `gh`, the most common external idiom).
 * Coarse: no nesting-depth tracking, every `)` becomes a separator — but recall-first, a
 * mis-split degrades to a coarse key (ADR-0027 §5).
 */
function expandSubshells(command: string): string {
  return command
    .replace(/\$\(/g, " ; ")
    .replace(/[<>]\(/g, " ; ")
    .replace(/`/g, " ; ")
    .replace(/\)/g, " ; ");
}

/**
 * Split a command into top-level segments at `&&`, `||`, `|`, `;`, and newlines. `||` is
 * matched before a single `|` so a logical-OR is one split, not two. Subshells are flattened
 * first ({@link expandSubshells}); we do NOT parse heredocs/loops — a mis-split degrades to a
 * coarse key, which is safe under the recall-first stance (ADR-0027 §5: the agent culls).
 */
function splitSegments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||[|;\n])\s*/).filter((s) => s.trim().length > 0);
}

/**
 * The substantive verb of one segment. Skips env-assignments and TRANSPARENT wrapper
 * prefixes (scanning continues past them); a STANDALONE trivial command / control word
 * yields null (its arguments are not verbs).
 */
function segmentVerb(
  segment: string,
  wrappers: ReadonlySet<string>,
  nulls: ReadonlySet<string>,
): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      i += 1; // FOO=bar prefix
      continue;
    }
    const name = cmdName(token);
    if (name.length === 0) {
      i += 1;
      continue;
    }
    if (wrappers.has(name)) {
      // Transparent prefix — skip it AND its option flags / numeric-or-duration args (e.g.
      // `timeout 30 curl`, `nice -n 10 node`) until the real command. NOT a full parser: an
      // option that takes a separate word value (`sudo -u user cmd`) may mis-key — coarse
      // fallback, tolerated under recall-first (ADR-0027 §6).
      i += 1;
      while (i < tokens.length && /^(-|\d+[smhd]?$)/.test(tokens[i] ?? "")) i += 1;
      continue;
    }
    return nulls.has(name) ? null : name; // a trivial standalone command contributes no verb
  }
  return null;
}

/** Every substantive verb in a (possibly composite) command, in order. */
export function commandVerbs(command: string, opts: KeyOpts = {}): string[] {
  const wrappers = opts.wrapperVerbs ?? WRAPPER_VERBS;
  const nulls = opts.nullVerbs ?? NULL_VERBS;
  const verbs: string[] = [];
  for (const seg of splitSegments(expandSubshells(command))) {
    const v = segmentVerb(seg, wrappers, nulls);
    if (v !== null) verbs.push(v);
  }
  return verbs;
}

// ─── the load-bearing primitives (ADR-0027 §6) ───────────────────────────────

/**
 * The APPROACH-KEY: a coarse fingerprint of HOW an action worked, for the "did you switch
 * approaches?" test. Path tools → `tool:path-stem`; Bash → `Bash:<verb>` where the verb is
 * the first SUBSTANTIVE verb across composite segments, PREFERRING an external one (so a
 * `cd x && gh …` keys on `gh`); other tools → the tool name. Non-tool events → their type.
 * Coarse by design (ADR-0027 §5): precision lives in ranking + the agent's cull, not here.
 */
export function approachKey(e: ObserveEvent, opts: KeyOpts = {}): string {
  if (e.type !== "tool_use") return e.type;
  const pathTools = opts.pathTools ?? PATH_TOOLS;
  if (pathTools.has(e.tool)) {
    const first = e.paths[0];
    const stem = first ? pathStem(first) : "";
    return stem.length > 0 ? `${e.tool}:${stem}` : e.tool; // empty stem (trailing slash) → bare tool
  }
  if ((opts.bashTools ?? BASH_TOOLS).has(e.tool)) {
    const verbs = commandVerbs(e.detail ?? "", opts);
    const external = opts.externalVerbs ?? EXTERNAL_VERBS;
    const preferred = verbs.find((v) => external.has(v)) ?? verbs[0];
    // A verbless command keys to `tool:?` — a sentinel that never matches another (no false
    // retry/collapse) via {@link sameApproach}.
    return `${e.tool}:${preferred ?? VERBLESS}`;
  }
  return e.tool;
}

/**
 * TOOL EXTERNALITY: "is what I learned here recoverable from the repo?" Path tools and
 * local Bash → `local` (re-read the file). An OR over the WHOLE command for Bash (external
 * if ANY substantive verb is an external CLI — composite commands hide the real work past
 * the first verb, ADR-0027 §6), plus the inherently-external non-Bash tools.
 */
export function toolExternality(e: ObserveEvent, opts: KeyOpts = {}): Externality {
  if (e.type !== "tool_use") return "local";
  const externalTools = opts.externalTools ?? EXTERNAL_TOOLS;
  if (externalTools.has(e.tool)) return "external";
  if ((opts.bashTools ?? BASH_TOOLS).has(e.tool)) {
    const external = opts.externalVerbs ?? EXTERNAL_VERBS;
    return commandVerbs(e.detail ?? "", opts).some((v) => external.has(v)) ? "external" : "local";
  }
  return "local";
}

/** Verbless-command suffix: `tool:?`. Equal keys ending in this never count as the SAME approach. */
const VERBLESS = "?";

/** Same approach iff the keys are equal AND not the verbless sentinel (so `Bash:?` never aliases). */
function sameApproach(a: string, b: string): boolean {
  return a === b && !a.endsWith(`:${VERBLESS}`);
}

/** True iff an approach-key is the verbless sentinel (never a meaningful resolver). */
function isVerbless(key: string): boolean {
  return key.endsWith(`:${VERBLESS}`);
}

// ─── pattern detection (ADR-0027 §4) ──────────────────────────────────────────

type Tool = Extract<ObserveEvent, { type: "tool_use" }>;

/** The cost-to-re-derive multiplier for an external arc (ADR-0027 §7; provisional, gate-tuned). */
export const EXTERNAL_COST_WEIGHT = 2;

/**
 * Claude Code "tool-protocol" failures: the harness scolding you for using a tool wrong, NOT
 * a domain problem (Phase 0's #1 noise source). DROPPED as non-failures. CLAUDE-CODE ADAPTER
 * PROFILE (ADR-0027 §8) — relocate into the ADR-0017 adapter at integration; a different
 * harness supplies its own via {@link FrictionOpts.protocolPatterns}.
 */
export const DEFAULT_PROTOCOL_PATTERNS: readonly RegExp[] = [
  /file has not been read yet/i,
  /string to replace was not found/i,
  /has been (unexpectedly )?modified/i,
  /found \d+ matches? of the (string|text) to replace/i,
  /old_string.*not found/i,
  /no such tool/i,
  /input validation error/i,
];

/**
 * Boilerplate tokens excluded from the same-intent topic link + grind dominance (too generic
 * to mean "same thing"). CLAUDE-CODE/dev ADAPTER PROFILE — overridable via
 * {@link FrictionOpts.topicStopwords} (ADR-0027 §8).
 */
export const DEFAULT_TOPIC_STOPWORDS: ReadonlySet<string> = new Set([
  "error", "errors", "failed", "failure", "cannot", "command", "file", "files", "line", "lines",
  "code", "exit", "status", "value", "string", "object", "true", "false", "null", "undefined",
  "this", "that", "then", "with", "from", "have", "your", "will", "into", "such", "found", "match",
  "name", "path", "type", "must", "does", "node", "test", "tests", "warning",
]);

/** Tuning + portability knobs for the detector (ADR-0027 §6–§8). */
export interface FrictionOpts extends KeyOpts {
  /** Look-ahead window in tool_use steps for a pivot after a failure. Default 8. */
  window?: number;
  /** Harness protocol-rule error patterns DROPPED as non-failures. Default: Claude Code. */
  protocolPatterns?: readonly RegExp[];
  /** Min token length for the same-intent topic link. Default 4. */
  minTopicLen?: number;
  /** Boilerplate tokens excluded from the topic link + grind. Default {@link DEFAULT_TOPIC_STOPWORDS}. */
  topicStopwords?: ReadonlySet<string>;
  /** Enable pattern C (grind). OFF by default — its own sub-switch so the gate scores A+B vs A+B+C (ADR-0027 §4). */
  grind?: boolean;
  /** Min tool_uses sharing one topic to count as a grind. Default 5. */
  grindMin?: number;
  /** Min fraction of a grind span's tool_uses that must share the dominant topic. Default 0.5. */
  grindDensity?: number;
}

/** A compact/session_end terminator — the chapter boundary (mirrors reader.ts). */
function isTerminator(e: ObserveEvent): boolean {
  return e.type === "compact" || e.type === "session_end";
}

/** Index just past the LAST terminator; 0 if the stream has none (the in-flight tail is deferred). */
function closedCount(events: ObserveEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) return i + 1;
  }
  return 0;
}

/** True iff a failure's message is a harness protocol rule (never a domain lesson). */
function isProtocolFailure(e: Tool, patterns: readonly RegExp[]): boolean {
  const msg = `${e.error_summary ?? ""} ${e.detail ?? ""}`;
  return patterns.some((re) => re.test(msg));
}

/** Salient ≥minLen, non-boilerplate tokens from an event's text + paths (the topic fingerprint). */
function topicsOf(e: Tool, minLen: number, stopwords: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const parts = [e.detail ?? "", e.error_summary ?? "", ...e.paths];
  for (const part of parts) {
    for (const raw of part.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= minLen && !stopwords.has(raw)) out.add(raw);
    }
  }
  return out;
}

/** The first token shared by two topic sets — the same-intent link (null if none). */
function sharedTopic(a: Set<string>, b: Set<string>): string | null {
  for (const t of a) if (b.has(t)) return t;
  return null;
}

/** A salient tool one-liner for the arc signals (`tool: detail | paths`). */
function toolLine(e: Tool): string {
  const body = e.detail && e.detail.trim().length > 0 ? e.detail : e.paths.join(",");
  return `${e.tool}: ${body}`.trim();
}

/** Build one arc's signals from ONLY its span — this is what fixes the chapter grab-bag. */
function spanSignals(span: ObserveEvent[]): DistillCluster["signals"] {
  const prompts: string[] = [];
  const corrections: string[] = [];
  const failures: string[] = [];
  const tools: string[] = [];
  let prevType: ObserveEvent["type"] | null = null;
  for (const e of span) {
    if (e.type === "user_prompt") {
      prompts.push(e.text);
      if (prevType === "tool_use") corrections.push(e.text);
      prevType = "user_prompt";
    } else if (e.type === "tool_use") {
      if (e.ok === false) failures.push(e.error_summary ?? e.detail ?? `${e.tool} failed`);
      if (e.ok === false || (e.detail && e.detail.trim().length > 0) || e.paths.length > 0) {
        tools.push(toolLine(e));
      }
      prevType = "tool_use";
    } else if (e.type === "skill_load" || e.type === "session_start" || e.type === "assistant_msg") {
      prevType = e.type;
    }
  }
  return { prompts, corrections, failures, tools };
}

/** A deterministic note-type hint scoped to the arc (not the chapter). */
function hintForArc(arc: Pick<FrictionArc, "pattern" | "tried" | "worked">): string {
  switch (arc.pattern) {
    case "failure-pivot":
      return `a failure resolved by a different approach (tried \`${arc.tried}\`, \`${arc.worked}\` worked) — likely a gotcha`;
    case "correction-reset":
      return "a user correction that changed the approach — likely a preference/principle";
    case "grind":
      return "concentrated effort on one topic — likely a hard-won procedure";
  }
}

/** Assemble a {@link FrictionArc} over `[onset, resolution]` (0-based indices into `events`). */
function buildArc(
  pattern: FrictionPattern,
  events: ObserveEvent[],
  onset: number,
  resolution: number,
  tried: string | null,
  worked: string | null,
  topic: string | null,
  opts: FrictionOpts,
): FrictionArc {
  const span = events.slice(onset, resolution + 1);
  const toolEvents = span.filter((e) => e.type === "tool_use");
  const externality: Externality = toolEvents.some((e) => toolExternality(e, opts) === "external")
    ? "external"
    : "local";
  // Cost = ACTIONS taken (tool_uses), not raw events — so verbose prose in the span can't
  // inflate the re-derivation proxy (ADR-0027 §7). At least 1.
  const steps = Math.max(1, toolEvents.length);
  const cost = steps * (externality === "external" ? EXTERNAL_COST_WEIGHT : 1);
  const head = events[onset];
  return {
    session: head?.session ?? "",
    span: `L${onset + 1}-L${resolution + 1}`,
    signals: spanSignals(span),
    hint: hintForArc({ pattern, tried, worked }),
    pattern,
    onset: onset + 1,
    resolution: resolution + 1,
    tried,
    worked,
    topic,
    cost,
    externality,
  };
}

/**
 * Detect failure→pivot arcs (pattern A) within one chapter `[start, end)`. A non-protocol
 * failure with approach-key `Kf` is resolved when, within `window` tool_use steps, a tool_use
 * with a DIFFERENT key succeeds AND shares a topic with the failure. A same-key success is a
 * retry (drop); consecutive same-key failures collapse to one onset; a different-key success
 * with no shared topic is skipped (keep scanning). Resolved arcs are non-overlapping
 * (outermost-wins): scanning resumes past the resolution.
 */
function detectFailurePivots(
  events: ObserveEvent[],
  start: number,
  end: number,
  opts: FrictionOpts,
  out: FrictionArc[],
): void {
  const window = opts.window ?? 8;
  const protocol = opts.protocolPatterns ?? DEFAULT_PROTOCOL_PATTERNS;
  const minLen = opts.minTopicLen ?? 4;
  const stopwords = opts.topicStopwords ?? DEFAULT_TOPIC_STOPWORDS;

  const tus: { e: Tool; idx: number }[] = [];
  for (let k = start; k < end; k++) {
    const e = events[k];
    if (e !== undefined && e.type === "tool_use") tus.push({ e, idx: k });
  }

  let p = 0;
  while (p < tus.length) {
    const f = tus[p];
    if (f === undefined || f.e.ok !== false || isProtocolFailure(f.e, protocol)) {
      p++;
      continue;
    }
    const kf = approachKey(f.e, opts);
    const fTopics = topicsOf(f.e, minLen, stopwords);
    let resolvedIdx = -1;
    let resolveCursor = -1; // `tus` position of the resolver (advances p)
    let worked = "";
    let link: string | null = null;
    let retried = false;
    let runEnd = p; // last position of the consecutive same-key failure run (onset stays at p)
    let steps = 0; // look-ahead budget — only NON-same-key steps count (retries don't burn it)

    for (let q = p + 1; q < tus.length; q++) {
      const s = tus[q];
      if (s === undefined) continue;
      const ks = approachKey(s.e, opts);
      if (sameApproach(ks, kf)) {
        if (s.e.ok === true) {
          retried = true; // same-approach retry succeeded → not friction
          break;
        }
        runEnd = q; // same-approach repeated failure → collapse; onset stays at the FIRST (p)
        continue;
      }
      steps += 1;
      if (steps > window) break; // pivot not found within the window
      if (s.e.ok === true && !isVerbless(ks)) {
        const l = sharedTopic(fTopics, topicsOf(s.e, minLen, stopwords));
        if (l !== null) {
          resolveCursor = q;
          resolvedIdx = s.idx;
          worked = ks;
          link = l;
          break;
        }
      }
      // different-key (failure, unlinked success, or verbless): keep scanning within the window
    }

    if (!retried && resolveCursor >= 0) {
      out.push(buildArc("failure-pivot", events, f.idx, resolvedIdx, kf, worked, link, opts));
      p = resolveCursor + 1; // outermost-wins: resume past the resolution
    } else {
      p = runEnd + 1; // unresolved (or a retry): skip the whole same-key run, never re-anchor
    }
  }
}

/**
 * Detect correction→reset arcs (pattern B) within one chapter. A `user_prompt` whose nearest
 * preceding act was a `tool_use` is a CORRECTION (the reader's adjacency, ADR-0018; an
 * intervening `assistant_msg` does NOT break it). If the agent's NEXT tool_use changes the
 * approach-key, that's a course-change → an arc (tried = the corrected key, worked = the new
 * key). No topic link is required — the human prompt IS the intent (ADR-0027 §4, B ranks above A).
 */
function detectCorrectionResets(
  events: ObserveEvent[],
  start: number,
  end: number,
  opts: FrictionOpts,
  out: FrictionArc[],
): void {
  const protocol = opts.protocolPatterns ?? DEFAULT_PROTOCOL_PATTERNS;
  let prevType: ObserveEvent["type"] | null = null;
  let prevToolIdx = -1;
  let prevToolKey = "";
  for (let i = start; i < end; i++) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.type === "tool_use") {
      prevToolIdx = i;
      prevToolKey = approachKey(e, opts);
      prevType = "tool_use";
      continue;
    }
    if (e.type === "user_prompt") {
      if (prevType === "tool_use" && prevToolIdx >= 0) {
        for (let j = i + 1; j < end; j++) {
          const s = events[j];
          if (s === undefined) continue;
          if (s.type === "user_prompt") break; // a fresh prompt: this correction had no action
          if (s.type !== "tool_use") continue; // skip assistant_msg / skill_load between
          if (s.ok === false && isProtocolFailure(s, protocol)) continue; // protocol noise: not a real choice
          // The agent's first REAL post-correction action. `worked` must be a SUCCESS with a
          // different approach (review finding #2 — a failing/protocol action is not "what worked").
          const ks = approachKey(s, opts);
          if (s.ok === true && !sameApproach(ks, prevToolKey) && !isVerbless(ks)) {
            out.push(buildArc("correction-reset", events, prevToolIdx, j, prevToolKey, ks, null, opts));
          }
          break; // a real action (success or genuine failure) ends the search
        }
      }
      prevType = "user_prompt";
      continue;
    }
    // skill_load / session_start break the adjacency; assistant_msg + terminators leave it (ADR-0018).
    if (e.type === "skill_load" || e.type === "session_start") prevType = e.type;
  }
}

/**
 * Detect grind arcs (pattern C, ADR-0027 §4) within one chapter — concentrated effort on ONE
 * topic, NO error required (the "extra steps, then the simpler way" case). Fires only when a
 * single topic token dominates a span (≥ grindMin tool_uses AND ≥ grindDensity of the span's
 * tool_uses), which is what distinguishes a focused grind from a whole-chapter grab-bag. At
 * most one grind per chapter. Overlap with A/B arcs is NOT resolved here — `rankArcs` is the
 * single place that suppresses overlapping arcs by score (review finding #19).
 */
function detectGrinds(
  events: ObserveEvent[],
  start: number,
  end: number,
  opts: FrictionOpts,
  out: FrictionArc[],
): void {
  const grindMin = opts.grindMin ?? 5;
  const minDensity = opts.grindDensity ?? 0.5;
  const minLen = opts.minTopicLen ?? 4;
  const stopwords = opts.topicStopwords ?? DEFAULT_TOPIC_STOPWORDS;

  const tus: { idx: number; topics: Set<string> }[] = [];
  for (let k = start; k < end; k++) {
    const e = events[k];
    if (e !== undefined && e.type === "tool_use") {
      tus.push({ idx: k, topics: topicsOf(e, minLen, stopwords) });
    }
  }
  if (tus.length < grindMin) return;

  const freq = new Map<string, number>();
  for (const t of tus) for (const tok of t.topics) freq.set(tok, (freq.get(tok) ?? 0) + 1);

  let best = "";
  let bestCount = 0;
  for (const [tok, c] of freq) {
    if (c > bestCount) {
      best = tok;
      bestCount = c;
    }
  }
  if (bestCount < grindMin) return;

  const withTok = tus.filter((t) => t.topics.has(best));
  const firstT = withTok[0];
  const lastT = withTok[withTok.length - 1];
  if (firstT === undefined || lastT === undefined) return;
  const first = firstT.idx;
  const last = lastT.idx;

  const inSpan = tus.filter((t) => t.idx >= first && t.idx <= last).length;
  if (inSpan === 0 || bestCount / inSpan < minDensity) return; // not dominant → a grab-bag, not a grind

  out.push(buildArc("grind", events, first, last, null, null, best, opts));
}

/**
 * The detector (ADR-0027 §4). A PURE fold over a session's events: chop the CLOSED region at
 * terminators (chapters, mirroring the distill reader), and within each chapter surface
 * friction arcs — A (failure→pivot) and B (correction→reset) always, C (grind) only when the
 * sub-switch is on. Returns arcs in source order; they MAY overlap — `rankArcs` is the required
 * next stage that scores, dedups overlaps, and caps (ADR-0027 §5, §7).
 */
export function computeFrictionArcs(events: ObserveEvent[], opts: FrictionOpts = {}): FrictionArc[] {
  const closed = closedCount(events);
  const arcs: FrictionArc[] = [];
  let start = 0;
  for (let i = 0; i < closed; i++) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) {
      const chapter: FrictionArc[] = [];
      detectFailurePivots(events, start, i, opts, chapter);
      detectCorrectionResets(events, start, i, opts, chapter);
      if (opts.grind === true) detectGrinds(events, start, i, opts, chapter);
      arcs.push(...chapter);
      start = i + 1;
    }
  }
  return arcs;
}

// ─── ranking (ADR-0027 §7 — confidence tiers + a cost bonus) ──────────────────

/** Tier bases + spacing (provisional, gate-tuned, ADR-0027 §7). A correction outranks an env-error, etc. */
export const TIER_CORRECTION = 200;
export const TIER_ENV_FAILURE = 100;
/** Tier spacing. The cost bonus SATURATES below this, so a big grind/generic can never leap a tier. */
export const TIER_GAP = 100;

/**
 * Environmental-error signatures: failures whose knowledge RECURS and is worth a note (an
 * auth wall, a connection problem, a missing tool). DEFAULT set — overridable per harness
 * (ADR-0027 §8). Matched against an arc's span failures to lift it into the env tier.
 */
export const DEFAULT_ENV_ERROR_PATTERNS: readonly RegExp[] = [
  /\b40[13]\b/, // 401 / 403
  /\b5\d\d\b/, // 5xx
  /forbidden/i,
  /unauthorized/i,
  /permission denied/i,
  /econnrefused/i,
  /enotfound/i,
  /etimedout/i,
  /timed out|timeout/i,
  /connection (refused|reset)/i,
  /command not found/i,
  /rate limit/i,
  /quota/i,
];

/** Ranking knobs (extends the detector opts so one options object threads through). */
export interface RankOpts extends FrictionOpts {
  /** Environmental-error patterns that lift a failure-pivot into the env tier. Default: above. */
  envErrorPatterns?: readonly RegExp[];
  /** Max arcs to surface after ranking + dedup (the nudge cap). Default: unbounded. */
  cap?: number;
}

/** True iff any of the arc's span failures looks environmental (recurs → worth a note). */
function isEnvFailure(arc: FrictionArc, patterns: readonly RegExp[]): boolean {
  return arc.signals.failures.some((f) => patterns.some((re) => re.test(f)));
}

/**
 * The hybrid score (ADR-0027 §7): a confidence-tier BASE plus a SATURATING cost bonus, so a
 * sharp correction always tops an env-gotcha which always tops a generic/grind (hard
 * invariants — the cost can lift WITHIN a tier but never leap one), while within a tier the
 * harder-fought arc wins. `cost = actions × externality` (the thesis re-derivation proxy).
 */
export function rankScore(arc: FrictionArc, patterns: readonly RegExp[] = DEFAULT_ENV_ERROR_PATTERNS): number {
  let base = 0;
  if (arc.pattern === "correction-reset") base = TIER_CORRECTION;
  else if (arc.pattern === "failure-pivot" && isEnvFailure(arc, patterns)) base = TIER_ENV_FAILURE;
  return base + Math.min(arc.cost, TIER_GAP - 1); // saturate so tiers stay strict
}

/** Two arcs overlap iff their event spans intersect. */
function overlaps(x: FrictionArc, y: FrictionArc): boolean {
  return x.onset <= y.resolution && y.onset <= x.resolution;
}

/**
 * Rank arcs strongest-first and greedily keep NON-overlapping ones (outermost/highest-score
 * wins — a correction-reset suppresses a failure-pivot describing the same moment), capped to
 * `cap`. Ties keep source order (stable). This is the attention-direction step; the agent
 * still judges what survives (ADR-0027 §1, §5).
 */
export function rankArcs(arcs: FrictionArc[], opts: RankOpts = {}): FrictionArc[] {
  const patterns = opts.envErrorPatterns ?? DEFAULT_ENV_ERROR_PATTERNS;
  const scored = arcs
    .map((arc, i) => ({ arc, score: rankScore(arc, patterns), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const kept: FrictionArc[] = [];
  for (const { arc } of scored) {
    if (kept.some((k) => overlaps(k, arc))) continue; // a higher-scored arc already covers this span
    kept.push(arc);
    if (opts.cap !== undefined && kept.length >= opts.cap) break;
  }
  return kept;
}
