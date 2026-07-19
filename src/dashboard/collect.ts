// The dashboard data COLLECTOR (ADR-0020 — per-KB, no-server, local files only).
//
// Reads ONLY the local files of ONE resolved knowledge base and folds them into a
// fully-typed {@link DashboardData} snapshot. It NEVER fetches remote content
// (ADR-0020 §4) and is KB-directory-agnostic (ADR-0020 §5): the caller (the
// command) resolves the KB dir; this function takes `{ root, kind }` and reads
// from `root`. The same code therefore runs locally now and server-side later.
//
// GRACEFUL DEGRADATION is the load-bearing invariant: every optional source —
// the context-match rollup, the proposal queue, the recurrence tally, the
// `.learnings/` scratch, git, and hub metadata — FAILS OPEN. A brand-new KB with
// only a couple of notes and NO `.metrics/` yet still yields a valid snapshot
// (empty proposals[], zeroed kpis, ladder.scratch === 0). The collector never
// throws on a missing/corrupt optional source.
//
// It REUSES the canonical readers/detectors rather than reimplementing them:
//   - scanNotes (scan.ts)              → notes[], wings[], counts
//   - readRollup + summarize (rollup)  → skills[] + the whole-KB context-match %
//   - readProposals (grooming)         → the hero "Awaiting your judgment" queue
//   - readTally (grooming)             → the durability-ladder "climbing" rungs
//   - analyzeDream (dream.ts)          → health (stale / dangling / orphan)
//   - HubProject (paths.ts)            → registry[] pointers (hub only)

import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { analyzeDream } from "../dream.js";
import { logger } from "../logger.js";
import type { Proposal } from "../grooming/types.js";
import { readProposals } from "../grooming/proposals.js";
import { type KeepRateLedger, readKeepRateLedger, summarizeKeepRate } from "../grooming/reconcile.js";
import { readTally } from "../grooming/tally.js";
import { readRollup, summarize } from "../metrics/rollup.js";
import { readNote, type NoteFrontmatter } from "../note.js";
import {
  type HubMetadata,
  type HubProject,
  exists,
  learningsPath,
  readHubMetadata,
} from "../paths.js";
import { run } from "../shell.js";
import { type ScannedNote, scanNotes } from "../scan.js";
import { mageVersion } from "../version.js";
import type {
  DashboardActivity,
  DashboardCommit,
  DashboardData,
  DashboardKeepRate,
  DashboardGraphEdge,
  DashboardGraphNode,
  DashboardLadderClimb,
  DashboardNote,
  DashboardProposal,
  DashboardRegistryEntry,
  DashboardSkill,
  DashboardWing,
  ProposalKind,
} from "./types.js";

/** Default staleness window (days) for "due for review", matching `mage dream`. */
const DEFAULT_STALE_DAYS = 180;
/** Preview-scale graph cap: keep the embedded graph small enough to inline. */
const MAX_GRAPH_NODES = 250;
/** Preview-scale edge cap (deterministic prefix after a stable sort). */
const MAX_GRAPH_EDGES = 600;

/** The already-resolved KB the collector reads. The COMMAND resolves this. */
export interface DashboardKb {
  /** Absolute docs root (a repo `mage/` or a hub root). */
  root: string;
  kind: "repo" | "hub";
}

/** Collector knobs — all optional; `now` is injectable for deterministic tests. */
export interface CollectOptions {
  /** Override the reported mage version (defaults to the runtime `mageVersion()`). */
  mageVersion?: string;
  /** Staleness window for "due for review" (defaults to 180, matching dream). */
  staleDays?: number;
  /** Reference instant — `lastRefreshed` uses this; defaults to wall-clock `new Date()`. */
  now?: Date;
}

/**
 * Collect a {@link DashboardData} snapshot for one resolved KB. Reads local files
 * only; every optional source fails open. `lastRefreshed` is `opts.now` when
 * provided, else the runtime wall-clock instant — both serialized via
 * `toISOString()` so the snapshot round-trips through JSON.
 */
