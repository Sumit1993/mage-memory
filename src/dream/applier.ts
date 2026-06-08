// The ONE writer (ADR-0016 §4). Every other dream executor (graduate/demote/
// merge/split/reword) is a READ-ONLY planner that returns a MutationPlan; this
// applier is the single serialized choke point that enforces the §3 ceilings on
// that plan, THEN performs every write/archive/remove. Nothing else touches disk.
//
// THE CEILINGS — enforced IN ORDER, before any change (ADR-0016 §3):
//   1. Never auto-commit — structural: no child_process, no git in this module.
//   2. Gate-2: scanSecrets() over EVERY write.content; a live secret (or a scanner
//      throw — fail-closed) refuses the WHOLE proposal, nothing written.
//   3. Bespoke guard: every existing skillTargets path must carry GEN_MARKER, else
//      refuse — mage never edits/clobbers a hand-authored skill.
//   4. Removes-safety: every removes path must be under <repo>/.claude/skills or
//      <repo>/.agents/skills — a NOTE is never rm'd (knowledge is never deleted).
//
// On any refusal: return {ok:false, refused, written:[], archived:[]} WITHOUT
// having written anything. On pass: writes (mkdir -p + writeFile), archives
// (mkdir -p + rename), removes (rm -rf, guarded). The applier NEVER commits.

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Proposal } from "../grooming/types.js";
import { noteWing, readNote } from "../note.js";
import { hasLiveSecret, scanSecrets } from "../redact.js";
import { GEN_MARKER, TARGET_AGENT_DIRS } from "../skills-shared.js";
import { planDemote } from "./demote.js";
import { planGraduate } from "./graduate.js";
import { type MergePayload, planMerge } from "./merge.js";
import { planReword, type RewordPayload } from "./reword.js";
import { planSplit, type SplitPayload } from "./split.js";
import type { ApplyResult, FileWrite, MutationPlan } from "./types.js";

/**
 * Apply (or refuse) ONE confirmed proposal. Dispatches on `proposal.action` to the
 * matching read-only executor for a MutationPlan, enforces every §3 ceiling on that
 * plan in order, then performs the changes. Returns repo/docs-relative paths in
 * `written`/`archived`. NEVER commits, NEVER edits a bespoke skill, NEVER rm's a note.
 *
 * Fail-closed everywhere: a `note` action, a live secret, a bespoke skillTarget, an
 * out-of-tree remove, or any scanner/planner throw → `{ ok:false, refused }` with
 * nothing written.
 */
export async function applyProposal(
  docsRoot: string,
  repo: string,
  proposal: Proposal,
): Promise<ApplyResult> {
  // `note` is the learn pipeline, not the applier — refuse before planning.
  if (proposal.action === "note") {
    return refusal(
      "note",
      "note creation is the learn pipeline, not the applier",
      "note",
    );
  }

  let plan: MutationPlan;
  try {
    plan = await planFor(docsRoot, repo, proposal);
  } catch (err) {
    // A planner throw (missing note, not-a-skill, no SKILL.md, …) refuses cleanly.
    return refusal(proposal.action, planErrorMessage(err), proposal.action);
  }

  // ── Ceiling 2 — Gate-2 secret scan over EVERY write.content (fail-closed). ──
  const secretRefusal = scanForSecrets(plan.writes);
  if (secretRefusal !== null) return refusalFromPlan(plan, secretRefusal);

  // ── Ceiling 3 — bespoke guard: every EXISTING skillTarget must carry GEN_MARKER. ──
  const bespokeRefusal = await guardBespoke(plan.skillTargets);
  if (bespokeRefusal !== null) return refusalFromPlan(plan, bespokeRefusal);

  // ── Ceiling 4 — removes-safety: every removes path under a skills tree only,
  //    AND provably mage-owned (its SKILL.md must carry GEN_MARKER). ──
  const removeRefusal = await guardRemoves(repo, plan.removes);
  if (removeRefusal !== null) return refusalFromPlan(plan, removeRefusal);

  // ── All ceilings passed — perform the mutations (the one writer). ──
  return performPlan(docsRoot, repo, plan);
}

