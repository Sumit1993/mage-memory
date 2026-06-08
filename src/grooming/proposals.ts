// The proposal + rejected stores (ADR-0019 §9). Two gitignored `.metrics/`
// siblings of the rollup + promote tally:
//
//   proposals.json — pending suggestions not yet dispositioned (the queue).
//   rejected.json  — the rejected-edit buffer: what the human said no to, so mage
//                    "backs off" and doesn't re-pester (the back-off half of the
//                    accept/reject loop, ADR-0016 §4).
//
// Mirrors rollup.ts's gitignored-JSON shape exactly: a fail-open read (ENOENT /
// corrupt / non-array → []), and a write that mkdir's `.metrics/` and emits
// pretty JSON with a trailing newline. PURE compute is `isRejected` — no model,
// no network. These are DERIVED metrics, never tracked (ADR-0016 §2).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { METRICS_DIR } from "../paths.js";
import type { Proposal } from "./types.js";

// ─── consts ────────────────────────────────────────────────────────────────────

/** The pending-proposal queue, sibling of the rollup in `.metrics/`. */
export const PROPOSALS_FILE = "proposals.json";
/** The rejected-edit buffer, sibling of the rollup in `.metrics/`. */
export const REJECTED_FILE = "rejected.json";

// ─── paths ─────────────────────────────────────────────────────────────────────

/** The on-disk proposals-queue path under a docs root. */
export function proposalsPath(docsRoot: string): string {
  return join(docsRoot, METRICS_DIR, PROPOSALS_FILE);
}

/** The on-disk rejected-buffer path under a docs root. */
export function rejectedPath(docsRoot: string): string {
  return join(docsRoot, METRICS_DIR, REJECTED_FILE);
}

// ─── reads — fail-open on missing/corrupt ───────────────────────────────────────

/**
 * Read the pending-proposal queue. Missing file (ENOENT), corrupt JSON, or a
 * non-array shape → `[]`. Reachable from a host hook, so it must never throw.
 */
export async function readProposals(docsRoot: string): Promise<Proposal[]> {
  return readProposalArray(proposalsPath(docsRoot));
}

/**
 * Read the rejected-edit buffer. Missing file (ENOENT), corrupt JSON, or a
 * non-array shape → `[]` (back off nothing when the buffer is unreadable).
 */
export async function readRejected(docsRoot: string): Promise<Proposal[]> {
  return readProposalArray(rejectedPath(docsRoot));
}

/** Shared fail-open read: ENOENT / corrupt / non-array → []; torn entries dropped. */
async function readProposalArray(path: string): Promise<Proposal[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return []; // missing (ENOENT) or unreadable → empty.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return []; // corrupt JSON → fail-open to empty.
  }
  if (!Array.isArray(parsed)) return []; // wrong shape → empty.
  return parsed.filter(isProposal);
}

/** A structural guard: drop a torn entry rather than trust an untyped shape. */
function isProposal(v: unknown): v is Proposal {
  if (v === null || typeof v !== "object") return false;
  const p = v as Partial<Proposal>;
  return typeof p.action === "string" && typeof p.target === "string";
}

// ─── writes — gitignored pretty JSON with trailing NL ───────────────────────────

/** Persist the proposal queue (creating `.metrics/`), pretty-printed + trailing NL. */
export async function writeProposals(docsRoot: string, ps: Proposal[]): Promise<void> {
  await writeProposalArray(proposalsPath(docsRoot), docsRoot, ps);
}

/** Persist the rejected buffer (creating `.metrics/`), pretty-printed + trailing NL. */
export async function writeRejected(docsRoot: string, ps: Proposal[]): Promise<void> {
  await writeProposalArray(rejectedPath(docsRoot), docsRoot, ps);
}

/** Shared write: mkdir `.metrics/`, then JSON.stringify(,,2)+"\n" (mirrors rollup). */
async function writeProposalArray(path: string, docsRoot: string, ps: Proposal[]): Promise<void> {
  await mkdir(join(docsRoot, METRICS_DIR), { recursive: true });
  await writeFile(path, JSON.stringify(ps, null, 2) + "\n", "utf8");
}

// ─── isRejected — the back-off predicate (PURE) ─────────────────────────────────

/**
 * True iff an equivalent proposal is already in the rejected buffer — matched on
 * `action` + `target` (the suppression key; payload/evidence are presentation,
 * not identity). The manifest builder consults this to "back off" and not
 * re-pester about a signature the human already declined. PURE — no fs.
 */
export function isRejected(p: Proposal, rejected: Proposal[]): boolean {
  return rejected.some((r) => r.action === p.action && r.target === p.target);
}