export async function collectDashboardData(
  kb: DashboardKb,
  opts: CollectOptions = {},
): Promise<DashboardData> {
  const { root, kind } = kb;
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const version = opts.mageVersion ?? mageVersion();

  // ── the spine: the note scan (the only REQUIRED source). ──
  const notes = await scanNotes(root);

  // ── hub metadata (fail-open) → registry pointers + dream's project-drift input. ──
  const hubMeta = kind === "hub" ? await readHubMetadataSafe(root) : null;

  // ── every optional metrics source, each fail-open in its own reader. ──
  const [rollup, proposals, tally, scratch, lastCommit, dream, keepLedger] = await Promise.all([
    readRollup(root), // fail-open → empty rollup
    readProposals(root), // fail-open → []
    readTally(root), // fail-open → empty tally
    countScratch(learningsPath(root)), // fail-open → 0
    lastCommitOf(root), // fail-open → null
    analyzeDream(root, { now, staleDays, hubMeta }), // pure fs; reuses scan internally
    readKeepRateLedger(root), // fail-open → empty ledger (READ-only; the nudge reconciles/writes)
  ]);
  const keepRate = toDashboardKeepRate(keepLedger);

  const dashNotes = notes.map(toDashboardNote);
  const skills = summarizeSkills(rollup);
  const wings = buildWings(notes, skills);
  const contextMatchPct = wholeKbContextMatchPct(rollup);
  const graduateReady = proposals.filter((p) => p.action === "graduate").length;

  return {
    meta: {
      kbName: kbName(kind, root, hubMeta),
      kind,
      root,
      mageVersion: version,
      lastRefreshed: now.toISOString(),
    },
    kpis: {
      notes: notes.length,
      skills: skills.length,
      wings: wings.length,
      contextMatchPct,
      awaitingYou: proposals.length,
      graduateReady,
    },
    proposals: proposals.map(toDashboardProposal),
    wings,
    notes: dashNotes,
    skills,
    graph: await buildGraph(root, notes),
    activity: await buildActivity(root, notes),
    ladder: {
      scratch,
      notes: notes.length,
      skills: skills.length,
      climbing: climbingFrom(tally),
    },
    health: {
      notesDueForReview: dream.stale.length,
      danglingLinks: dream.danglingLinks.length,
      orphanNotes: dream.orphans.length,
      lastCommit,
    },
    ...(kind === "hub" ? { registry: await buildRegistry(hubMeta) } : {}),
    ...(keepRate ? { keepRate } : {}),
  };
}

/**
 * Project the reject-ledger into the dashboard tile (ADR-0031 P2) — the capture-only crown
 * signal, mirroring {@link summarizeKeepRate}. Returns null (tile hidden) when there are no
 * capture terminals yet. The threshold is left null here (the nudge line renders the configured
 * value; the dashboard read-path doesn't plumb the repo config).
 */
function toDashboardKeepRate(ledger: KeepRateLedger): DashboardKeepRate | null {
  const { capture } = summarizeKeepRate(ledger);
  if (capture.terminals < 1) return null;
  return {
    rate: capture.rate,
    terminals: capture.terminals,
    keep: capture.keep,
    edited: capture.edited,
    discard: capture.discard,
    reject: capture.reject,
    threshold: null,
  };
}

// ─── notes / wings ───────────────────────────────────────────────────────────

function toDashboardNote(n: ScannedNote): DashboardNote {
  return {
    title: n.title,
    type: n.type,
    wing: n.wing,
    room: n.room,
    // Every tag-wing (multi-home, ADR-0012 §5) so a renderer can list this note
    // under each of its wings, not just the primary. Mirrors index-cmd.
    wings: n.wings,
    keywords: n.keywords,
    status: n.status,
    lastReviewed: n.lastReviewed,
    relPath: n.relPath,
    // obsidian://open?file=<vault-relative path> — the vault-relative path IS the
    // docs-root-relative relPath (the docs root is the vault root).
    obsidianFile: n.relPath,
  };
}

