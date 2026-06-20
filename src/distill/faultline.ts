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
// Harness-specific knowledge stays OUT of here (ADR-0027 §8): the external-verb / skip-verb /
// external-tool sets are DEFAULTS, overridable via opts so another harness brings its own
// without forking the detector. `computeFrictionArcs` (the pattern detection + ranking)
// builds on these in the next slice.

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
  "sudo", "env", "time", "nice", "command", "exec", "eval", "xargs", "nohup", "stdbuf", "watch",
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

/** Overridable knowledge sets — a harness with different tools/CLIs supplies its own. */
export interface KeyOpts {
  externalVerbs?: ReadonlySet<string>;
  wrapperVerbs?: ReadonlySet<string>;
  nullVerbs?: ReadonlySet<string>;
  externalTools?: ReadonlySet<string>;
  pathTools?: ReadonlySet<string>;
}

// ─── command parsing (composite-aware, NOT a shell parser, ADR-0027 §6) ───────

/** Command name from a token: the part after the last `/`, stripped of leading punctuation. */
function cmdName(token: string): string {
  const noPunct = token.replace(/^[({`$]+/, "");
  const slash = noPunct.lastIndexOf("/");
  return slash >= 0 ? noPunct.slice(slash + 1) : noPunct;
}

/** Path stem for a path-tool key: basename without its extension. */
function pathStem(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Split a command into top-level segments at `&&`, `||`, `|`, `;`, and newlines. `||` is
 * matched before a single `|` so a logical-OR is one split, not two. We do NOT parse
 * subshells/heredocs/loops — a mis-split degrades to a coarse key, which is safe under the
 * recall-first stance (ADR-0027 §5: the agent culls).
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
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // FOO=bar prefix
    const name = cmdName(token);
    if (name.length === 0) continue;
    if (wrappers.has(name)) continue; // transparent prefix — the real command follows
    return nulls.has(name) ? null : name; // a trivial standalone command contributes no verb
  }
  return null;
}

/** Every substantive verb in a (possibly composite) command, in order. */
export function commandVerbs(command: string, opts: KeyOpts = {}): string[] {
  const wrappers = opts.wrapperVerbs ?? WRAPPER_VERBS;
  const nulls = opts.nullVerbs ?? NULL_VERBS;
  const verbs: string[] = [];
  for (const seg of splitSegments(command)) {
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
    return first ? `${e.tool}:${pathStem(first)}` : e.tool;
  }
  if (e.tool === "Bash") {
    const verbs = commandVerbs(e.detail ?? "", opts);
    const external = opts.externalVerbs ?? EXTERNAL_VERBS;
    const preferred = verbs.find((v) => external.has(v)) ?? verbs[0];
    return `Bash:${preferred ?? "?"}`;
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
  if (e.tool === "Bash") {
    const external = opts.externalVerbs ?? EXTERNAL_VERBS;
    return commandVerbs(e.detail ?? "", opts).some((v) => external.has(v)) ? "external" : "local";
  }
  return "local";
}

// ─── pattern detection (ADR-0027 §4) ──────────────────────────────────────────

type Tool = Extract<ObserveEvent, { type: "tool_use" }>;

/** The cost-to-re-derive multiplier for an external arc (ADR-0027 §7; provisional, gate-tuned). */
export const EXTERNAL_COST_WEIGHT = 2;

/**
 * Claude Code "tool-protocol" failures: the harness scolding you for using a tool wrong, NOT
 * a domain problem (Phase 0's #1 noise source). DROPPED as non-failures. DEFAULT set — a
 * different harness supplies its own via {@link FrictionOpts.protocolPatterns} (ADR-0027 §8).
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

/** Boilerplate tokens excluded from the same-intent topic link (too generic to mean "same thing"). */
const TOPIC_STOPWORDS: ReadonlySet<string> = new Set([
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
function topicsOf(e: Tool, minLen: number): Set<string> {
  const out = new Set<string>();
  const parts = [e.detail ?? "", e.error_summary ?? "", ...e.paths];
  for (const part of parts) {
    for (const raw of part.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= minLen && !TOPIC_STOPWORDS.has(raw)) out.add(raw);
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
  const externality: Externality = span.some(
    (e) => toolExternality(e, opts) === "external",
  )
    ? "external"
    : "local";
  const spanEvents = resolution - onset + 1;
  const cost = spanEvents * (externality === "external" ? EXTERNAL_COST_WEIGHT : 1);
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

  const tus: { e: Tool; idx: number }[] = [];
  for (let k = start; k < end; k++) {
    const e = events[k];
    if (e !== undefined && e.type === "tool_use") tus.push({ e, idx: k });
  }

  let p = 0;
  while (p < tus.length) {
    const f = tus[p];
    if (f !== undefined && f.e.ok === false && !isProtocolFailure(f.e, protocol)) {
      const kf = approachKey(f.e, opts);
      const fTopics = topicsOf(f.e, minLen);
      let resolvedAt = -1; // position in `tus` (advances p)
      let resolvedIdx = -1; // index in `events` (arc resolution)
      let worked = "";
      let link: string | null = null;
      let retried = false;

      for (let q = p + 1; q < tus.length && q - p <= window; q++) {
        const s = tus[q];
        if (s === undefined) continue;
        const ks = approachKey(s.e, opts);
        if (ks === kf) {
          if (s.e.ok === true) {
            retried = true; // same-approach retry succeeded → not friction
            break;
          }
          continue; // same-approach repeated failure → collapse, keep scanning
        }
        if (s.e.ok === true) {
          const l = sharedTopic(fTopics, topicsOf(s.e, minLen));
          if (l !== null) {
            resolvedAt = q;
            resolvedIdx = s.idx;
            worked = ks;
            link = l;
            break;
          }
        }
        // different-key (failure, or unlinked success): keep scanning within the window
      }

      if (!retried && resolvedAt >= 0) {
        out.push(buildArc("failure-pivot", events, f.idx, resolvedIdx, kf, worked, link, opts));
        p = resolvedAt + 1; // outermost-wins: resume past the resolution
        continue;
      }
    }
    p++;
  }
}

/**
 * The detector (ADR-0027 §4). A PURE fold over a session's events: chop the CLOSED region at
 * terminators (chapters, mirroring the distill reader), and within each chapter surface
 * friction arcs. THIS SLICE: pattern A (failure→pivot) only; B (correction) and C (grind)
 * land next. Returns arcs in source order; ranking is applied downstream (ADR-0027 §7).
 */
export function computeFrictionArcs(events: ObserveEvent[], opts: FrictionOpts = {}): FrictionArc[] {
  const closed = closedCount(events);
  const arcs: FrictionArc[] = [];
  let start = 0;
  for (let i = 0; i < closed; i++) {
    const e = events[i];
    if (e !== undefined && isTerminator(e)) {
      detectFailurePivots(events, start, i, opts, arcs);
      start = i + 1;
    }
  }
  return arcs;
}
