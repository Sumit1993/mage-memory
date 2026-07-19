// The note-READ signal (ADR-0038 §2). PURE — no fs, no model, no network.
//
// Graduation asks "is this note EARNING its keep?", and the honest answer is usage:
// how many distinct compact-chapters did the agent actually open this note in. That
// is what ADR-0029 meant by "graduating already-human-confirmed notes by continued
// usage" — a phrase that, until now, described a design that was never built (the old
// path graduated on the same keyword-recurrence fold ADR-0038 deleted).
//
// The weak link two replay gates found — a deterministic core deciding WHAT IS A
// LESSON — is absent here by construction. The lesson was human-confirmed when the
// note was written; this module only counts whether it gets read. Counting is exactly
// what a model-free core is good at (ADR-0009).
//
// SELF-REFERENCE EXCLUSION (a correctness condition, not a nicety — ADR-0038 §2).
// mage's own capture skills read notes: `mage:groom` Phase 1 overlap-checks, and
// `mage:learn` does the same before writing. Counting those would let grooming inflate
// the very counts that trigger graduation — the loop feeding itself.
//
// The exclusion is CHAPTER-LEVEL, and deliberately coarse. `ToolUseEvent` carries no
// active-skill field and there is no `skill_unload` event, so a mage-skill context can
// be opened (`SkillLoadEvent.skill`) but never exactly closed — there is no bracket to
// respect, only a chapter to discard. Coarse is the correct failure direction here:
// this signal MINTS SKILLS, so over-counting creates a wrong skill while under-counting
// only delays a right one. We pay genuine reads in grooming chapters to never pay that.

import { isGeneratedArtifact } from "../scan.js";
import type { ObserveEvent } from "../observe/types.js";

/**
 * Skill-name prefixes whose presence in a chapter disqualifies EVERY note read in it.
 * Matched case-insensitively against `SkillLoadEvent.skill`, on both the bare and the
 * `mage:`-qualified form a harness might record.
 *
 * Scoped to mage's own skills as a class rather than to the two capture skills
 * specifically. `mage:graduate` reads a note to show the human, `mage:guide` steers the
 * agent to read notes, `mage:optimize` walks skills — none of those are a user
 * consulting a note on its merits either. Erring wide costs a delayed graduation;
 * erring narrow mints a skill from mage's own bookkeeping.
 */
const MAGE_SKILL_MARKERS = ["mage:", "mage-", "mage_"] as const;

/** True iff a `skill_load` names one of mage's own skills (see MAGE_SKILL_MARKERS). */
export function isMageSkill(skill: string): boolean {
  const s = skill.toLowerCase().trim();
  if (s === "mage") return true;
  return MAGE_SKILL_MARKERS.some((m) => s.startsWith(m));
}

/**
 * True iff this chapter must contribute NO note reads: it loaded one of mage's own
 * skills, so any note read inside it may be mage inspecting its own knowledge base
 * rather than the agent consulting it. See the file header for why this is coarse.
 */
export function chapterIsSelfReferential(
  events: ObserveEvent[],
  seg: { start: number; end: number },
): boolean {
  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e !== undefined && e.type === "skill_load" && isMageSkill(e.skill)) return true;
  }
  return false;
}

/**
 * Map one raw `tool_use.paths` entry to a docs-root-relative note path, or null when it
 * is not a note. A path qualifies iff it resolves under `docsRoot`, ends in `.md`, and
 * is not a generated artifact (INDEX.md / MEMORY.md / the wing index — reading the index
 * is navigation, not consulting a note, and it would otherwise dominate every count).
 *
 * Event paths are absolute or cwd-relative (ADR-0015 §5 records them structurally, as
 * captured). A relative path is resolved against `repoRoot` — the agent's cwd — mirroring
 * signature.ts's pathSegments normalization.
 */
export function noteRelPathOf(
  rawPath: string,
  docsRoot: string,
  repoRoot: string | null,
): string | null {
  if (!rawPath.endsWith(".md")) return null;
  const abs = rawPath.startsWith("/")
    ? rawPath
    : repoRoot === null
      ? null
      : `${repoRoot.replace(/\/$/, "")}/${rawPath}`;
  if (abs === null) return null;

  const root = docsRoot.replace(/\/$/, "");
  if (!abs.startsWith(`${root}/`)) return null;
  const rel = abs.slice(root.length + 1);
  // Defensive: a `..` segment escaped the root despite the prefix match (e.g. an
  // unnormalized `<root>/../x.md`). Never credit a read outside the knowledge base.
  if (rel.length === 0 || rel.split("/").includes("..")) return null;
  if (isGeneratedArtifact(rel)) return null;
  return rel;
}

/**
 * The DISTINCT note relPaths read in one chapter — the chapter's contribution to the
 * fold. Empty when the chapter is self-referential (see
 * {@link chapterIsSelfReferential}).
 *
 * Deduped within the chapter on purpose: the unit of recurrence is the CHAPTER, so
 * opening one note six times while working is one chapter of usage, not six. This
 * mirrors the distinct-chapter discipline the signature fold used, and it is what keeps
 * a single chatty session from graduating a note on its own.
 *
 * A read is counted whether or not the tool call succeeded — an attempt to open a note
 * is evidence the agent went looking for it, which is the signal we are after.
 */
export function chapterNoteReads(
  events: ObserveEvent[],
  seg: { start: number; end: number },
  docsRoot: string,
  repoRoot: string | null,
): string[] {
  if (chapterIsSelfReferential(events, seg)) return [];
  const reads = new Set<string>();
  for (let i = seg.start; i < seg.end; i++) {
    const e = events[i];
    if (e === undefined || e.type !== "tool_use") continue;
    for (const p of e.paths) {
      const rel = noteRelPathOf(p, docsRoot, repoRoot);
      if (rel !== null) reads.add(rel);
    }
  }
  return [...reads].sort(); // sorted → a deterministic fold order.
}
