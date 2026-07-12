// The autonomy reject-ledger reconciler (ADR-0031 Phase 2). A deterministic,
// boundary-fired pass that measures the crown signal ADR-0030 named — the
// keep-vs-revert rate on notes the agent authored autonomously. It reads only
// config + git + note frontmatter and merges JSON: NO model (ADR-0009), FAIL-OPEN
// end to end (a broken reconcile never blocks `mage nudge` or the host), and
// IDEMPOTENT (a re-run over unchanged git state never double-counts — the ledger is
// a current-disposition map keyed by note identity, reconciled each pass, not a
// blind append counter). The ledger lives at `.mage/metrics/keep-rate.json`
// (ADR-0025), sibling of the context-match rollup, whose read/write/normalize shape
// this module mirrors.
//
// Each pass enumerates the stamped-autonomous notes under `notes/` (reading
// frontmatter directly — ScannedNote drops provenance), classifies each against its
// git state via {@link noteGitState}, and folds one-way terminal transitions
// (keep / edited / discard / reject) into the ledger. A note reaches a terminal
// state AT MOST ONCE. The keep-rate is reported over `source === "capture"`
// terminals only (the LOCKED inclusion policy — legacy/unmarked + adopt cohorts are
// tracked but excluded, so the headline metric is trustworthy by construction).

import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { getHeadCommit, noteExistsInHead, noteGitState } from "../git.js";
import { parseNote } from "../note.js";
import { NOTES_DIR, metricsPath } from "../paths.js";
import type { Autonomy } from "./autonomy-ladder.js";

// ─── consts ────────────────────────────────────────────────────────────────────

/** Bump when the on-disk ledger shape changes (a fresh empty ledger re-stamps). */
export const KEEP_RATE_VERSION = 1;
/** The single file the reject-ledger lives in, under `.mage/metrics/`. */
export const KEEP_RATE_FILE = "keep-rate.json";

// ─── types ─────────────────────────────────────────────────────────────────────

/** One note's terminal-or-pending disposition (ADR-0031 §7). */
export type NoteDisposition = "pending" | "keep" | "edited" | "discard" | "reject";

/** The per-note record: attribution at first sight + the first-sight body hash + the live state. */
export interface SeenNote {
  /** Authorship level, from `provenance.autonomy` at first sight (only approver/overseer are tracked). */
  autonomy: "approver" | "overseer";
  /** Cohort mark, from `provenance.source` at first sight (absent ⇒ legacy/unmarked). */
  source?: "capture" | "adopt";
  /** HEAD short-sha when first observed (omitted when the repo had no commits then). */
  firstSeenCommit?: string;
  /** sha256 of the note BODY at first sight — the edited-vs-keep discriminator (ADR §7: hash lives here, not in the note). */
  bodyHash: string;
  /** The current disposition; terminal states are one-way (except `discard`, which is reversible). */
  state: NoteDisposition;
  /**
   * True for a note first observed ALREADY committed (`clean`): a `keep` recorded only so re-runs
   * stay no-ops. We never witnessed its keep/revert decision, so it counts toward NEITHER the tally
   * NOR the capture headline — {@link summarizeKeepRate} skips it.
   */
  baseline?: true;
}

/** Per-autonomy-level terminal counts (all sources; the capture rate is derived from `seen`). */
export interface LevelTally {
  keep: number;
  edited: number;
  discard: number;
  reject: number;
}

/** The persisted reject-ledger: a current-disposition map keyed by note path (docs-root-relative). */
export interface KeepRateLedger {
  v: number;
  seen: Record<string, SeenNote>;
  tally: Record<Autonomy, LevelTally>;
}

/** A fresh, empty ledger at the current version (all three levels zeroed). */
export function emptyLedger(): KeepRateLedger {
  return {
    v: KEEP_RATE_VERSION,
    seen: {},
    tally: { operator: zeroTally(), approver: zeroTally(), overseer: zeroTally() },
  };
}

function zeroTally(): LevelTally {
  return { keep: 0, edited: 0, discard: 0, reject: 0 };
}

// ─── paths ─────────────────────────────────────────────────────────────────────

/** The on-disk reject-ledger path under a docs root. */
export function keepRatePath(docsRoot: string): string {
  return join(metricsPath(docsRoot), KEEP_RATE_FILE);
}

