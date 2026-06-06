// `.learnings/` resolution + append-only write + size-cap rotation + age-purge.
// Hygiene is INTERNAL to observe — there is no `mage clean` (ADR-0015 §6,
// CONVENTIONS §10). ECC parity: 10 MB size cap → archive-rename; 30-day
// age-purge gated once-per-day by a `.last-purge` marker.
//
// Retention split (skill_load retained longer than bulky tool_use) is achieved
// by writing skill_load events to a per-session SIDECAR `<session>.skills.jsonl`
// at APPEND time, and purging the full archive at TOOL_USE_PURGE_DAYS but the
// sidecar/archived sidecar at SKILL_LOAD_PURGE_DAYS. This DEVIATES from the
// spec's "filter the rotated archive into a sibling at rotation time" mechanism:
// the append-time sidecar avoids re-reading the rotated archive, and the sidecar
// is the single canonical skill_load store (no double-count — the full archive is
// the bulky stream, the sidecar is the durable skill_load extract). Neither
// mechanism is in ECC; both serve ADR-0015 §6's goal.

import {
  appendFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  LEARNINGS_ARCHIVE_DIR,
  LEARNINGS_DIR,
  LEARNINGS_PURGE_MARKER,
  resolveDocsRoot,
} from "../paths.js";
import type { ObserveEvent } from "./types.js";

/** Size cap before rotation (ECC `MAX_FILE_SIZE_MB=10`). */
export const ROTATE_MAX_BYTES = 10 * 1024 * 1024;
/** Bulky tool_use-bearing full archives purge at 30 days (ECC `-mtime +30`). */
export const TOOL_USE_PURGE_DAYS = 30;
/** Tiny skill_load extract is retained longer (§6). */
export const SKILL_LOAD_PURGE_DAYS = 90;
/** Once-per-day purge throttle (ECC `.last-purge -mtime +1`). */
const PURGE_THROTTLE_DAYS = 1;
const DAY_MS = 86_400_000;
/** Sidecar suffix for the per-session skill_load extract. */
const SKILLS_SUFFIX = ".skills.jsonl";
const SESSION_SUFFIX = ".jsonl";
/** Filesystem NAME_MAX guard for the sanitized session segment. */
const SESSION_NAME_MAX = 200;
const SAFE_SESSION_FALLBACK = "unknown";

// ─── resolution ──────────────────────────────────────────────────────────────

/**
 * The `.learnings/` dir for the KB at or above `startDir`, or null when no KB is
 * found (the caller fails open). Reuses resolveDocsRoot — in-repo → `mage/`, hub
 * → the hub root.
 */
export async function resolveLearningsDir(startDir: string): Promise<string | null> {
  const resolved = await resolveDocsRoot(startDir);
  return resolved ? join(resolved.root, LEARNINGS_DIR) : null;
}

/**
 * The per-session jsonl path. The session id is SANITIZED by transformation (not
 * rejection, so a weird id still captures): unsafe chars → `_`, empty → a safe
 * fallback, length capped so it can't exceed NAME_MAX. Cannot escape `learningsDir`.
 */
export function sessionFilePath(learningsDir: string, session: string): string {
  return join(learningsDir, `${safeSession(session)}${SESSION_SUFFIX}`);
}

/** The per-session skill_load sidecar path. */
function sidecarPath(learningsDir: string, session: string): string {
  return join(learningsDir, `${safeSession(session)}${SKILLS_SUFFIX}`);
}

/** Replace anything outside `[A-Za-z0-9._-]` with `_`; coerce empty; cap length. */
function safeSession(session: string): string {
  const cleaned = session.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.+/g, ".");
  const trimmed = cleaned.replace(/^[.]+/, "").slice(0, SESSION_NAME_MAX);
  return trimmed.length === 0 ? SAFE_SESSION_FALLBACK : trimmed;
}

// ─── append (O_APPEND, no read-before-append) ────────────────────────────────

/**
 * Append one event as a single JSON line. Append-only (`appendFile` → `O_APPEND`)
 * so line order is causal order (no `seq`, ADR-0015 §1). Before appending, runs
 * rotation + (throttled) purge. skill_load events ALSO land in the sidecar.
 *
 * Each serialized line is kept well under PIPE_BUF (4096) by the field caps in
 * types.ts, so the single `O_APPEND` write is atomic per writer. A rotation race
 * can at most drop one line — acceptable under the fail-open contract. FAILS OPEN:
 * a missing KB resolves to a no-op; the caller swallows any residual fs error.
 *
 * `resolvedLearningsDir` lets a caller that has ALREADY resolved the KB (e.g.
 * observeCmd's fast-fail gate) pass it in, avoiding a redundant filesystem walk
 * (resolveDocsRoot) per event on this hot path. Omit it to resolve from startDir.
 */