// ─── dispatch ──────────────────────────────────────────────────────────────────

/** Route a proposal to its read-only executor for a MutationPlan. */
async function planFor(
  docsRoot: string,
  repo: string,
  proposal: Proposal,
): Promise<MutationPlan> {
  switch (proposal.action) {
    case "graduate": {
      // target = the note's docs-root-relative path. Read it + derive its wing.
      const note = await readNote(join(docsRoot, proposal.target));
      const wing = noteWing(note.frontmatter) ?? "";
      return planGraduate(repo, docsRoot, proposal.target, note, wing);
    }
    case "demote":
      // target = the graduated skill name (e.g. mage-skill-foo).
      return planDemote(repo, docsRoot, proposal.target);
    case "merge":
      return planMerge(docsRoot, proposal.payload as unknown as MergePayload);
    case "split":
      return planSplit(docsRoot, proposal.payload as unknown as SplitPayload);
    case "reword":
      return planReword(repo, proposal.payload as unknown as RewordPayload);
    default:
      // `note` is handled before dispatch; any other value is unsupported.
      throw new Error(`applier: unsupported proposal action '${proposal.action}'.`);
  }
}

// ─── ceiling 2: Gate-2 secret scan ───────────────────────────────────────────────

/**
 * Scan every write's content for live secrets. Returns a refusal reason if any
 * write carries a credential/key (or the scanner throws — fail-closed), else null.
 */
function scanForSecrets(writes: readonly FileWrite[]): string | null {
  for (const w of writes) {
    let findings;
    try {
      findings = scanSecrets(w.content);
    } catch {
      // A scanner throw is treated as a block — never write past a Gate-2 fault.
      return `Gate-2: secret scan failed on a pending write — refusing (fail-closed).`;
    }
    if (hasLiveSecret(findings)) {
      return `Gate-2: a pending write carries a live secret — refusing (knowledge never ships a credential).`;
    }
  }
  return null;
}

// ─── ceiling 3: bespoke guard ────────────────────────────────────────────────────

/**
 * For every skillTarget that EXISTS on disk, refuse unless it carries GEN_MARKER.
 * Only mage-GENERATED skills (marker-bearing) may be written/removed; a hand-
 * authored skill at that path is never clobbered. A missing path is fine (a fresh
 * graduate). A read error other than ENOENT is fail-closed (refuse).
 */
async function guardBespoke(skillTargets: readonly string[]): Promise<string | null> {
  for (const path of skillTargets) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // not there → safe to create.
      return `bespoke guard: cannot verify '${path}' — refusing (fail-closed).`;
    }
    if (!raw.includes(GEN_MARKER)) {
      return `bespoke guard: '${path}' is not a mage-generated skill (no GEN_MARKER) — refusing to clobber it.`;
    }
  }
  return null;
}

// ─── ceiling 4: removes-safety ───────────────────────────────────────────────────

/**
 * Every removes path MUST resolve under `<repo>/.claude/skills` or
 * `<repo>/.agents/skills` (a NOTE, or anything outside those two trees, is never
 * rm'd — knowledge is never hard-deleted), AND — if the dir EXISTS — must be
 * provably mage-owned: its own `SKILL.md` must carry GEN_MARKER. A non-existent
 * removes dir is a no-op (nothing to delete). But an EXISTING dir with no marker-
 * bearing SKILL.md cannot be proven mage-generated, so we refuse rather than
 * rm-rf it — otherwise unverified, hand-authored content under a skills tree
 * (external content or a prior partial failure) could be hard-deleted unchecked.
 */