/**
 * Derive the wings from the UNION of every note's tag-wings (multi-home,
 * ADR-0012 §5), mirroring `mage index`. noteCount counts every note tagged under
 * the wing; rooms are that wing's distinct rooms (sorted). skillCount attributes
 * each skill to its wing.
 */
function buildWings(notes: ScannedNote[], skills: DashboardSkill[]): DashboardWing[] {
  const names = [...new Set(notes.flatMap((n) => n.wings.map((w) => w.wing)))].sort();
  const skillCountByWing = new Map<string, number>();
  for (const s of skills) {
    if (!s.wing) continue;
    skillCountByWing.set(s.wing, (skillCountByWing.get(s.wing) ?? 0) + 1);
  }
  return names.map((name) => {
    const inWing = notes.filter((n) => n.wings.some((w) => w.wing === name));
    const rooms = [...new Set(inWing.map((n) => roomForWing(n, name)).filter((r) => r !== ""))].sort();
    return {
      name,
      noteCount: inWing.length,
      skillCount: skillCountByWing.get(name) ?? 0,
      ...(rooms.length > 0 ? { rooms } : {}),
    };
  });
}

/** The room a note occupies within a given wing (mirrors index-cmd.roomForWing). */
function roomForWing(n: ScannedNote, wing: string): string {
  return n.wings.find((w) => w.wing === wing)?.room ?? "";
}

// ─── skills + context-match (rollup) ──────────────────────────────────────────

/**
 * Project the rollup's advisory rows into dashboard skill rows. Each skill's
 * `wing` is its first keyword segment when it looks like a `wing/room` skill name
 * (best-effort; absent otherwise). `contextMatchPct` is the rounded match rate.
 */
function summarizeSkills(rollup: Parameters<typeof summarize>[0]): DashboardSkill[] {
  return summarize(rollup).map((row) => ({
    name: row.skill,
    ...(skillWing(row.skill) !== undefined ? { wing: skillWing(row.skill) } : {}),
    contextMatchPct: Math.round(row.matchRate * 100),
    status: row.status,
  }));
}

/** Best-effort wing for a skill name shaped like `wing:room` or `wing/room`. */
function skillWing(name: string): string | undefined {
  const seg = name.split(/[:/]/)[0];
  return seg && seg !== name ? seg : undefined;
}

/** The whole-KB context-match rate as a 0–100 percentage (0 when no loads yet). */
function wholeKbContextMatchPct(rollup: Parameters<typeof summarize>[0]): number {
  let loads = 0;
  let matches = 0;
  for (const stat of Object.values(rollup.skills)) {
    loads += stat.loads;
    matches += stat.matches;
  }
  return loads === 0 ? 0 : Math.round((matches / loads) * 100);
}

// ─── proposals (hero queue) ───────────────────────────────────────────────────

function toDashboardProposal(p: Proposal): DashboardProposal {
  const wing = typeof p.payload.wing === "string" ? p.payload.wing : undefined;
  return {
    kind: p.action as ProposalKind,
    target: p.target,
    why: p.evidence,
    ...(wing !== undefined ? { wing } : {}),
    evidence: p.evidence,
  };
}

// ─── ladder (recurrence tally → climbing rungs) ───────────────────────────────

/**
 * Bucket the tally's signatures by their distinct-session recurrence count and
 * return "N signatures at K sessions" rungs, descending by session count. Only
 * signatures that have recurred (sessions >= 2) are shown — a one-off is not yet
 * "climbing". Fail-open: an empty tally yields [].
 */