export async function appendEvent(
  startDir: string,
  session: string,
  event: ObserveEvent,
  resolvedLearningsDir?: string,
): Promise<void> {
  const learningsDir = resolvedLearningsDir ?? (await resolveLearningsDir(startDir));
  if (learningsDir === null) return; // no KB → fail open, write nothing.

  await mkdir(learningsDir, { recursive: true });
  const file = sessionFilePath(learningsDir, session);

  await maybePurge(learningsDir);
  await maybeRotate(file, join(learningsDir, LEARNINGS_ARCHIVE_DIR), learningsDir, session);

  const line = `${JSON.stringify(event)}\n`;
  await appendFile(file, line, "utf8");
  if (event.type === "skill_load") {
    await appendFile(sidecarPath(learningsDir, session), line, "utf8");
  }
}

// ─── rotation (size cap, ECC parity) ─────────────────────────────────────────

/**
 * If the session file is ≥ ROTATE_MAX_BYTES, atomically rename it into
 * `<learningsDir>/.archive/<session>-<YYYYMMDD-HHMMSS>-<pid>.jsonl`, then the next
 * append creates a fresh session file. Also rotates the sidecar alongside so the
 * skill_load extract follows the retention split. Best-effort: a stat-ENOENT (no
 * file yet) is a no-op; rename failures are swallowed (fail-open).
 */
export async function maybeRotate(
  filePath: string,
  archiveDir: string,
  learningsDir: string,
  session: string,
): Promise<void> {
  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return; // no file yet — nothing to rotate.
  }
  if (size < ROTATE_MAX_BYTES) return;

  try {
    await mkdir(archiveDir, { recursive: true });
    const stamp = `${timestamp()}-${process.pid}`;
    const base = safeSession(session);
    await rename(filePath, join(archiveDir, `${base}-${stamp}${SESSION_SUFFIX}`));
    // Rotate the sidecar too (best-effort — it may not exist for tool-only sessions).
    try {
      await rename(
        sidecarPath(learningsDir, session),
        join(archiveDir, `${base}-${stamp}${SKILLS_SUFFIX}`),
      );
    } catch {
      /* no sidecar to rotate */
    }
  } catch {
    /* rotation race / fs error — fail open, keep appending to the current file */
  }
}

// ─── age-purge (retention split, once-per-day) ───────────────────────────────

/**
 * Delete aged archives, gated once-per-day by the `.last-purge` marker. Full
 * archives (`*.jsonl`, NOT `*.skills.jsonl`) expire at TOOL_USE_PURGE_DAYS; the
 * skill_load sidecars (`*.skills.jsonl`) persist to SKILL_LOAD_PURGE_DAYS. Purge
 * is BEST-EFFORT: every fs error is swallowed so purge never breaks a capture.
 */
export async function maybePurge(learningsDir: string): Promise<void> {
  try {
    if (!(await purgeDue(learningsDir))) return;
    const archiveDir = join(learningsDir, LEARNINGS_ARCHIVE_DIR);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(archiveDir, { withFileTypes: true });
    } catch {
      await touchMarker(learningsDir); // nothing to purge, but record the run.
      return;
    }
    const now = Date.now();
    for (const e of entries) {
      if (!e.isFile()) continue;
      const isSidecar = e.name.endsWith(SKILLS_SUFFIX);
      if (!isSidecar && !e.name.endsWith(SESSION_SUFFIX)) continue;
      const limitDays = isSidecar ? SKILL_LOAD_PURGE_DAYS : TOOL_USE_PURGE_DAYS;
      const full = join(archiveDir, e.name);
      try {
        const ageMs = now - (await stat(full)).mtimeMs;
        if (ageMs > limitDays * DAY_MS) {
          await rm(full, { force: true });
        }
      } catch {
        /* swallow per-file errors */
      }
    }
    await touchMarker(learningsDir);
  } catch {
    /* purge never throws */
  }
}

/** True when no marker exists or it is ≥ PURGE_THROTTLE_DAYS old. */
async function purgeDue(learningsDir: string): Promise<boolean> {
  const marker = join(learningsDir, LEARNINGS_PURGE_MARKER);
  try {
    const ageMs = Date.now() - (await stat(marker)).mtimeMs;
    return ageMs > PURGE_THROTTLE_DAYS * DAY_MS;
  } catch {
    return true; // no marker yet → due.
  }
}

/** Stamp the `.last-purge` marker to `now` (best-effort). */
async function touchMarker(learningsDir: string): Promise<void> {
  const marker = join(learningsDir, LEARNINGS_PURGE_MARKER);
  try {
    await writeFile(marker, "");
    const now = new Date();
    await utimes(marker, now, now);
  } catch {
    /* best-effort */
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** `YYYYMMDD-HHMMSS` UTC stamp for an archive filename. */
function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}
