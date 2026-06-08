// Plan demoting a Procedure skill back to its backing note (ADR-0013 §1 / §6,
// ADR-0019 §6). A READ-ONLY planner: it locates the skill's SKILL.md across the
// target agent dirs and returns a MutationPlan; the single applier (applier.ts)
// enforces the §3 ceilings (GEN_MARKER bespoke-guard, removes-path-safety) and
// performs the archive + removes. This executor never touches disk.
//
// Knowledge is never deleted: the backing NOTE persists untouched (it is the
// substrate; ADR-0013 §1). Only the GENERATED skill is unwound — ONE copy is
// archived (rename-move) under `<docsRoot>/archive/skills/<name>/SKILL.md`, and
// BOTH skill dirs (under `.claude/skills` + `.agents/skills` ONLY) are listed in
// `removes` for the applier to rm AFTER the GEN_MARKER guard passes.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type NoteFrontmatter, readNote, stringifyNote } from "../note.js";
import { ARCHIVE_DIR } from "../paths.js";
import { safeSegment } from "../scan.js";
import { SKILL_PREFIX, TARGET_AGENT_DIRS } from "../skills-shared.js";
import type { FileWrite, MutationPlan } from "./types.js";

/**
 * Plan demoting a Procedure skill → back to its note. THROWS if `skillName` is not
 * a `mage-skill-*` name (you can only demote a graduated skill, not a wing skill or
 * a bespoke skill) or if no SKILL.md for it exists on disk.
 *
 *   archives   = ONE existing SKILL.md → `<docsRoot>/archive/skills/<name>/SKILL.md`
 *   removes    = BOTH `<repo>/{.claude,.agents}/skills/<name>` dirs (applier-guarded)
 *   skillTargets = both `<repo>/{.claude,.agents}/skills/<name>/SKILL.md` paths
 *   writes     = []  OR  the backing note re-serialized WITHOUT `graduated_skill` (the
 *                note is NEVER deleted, only un-pointed). FAIL-OPEN: if the SKILL.md
 *                lacks a backing-note pointer, or the note can't be read/parsed/has no
 *                `graduated_skill` key, the note write is skipped (archive+removes proceed).
 */
export async function planDemote(
  repo: string,
  docsRoot: string,
  skillName: string,
): Promise<MutationPlan> {
  if (!skillName.startsWith(SKILL_PREFIX) || !safeSegment(skillName)) {
    throw new Error(
      `demote: '${skillName}' is not a graduated Procedure skill (expected '${SKILL_PREFIX}<slug>').`,
    );
  }

  // Every SKILL.md path the skill could live at — both are skillTargets so the
  // applier's GEN_MARKER guard sees each existing one before any rm.
  const skillFiles = TARGET_AGENT_DIRS.map((base) => join(repo, base, skillName, "SKILL.md"));

  // Find the FIRST copy that actually exists — that's the one we archive.
  let source: string | null = null;
  for (const file of skillFiles) {
    if (await fileExists(file)) {
      source = file;
      break;
    }
  }
  if (source === null) {
    throw new Error(
      `demote: no SKILL.md for '${skillName}' found under ${TARGET_AGENT_DIRS.join(" or ")}.`,
    );
  }

  const archiveDest = join(docsRoot, ARCHIVE_DIR, "skills", skillName, "SKILL.md");

  // Un-point the backing note: drop its dangling `graduated_skill` so a re-graduate
  // can't collide with a now-archived skill. FAIL-OPEN — never throw for this.
  const writes = await planNoteUnpoint(docsRoot, source);

  return {
    action: "demote",
    writes,
    archives: [{ from: source, to: archiveDest }],
    // Remove BOTH skill dirs (.claude/skills + .agents/skills ONLY). The applier
    // refuses any removes path outside those two trees and re-checks GEN_MARKER.
    removes: skillFiles.map((f) => dirname(f)),
    skillTargets: skillFiles,
    summary: `Demote ${skillName} → archived to ${ARCHIVE_DIR}/skills/${skillName}/SKILL.md; backing note untouched.`,
  };
}

/**
 * Plan re-writing the backing note WITHOUT its `graduated_skill` pointer. Reads the
 * SKILL.md body for the backing-note pointer line graduate.ts emits ("This skill
 * graduated from `<relpath>` …"), reads that note, and — if it carries a
 * `graduated_skill` key — returns ONE FileWrite re-serializing it without that key
 * (bumped `updated`). FAIL-OPEN: a missing pointer, an unreadable/unparseable note,
 * or a note already lacking the key → `[]` (never throws; the note is never deleted).
 */
async function planNoteUnpoint(docsRoot: string, skillFile: string): Promise<FileWrite[]> {
  try {
    const skillRaw = await readFile(skillFile, "utf8");
    const relPath = backingNoteRelPath(skillRaw);
    if (!relPath) return [];

    const notePath = join(docsRoot, relPath);
    const note = await readNote(notePath);
    if (!("graduated_skill" in note.frontmatter)) return [];

    // Immutable: a fresh frontmatter object minus the pointer, with bumped `updated`.
    const { graduated_skill: _drop, ...rest } = note.frontmatter as NoteFrontmatter & {
      graduated_skill?: unknown;
    };
    const newFrontmatter: NoteFrontmatter = { ...rest, updated: todayStamp() };
    return [{ path: notePath, content: stringifyNote(newFrontmatter, note.body) }];
  } catch {
    return []; // fail-open — never block the demote on the un-point.
  }
}

/**
 * Extract the backing-note relpath from a SKILL.md body. Matches the pointer line
 * graduate.ts emits — "This skill graduated from `<relpath>` …". Returns null when
 * absent (a bespoke/old skill, or a torn body).
 */
function backingNoteRelPath(skillRaw: string): string | null {
  const m = skillRaw.match(/This skill graduated from `([^`]+)`/);
  return m?.[1]?.trim() || null;
}

/** UTC YYYY-MM-DD stamp for the bumped `updated` field. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True iff a readable file exists at `path` (readFile-with-catch — no TOCTOU probe). */
async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