async function guardRemoves(repo: string, removes: readonly string[]): Promise<string | null> {
  const allowed = TARGET_AGENT_DIRS.map((base) => resolve(repo, base));
  for (const path of removes) {
    const abs = resolve(isAbsolute(path) ? path : join(repo, path));
    if (!allowed.some((root) => isUnder(root, abs))) {
      return `removes-safety: '${path}' is not under a generated-skill tree (${TARGET_AGENT_DIRS.join(" or ")}) — refusing to delete (knowledge is never hard-deleted).`;
    }
    // A dir that doesn't exist is a no-op rm — nothing to delete, nothing to protect.
    try {
      await readdir(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      return `removes-safety: cannot inspect '${path}' — refusing (fail-closed).`;
    }
    // The EXISTING dir must prove it is mage-owned via its own marker-bearing
    // SKILL.md. A missing/unreadable/marker-less SKILL.md → cannot prove ownership
    // → refuse, so we never rm-rf a dir that may hold hand-authored files.
    let raw: string;
    try {
      raw = await readFile(join(abs, "SKILL.md"), "utf8");
    } catch {
      return `removes-safety: '${path}' has no mage-generated SKILL.md — refusing to delete (cannot prove it is mage-owned).`;
    }
    if (!raw.includes(GEN_MARKER)) {
      return `removes-safety: '${path}' SKILL.md carries no GEN_MARKER — refusing to delete (not a mage-generated skill).`;
    }
  }
  return null;
}

/** True iff `abs` is `root` itself or a descendant of `root` (no `..` escape). */
function isUnder(root: string, abs: string): boolean {
  if (abs === root) return true;
  const rel = relative(root, abs);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

// ─── perform (the one writer) ────────────────────────────────────────────────────

/** All ceilings passed — perform writes, then archives, then guarded removes. */
async function performPlan(
  docsRoot: string,
  repo: string,
  plan: MutationPlan,
): Promise<ApplyResult> {
  const written: string[] = [];
  for (const w of plan.writes) {
    await mkdir(dirname(w.path), { recursive: true });
    await writeFile(w.path, w.content, "utf8");
    written.push(relForReport(docsRoot, repo, w.path));
  }

  const archived: string[] = [];
  for (const a of plan.archives) {
    await mkdir(dirname(a.to), { recursive: true });
    await rename(a.from, a.to);
    archived.push(`${relForReport(docsRoot, repo, a.from)} → ${relForReport(docsRoot, repo, a.to)}`);
  }

  // removes are already ceiling-4 guarded; rm -rf force-tolerates an absent dir.
  for (const r of plan.removes) {
    await rm(r, { recursive: true, force: true });
  }

  return {
    action: plan.action,
    ok: true,
    refused: null,
    written,
    archived,
    summary: plan.summary,
  };
}

// ─── refusals + reporting ─────────────────────────────────────────────────────────

/** A refusal before any plan exists (note action / planner throw). */
function refusal(
  action: ApplyResult["action"],
  reason: string,
  summaryAction: string,
): ApplyResult {
  return {
    action,
    ok: false,
    refused: reason,
    written: [],
    archived: [],
    summary: `Refused ${summaryAction}: ${reason}`,
  };
}

/** A refusal after a plan was built (a ceiling blocked it) — nothing written. */
function refusalFromPlan(plan: MutationPlan, reason: string): ApplyResult {
  return {
    action: plan.action,
    ok: false,
    refused: reason,
    written: [],
    archived: [],
    summary: `Refused ${plan.action}: ${reason}`,
  };
}

/** A clean message from a planner throw (never leak a stack). */
function planErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Report an absolute path relative to the docs root when it lives there (notes/
 * archives), else relative to the repo (skills under .claude/.agents). Falls back
 * to the absolute path if it's under neither.
 */
function relForReport(docsRoot: string, repo: string, abs: string): string {
  for (const base of [docsRoot, repo]) {
    const rel = relative(base, abs);
    if (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  return abs;
}