// ─── read / normalize / write (fail-open, mirrors metrics/rollup.ts) ─────────────

/**
 * Read the persisted ledger. Missing file (ENOENT) or corrupt JSON → a fresh empty
 * ledger. This is on the boundary-nudge path: it must never throw to the host.
 */
export async function readKeepRateLedger(docsRoot: string): Promise<KeepRateLedger> {
  let raw: string;
  try {
    raw = await readFile(keepRatePath(docsRoot), "utf8");
  } catch {
    return emptyLedger(); // missing (ENOENT) or unreadable → fresh.
  }
  try {
    return normalizeLedger(JSON.parse(raw) as unknown);
  } catch {
    return emptyLedger(); // corrupt JSON → fail-open to fresh.
  }
}

/** Coerce a parsed value into a well-shaped ledger; a version mismatch resets to empty. */
export function normalizeLedger(parsed: unknown): KeepRateLedger {
  if (!isRecord(parsed)) return emptyLedger();
  if (parsed.v !== KEEP_RATE_VERSION) return emptyLedger(); // schema drift → fresh (bump resets).
  const empty = emptyLedger();
  const seen = isRecord(parsed.seen) ? normalizeSeen(parsed.seen) : {};
  const tally = isRecord(parsed.tally) ? normalizeTally(parsed.tally as Record<string, unknown>) : empty.tally;
  return { v: KEEP_RATE_VERSION, seen, tally };
}

function normalizeSeen(raw: Record<string, unknown>): Record<string, SeenNote> {
  const out: Record<string, SeenNote> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    const autonomy = v.autonomy === "approver" || v.autonomy === "overseer" ? v.autonomy : undefined;
    const state = isDisposition(v.state) ? v.state : undefined;
    if (!autonomy || !state || typeof v.bodyHash !== "string") continue; // drop malformed rows.
    out[k] = {
      autonomy,
      state,
      bodyHash: v.bodyHash,
      ...(v.source === "capture" || v.source === "adopt" ? { source: v.source } : {}),
      ...(typeof v.firstSeenCommit === "string" ? { firstSeenCommit: v.firstSeenCommit } : {}),
      ...(v.baseline === true ? { baseline: true as const } : {}),
    };
  }
  return out;
}