function climbingFrom(tally: Awaited<ReturnType<typeof readTally>>): DashboardLadderClimb[] {
  const countBySessions = new Map<number, number>();
  for (const stat of Object.values(tally.notes)) {
    if (stat.chapters < 2) continue;
    countBySessions.set(stat.chapters, (countBySessions.get(stat.chapters) ?? 0) + 1);
  }
  return [...countBySessions.entries()]
    .map(([sessions, count]) => ({ sessions, count }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ─── scratch tally (.learnings/*.jsonl line count) ────────────────────────────

/**
 * Cheaply count scratch EVENTS = non-empty lines across the top-level
 * `.learnings/*.jsonl` full streams (excluding `*.skills.jsonl` sidecars and the
 * `.archive` subdir, mirroring rollup/tally enumeration). No content parsing — a
 * line tally is enough for the ladder's "scratch" rung. Fail-open → 0.
 */
async function countScratch(learningsDir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(learningsDir, { withFileTypes: true });
  } catch {
    return 0; // no `.learnings/` yet → cold KB.
  }
  let total = 0;
  for (const ent of entries) {
    if (!ent.isFile()) continue; // skip the `.archive` subdir.
    const name = ent.name;
    if (name.endsWith(".skills.jsonl")) continue; // sidecar — ordered FIRST.
    if (!name.endsWith(".jsonl")) continue;
    total += await countLines(join(learningsDir, name));
  }
  return total;
}

/** Count non-empty lines in a file; fail-open to 0 on any read error. */
async function countLines(path: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length > 0) n += 1;
  }
  return n;
}

// ─── graph (note-to-note markdown links) ──────────────────────────────────────

/** Strip fenced + inline code so example links are never treated as real edges. */
function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/** All relative markdown links to `.md` targets, as written (mirrors dream.ts). */
function extractLinks(body: string): string[] {
  const out: string[] = [];
  const re = /\]\(([^)]+\.md)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

/** Resolve a link target to a root-relative posix path (mirrors dream.ts). */
function resolveRel(noteRel: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(noteRel), target));
}

/**
 * Build the preview-scale note-to-note link graph. Nodes are notes (capped);
 * edges are note→note markdown links that resolve to another scanned note (both
 * endpoints in the kept node set), deduped and capped. Deterministic: nodes follow
 * the scan's sorted order; edges are sorted before capping. A note that can't be
 * read contributes no edges (fail-open) but still appears as a node.
 */