function normalizeTally(raw: Record<string, unknown>): Record<Autonomy, LevelTally> {
  const out = { operator: zeroTally(), approver: zeroTally(), overseer: zeroTally() };
  for (const level of ["operator", "approver", "overseer"] as const) {
    const t = raw[level];
    if (!isRecord(t)) continue;
    out[level] = {
      keep: num(t.keep),
      edited: num(t.edited),
      discard: num(t.discard),
      reject: num(t.reject),
    };
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isDisposition(v: unknown): v is NoteDisposition {
  return v === "pending" || v === "keep" || v === "edited" || v === "discard" || v === "reject";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Persist the ledger (creating `.mage/metrics/`), pretty-printed with a trailing newline. */
export async function writeKeepRateLedger(docsRoot: string, ledger: KeepRateLedger): Promise<void> {
  await mkdir(metricsPath(docsRoot), { recursive: true });
  await writeFile(keepRatePath(docsRoot), JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// ─── reconcile — the idempotent classification pass ──────────────────────────────

const TERMINAL: ReadonlySet<NoteDisposition> = new Set(["keep", "edited", "discard", "reject"]);

/** A single note observed this pass: its identity + git state + first-sight material. */
interface Observation {
  autonomy: "approver" | "overseer";
  source?: "capture" | "adopt";
  /** Git state relative to HEAD + the working tree. */
  state: "untracked" | "modified" | "clean" | "deleted";
  /** sha256 of the current on-disk body (== HEAD body when `clean`). */
  bodyHash: string;
}

/**
 * Reconcile the reject-ledger for `docsRoot` against the git repo at `repo` (ADR-0031 §7).
 * Reads the current ledger, enumerates the stamped-autonomous notes, folds one-way terminal
 * transitions, handles deletions (seen keys absent this pass), persists, and returns the new
 * ledger. FAIL-OPEN: not a git repo, an unreadable notes dir, or any per-note error → returns
 * `null` WITHOUT writing (the on-disk ledger is left untouched so nothing is lost, and the caller
 * renders no stale keep-rate line), never a throw. IDEMPOTENT: an unchanged git state re-runs to a no-op.
 */
export async function reconcileKeepRate(docsRoot: string, repo: string): Promise<KeepRateLedger | null> {
  const prev = await readKeepRateLedger(docsRoot);

  // Enumerate the stamped-autonomous notes (frontmatter only; ScannedNote drops provenance).
  // A NotARepoError (git unavailable) or an unreadable notes dir → null, the persisted ledger
  // untouched: reconcile advanced nothing, so the nudge must surface NO keep-rate line (not stale data).
  let observed: Map<string, Observation>;
  try {
    observed = await enumerateAutonomousNotes(docsRoot, repo);
  } catch {
    return null; // not a git repo, or an unreadable notes dir → fail-open; no write, no line.
  }

  const headCommit = (await getHeadCommit(repo).catch(() => null)) ?? undefined;
  const seen: Record<string, SeenNote> = { ...prev.seen };
  const tally = cloneTally(prev.tally);

  // ── present notes: new → pending, pending → terminal, terminal → no-op. ──
  for (const [key, obs] of observed) {
    const before = seen[key];
    const { next, delta } = classify(before, obs, headCommit);
    seen[key] = next;
    if (delta) tally[obs.autonomy][delta.state] += delta.sign;
  }

  // ── deletion detection: seen keys not observed this pass (discard/reject). ──
  for (const key of Object.keys(prev.seen)) {
    if (observed.has(key)) continue;
    const before = prev.seen[key];
    if (!before || TERMINAL_ABSENT.has(before.state)) continue; // already discard/reject → no-op.
    // A seen key can drop out of the enumeration for TWO reasons: the file was deleted, OR its
    // `provenance.autonomy` was removed/downgraded to operator (a human taking ownership, ADR-0030).
    // Only the FIRST is a deletion. If the file still exists on disk it was de-stamped, not deleted —
    // freeze its disposition and touch nothing (FIX 2), so a human's kept note is never scored reject.
    if (await fileOnDisk(docsRoot, key)) continue;
    const inHead = await noteExistsInHead(repo, toGitRel(docsRoot, repo, key)).catch(() => false);
    const { next, deltas } = classifyAbsent(before, inHead);
    seen[key] = next;
    for (const d of deltas) tally[before.autonomy][d.state] += d.sign;
  }

  const ledger: KeepRateLedger = { v: KEEP_RATE_VERSION, seen, tally };
  await writeKeepRateLedger(docsRoot, ledger).catch(() => {
    /* metrics write is best-effort — a failed persist never breaks the nudge. */
  });
  return ledger;
}

/** A terminal already-absent state that the deletion pass must not re-transition. */
const TERMINAL_ABSENT: ReadonlySet<NoteDisposition> = new Set(["discard", "reject"]);

interface TallyDelta {
  state: keyof LevelTally;
  sign: 1 | -1;
}

/**
 * The PURE core: given a note's prior record (or none) and its current observation, return
 * its next record and any single tally delta. One-way terminal: a note that already reached
 * a terminal state is never re-counted; a `clean` note keeps iff its body is unchanged since
 * first sight, else `edited`.
 */
function classify(
  prev: SeenNote | undefined,
  obs: Observation,
  headCommit: string | undefined,
): { next: SeenNote; delta: TallyDelta | null } {
  if (!prev) {
    // New to the ledger.
    if (obs.state === "untracked" || obs.state === "modified") {
      return { next: firstSight(obs, headCommit, "pending"), delta: null };
    }
    if (obs.state === "clean") {
      // Already committed the first time we ever see it (a pre-existing note): record a
      // BASELINE keep so re-runs are no-ops, but DON'T count it — we never observed the
      // author's keep/revert decision, so it must inflate NEITHER the tally NOR the headline
      // (the `baseline` flag makes summarizeKeepRate skip it — FIX 1).
      return { next: { ...firstSight(obs, headCommit, "keep"), baseline: true }, delta: null };
    }
    // New + deleted: never observed on disk — nothing to record (caller keeps it absent).
    return { next: firstSight(obs, headCommit, "discard"), delta: null };
  }

  // `discard` is the ONE reversible terminal (it means "never committed"): a note re-created at
  // the same path un-discards, so it can progress to keep/edited normally (FIX 3). Undo the earlier
  // discard count either way. keep / edited / reject remain strictly one-way.
  if (prev.state === "discard") {
    if (obs.state === "untracked" || obs.state === "modified") {
      return { next: firstSight(obs, headCommit, "pending"), delta: { state: "discard", sign: -1 } };
    }
    if (obs.state === "clean") {
      // Re-created AND committed within one gap — no fresh uncommitted first-sight to hash against,
      // so record a baseline keep (uncounted) and just undo the earlier discard.
      return {
        next: { ...firstSight(obs, headCommit, "keep"), baseline: true },
        delta: { state: "discard", sign: -1 },
      };
    }
    return { next: prev, delta: null }; // discard + deleted: still absent → stays discard.
  }

  if (TERMINAL.has(prev.state)) return { next: prev, delta: null }; // keep / edited / reject are one-way.

  // prev.state === "pending".
  if (obs.state === "untracked" || obs.state === "modified") {
    return { next: prev, delta: null }; // still uncommitted → stays pending, unchanged.
  }
  if (obs.state === "clean") {
    const state: NoteDisposition = prev.bodyHash === obs.bodyHash ? "keep" : "edited";
    return { next: { ...prev, state }, delta: { state, sign: 1 } };
  }
  // pending + deleted is handled by the deletion pass, not here.
  return { next: prev, delta: null };
}

/**
 * The PURE deletion core: a seen note absent from this pass AND absent from disk (the caller
 * already froze the de-stamped-but-present case). A pending note that never committed is a
 * `discard` (the dominant discard-before-commit case); one that reached HEAD but is now gone is
 * a `reject`. A previously-terminal keep/edited that vanished is reclassified to `reject`
 * (decrement the old terminal, increment reject).
 *
 * KNOWN best-effort limitation (review #4): a committed note whose working-tree file is deleted
 * but whose deletion is NOT yet committed still resolves `inHead === true`, so it is scored
 * `reject` at this boundary even though the human could still `git checkout` it back. Bounded and
 * acceptable — the reconcile is a boundary snapshot, not a live watcher.
 */
function classifyAbsent(prev: SeenNote, inHead: boolean): { next: SeenNote; deltas: TallyDelta[] } {
  if (prev.state === "pending") {
    const state: NoteDisposition = inHead ? "reject" : "discard";
    return { next: { ...prev, state }, deltas: [{ state, sign: 1 }] };
  }
  // A BASELINE keep (first seen already-committed) was NEVER added to the tally, so its deletion
  // must be a tally NO-OP — a keep decrement here would drive `tally.<level>.keep` negative and
  // corrupt byLevel (FIX A). Record the state transition, emit no deltas; it stays out of the
  // headline (summarizeKeepRate skips baseline notes) exactly as it was before deletion.
  if (prev.baseline) {
    return { next: { ...prev, state: "reject" }, deltas: [] };
  }
  // prev.state is keep or edited (discard/reject were filtered out before calling): it was
  // counted as a terminal keep-family, now it's gone → move that count to reject.
  return {
    next: { ...prev, state: "reject" },
    deltas: [
      { state: prev.state as "keep" | "edited", sign: -1 },
      { state: "reject", sign: 1 },
    ],
  };
}

function firstSight(obs: Observation, headCommit: string | undefined, state: NoteDisposition): SeenNote {
  return {
    autonomy: obs.autonomy,
    state,
    bodyHash: obs.bodyHash,
    ...(obs.source ? { source: obs.source } : {}),
    ...(headCommit ? { firstSeenCommit: headCommit } : {}),
  };
}

function cloneTally(t: Record<Autonomy, LevelTally>): Record<Autonomy, LevelTally> {
  return {
    operator: { ...t.operator },
    approver: { ...t.approver },
    overseer: { ...t.overseer },
  };
}

// ─── enumeration ─────────────────────────────────────────────────────────────────

/** Thrown when the repo is not a git work tree — reconcile catches it and bails without mutating. */
class NotARepoError extends Error {}

/**
 * Enumerate the stamped-autonomous notes under `<docsRoot>/notes/`: every `.md` whose
 * `provenance.autonomy` is approver/overseer, keyed by its docs-root-relative path. Reads
 * frontmatter directly (ScannedNote drops provenance). Throws {@link NotARepoError} when the
 * repo is not a git work tree (reconcile fails open to the unchanged ledger).
 */
async function enumerateAutonomousNotes(docsRoot: string, repo: string): Promise<Map<string, Observation>> {
  const out = new Map<string, Observation>();
  const notesDir = join(docsRoot, NOTES_DIR);
  const files = await walkMarkdown(notesDir);
  for (const abs of files) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      continue; // unreadable note — skip (fail-open).
    }
    let autonomy: "approver" | "overseer" | undefined;
    let source: "capture" | "adopt" | undefined;
    let body: string;
    try {
      const note = parseNote(raw);
      const p = note.frontmatter.provenance;
      const a = p?.autonomy;
      if (a !== "approver" && a !== "overseer") continue; // not agent-authored — ignore.
      autonomy = a;
      source = p?.source === "capture" || p?.source === "adopt" ? p.source : undefined;
      body = note.body;
    } catch {
      continue; // malformed frontmatter — skip.
    }
    const key = toKey(relative(docsRoot, abs));
    const gitRel = toGitRel(docsRoot, repo, key);
    const state = await noteGitState(repo, gitRel).catch(() => "not-a-repo" as const);
    if (state === "not-a-repo") throw new NotARepoError();
    out.set(key, { autonomy, source, state, bodyHash: sha256(body) });
  }
  return out;
}

/** Recursively list `.md` files under `dir` (absolute paths). Missing dir → []. */
async function walkMarkdown(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // no notes/ dir yet.
  }
  const out: string[] = [];
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkMarkdown(abs)));
    } else if (ent.isFile() && ent.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

/** The ledger key: a docs-root-relative path with forward slashes (stable across platforms). */
function toKey(relPath: string): string {
  return relPath.split(/[\\/]/).join("/");
}

/** The git-repo-relative path (forward slashes) for a ledger key. */
function toGitRel(docsRoot: string, repo: string, key: string): string {
  return relative(repo, join(docsRoot, key)).split(/[\\/]/).join("/");
}

/** True iff the working-tree file for a ledger key still exists on disk. Fail-open: false. */
async function fileOnDisk(docsRoot: string, key: string): Promise<boolean> {
  try {
    await access(join(docsRoot, key));
    return true;
  } catch {
    return false;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── summarize — the display projection ──────────────────────────────────────────

/** The keep-rate display projection: the per-level breakdown + the capture-only headline. */
export interface KeepRateSummary {
  /** Per-autonomy terminal counts across ALL sources (a future breakdown; not the headline). */
  byLevel: Record<Autonomy, LevelTally>;
  /** The headline cohort: terminals with `source === "capture"` ONLY (the LOCKED policy). */
  capture: {
    keep: number;
    edited: number;
    discard: number;
    reject: number;
    /** Total capture terminals (keep + edited + discard + reject). 0 ⇒ hide the nudge line. */
    terminals: number;
    /** (keep + edited) / terminals; 0 when there are no terminals yet. */
    rate: number;
  };
}

/**
 * Project the ledger into the display summary. The headline `capture` block counts ONLY
 * `source === "capture"` terminals (walking `seen`, since the per-level `tally` folds every
 * source) — the inclusion policy that keeps the crown metric trustworthy and neutralizes the
 * adopt-backfill contamination without an adopt refactor. `terminals === 0` ⇒ the nudge line hides.
 */
export function summarizeKeepRate(ledger: KeepRateLedger): KeepRateSummary {
  const capture = { keep: 0, edited: 0, discard: 0, reject: 0 };
  for (const note of Object.values(ledger.seen)) {
    if (note.source !== "capture") continue; // capture-only headline.
    if (note.baseline) continue; // first-seen-already-committed: a decision we never witnessed (FIX 1).
    if (note.state === "keep") capture.keep += 1;
    else if (note.state === "edited") capture.edited += 1;
    else if (note.state === "discard") capture.discard += 1;
    else if (note.state === "reject") capture.reject += 1;
  }
  const terminals = capture.keep + capture.edited + capture.discard + capture.reject;
  const rate = terminals > 0 ? (capture.keep + capture.edited) / terminals : 0;
  return {
    byLevel: cloneTally(ledger.tally),
    capture: { ...capture, terminals, rate },
  };
}