async function buildGraph(
  root: string,
  notes: ScannedNote[],
): Promise<{ nodes: DashboardGraphNode[]; edges: DashboardGraphEdge[] }> {
  const kept = notes.slice(0, MAX_GRAPH_NODES);
  const keptSet = new Set(kept.map((n) => n.relPath));
  const nodes: DashboardGraphNode[] = kept.map((n) => ({ id: n.relPath, wing: n.wing }));

  const seen = new Set<string>();
  const edges: DashboardGraphEdge[] = [];
  for (const n of kept) {
    let body: string;
    try {
      body = (await readNote(join(root, n.relPath))).body;
    } catch {
      continue; // unreadable note → no edges (fail-open).
    }
    for (const target of extractLinks(stripCode(body))) {
      const resolved = resolveRel(n.relPath, target);
      if (resolved === n.relPath || !keptSet.has(resolved)) continue; // self/off-graph.
      const id = `${n.relPath} ${resolved}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ source: n.relPath, target: resolved });
    }
  }

  edges.sort(
    (a, b) =>
      (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
      (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
  );
  return { nodes, edges: edges.slice(0, MAX_GRAPH_EDGES) };
}

// ─── activity (created / updated / last_reviewed dates) ───────────────────────

/** Coerce a frontmatter date value to an ISO date (YYYY-MM-DD), or null. */
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || v.trim().length === 0) return null;
  const d = new Date(v.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Build the per-day activity series from each note's frontmatter dates: `created`
 * increments the created tally; `updated` OR `last_reviewed` (preferring updated)
 * increments the reviewed tally. Days with no signal are omitted; the series is
 * sorted ascending by date. Each note body is already on disk; we read the
 * frontmatter via `readNote` (fail-open per note). scan exposes lastReviewed but
 * not created/updated, so we read frontmatter here.
 */
async function buildActivity(root: string, notes: ScannedNote[]): Promise<DashboardActivity[]> {
  const created = new Map<string, number>();
  const reviewed = new Map<string, number>();
  for (const n of notes) {
    let fm: NoteFrontmatter;
    try {
      fm = (await readNote(join(root, n.relPath))).frontmatter;
    } catch {
      continue; // unreadable → contributes no activity (fail-open).
    }
    const c = isoDate(fm.created);
    if (c) created.set(c, (created.get(c) ?? 0) + 1);
    const r = isoDate(fm.updated) ?? isoDate(fm.last_reviewed) ?? isoDate(n.lastReviewed);
    if (r) reviewed.set(r, (reviewed.get(r) ?? 0) + 1);
  }
  const days = [...new Set([...created.keys(), ...reviewed.keys()])].sort();
  return days.map((date) => ({
    date,
    created: created.get(date) ?? 0,
    reviewed: reviewed.get(date) ?? 0,
  }));
}

// ─── git last commit (fail-open) ──────────────────────────────────────────────

/**
 * The repo's last commit (hash + ISO instant) for the provenance stamp. Reads via
 * `git log -1` rooted at the docs root. Fail-open → null when git is missing, the
 * dir is not a repo, or there are no commits yet.
 */
async function lastCommitOf(root: string): Promise<DashboardCommit | null> {
  try {
    // %H = full hash, %cI = committer date strict ISO-8601. Neither contains a
    // space, so a single-space separator parses cleanly.
    const r = await run("git", ["-C", root, "log", "-1", "--pretty=format:%H %cI"]);
    if (r.code !== 0) return null;
    const out = r.stdout.trim();
    if (out.length === 0) return null;
    const [hash, when] = out.split(" ");
    if (!hash || !when) return null;
    return { hash, when };
  } catch {
    return null; // git not installed / spawn failure → no commit stamp.
  }
}

// ─── hub metadata + registry pointers (hub only) ──────────────────────────────

/**
 * Read hub metadata, fail-open to null (never throws on a missing/corrupt file).
 * A missing file (ENOENT) stays a SILENT fail-open — a brand-new hub has none.
 * But a PERMISSION error (EPERM/EACCES) is logged: a readable-but-locked metadata
 * file is a real, diagnosable problem, not an empty registry.
 */
async function readHubMetadataSafe(root: string): Promise<HubMetadata | null> {
  try {
    return await readHubMetadata(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      logger.warn(`mage dashboard: could not read hub metadata (${code}); registry will be empty.`);
    }
    return null; // missing/unparseable hub metadata → degrade to "no registry".
  }
}

/**
 * Build the hub registry-pointer rows (ADR-0020 §4) — names, repo URLs, local
 * code paths, and a cheap `cloned` presence check. POINTERS only; never remote
 * content. Empty when there's no hub metadata.
 */
async function buildRegistry(hubMeta: HubMetadata | null): Promise<DashboardRegistryEntry[]> {
  const projects: HubProject[] = hubMeta?.projects ?? [];
  const rows = await Promise.all(
    projects.map(async (p) => ({
      name: p.name,
      repoUrl: p.code_repo_url ?? "",
      codePath: p.code_repo_path ?? "",
      cloned: p.code_repo_path ? await exists(p.code_repo_path) : false,
    })),
  );
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ─── kb name ──────────────────────────────────────────────────────────────────

/** Display name: the hub's metadata name, or the docs-root basename for a repo KB. */
function kbName(kind: "repo" | "hub", root: string, hubMeta: HubMetadata | null): string {
  if (kind === "hub" && hubMeta?.name) return hubMeta.name;
  // a repo KB's docs root is `<repo>/mage` — use the repo dir's basename as the name.
  const base = basename(root);
  if (base === "mage") {
    const parent = basename(join(root, ".."));
    return parent || base;
  }
  return base;
}
