// "Is this a mage skill?" recognition + a per-load frontmatter/notes snapshot of
// `match:{wing,keywords,paths}` + `trigger_hash` (ADR-0015 §3, ADR-0016 §1).
//
// Deviations from the spec's naive plan, addressing the two HIGH design findings:
//   1. WING is derived from the skill NAME (`mage-wing-<wing>` → `<wing>`), NOT
//      from frontmatter — generated wing SKILL.md files carry only name +
//      description (no `tags:`), so `noteWing(fm)` would return null and yield an
//      empty wing even though the wing is literally in the name.
//   2. KEYWORDS are aggregated from the wing's REAL notes (scanNotes +
//      deriveKeywords), NOT from the generated skill's boilerplate body ("Where
//      the knowledge is", "playbooks & gotchas"). ADR-0016 §1 makes match.keywords
//      the load-bearing predicate signal; boilerplate header words make it useless.
//   3. The `mage:` plugin namespace (mage:learn, mage:guide, …) is recognized as
//      mage's own and stripped before lookup. Plugin skills have no wing/notes
//      mapping, so they snapshot trigger_hash only (match stays null).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "../note.js";
import { AGENTS_SKILLS_DIR, CLAUDE_DIR, resolveDocsRoot } from "../paths.js";
import { safeSegment, scanNotes } from "../scan.js";
import { triggerHash } from "./events.js";
import { PATH_MAX, type SkillMatch } from "./types.js";

/** The plugin namespace mage's hand-authored skills load under (CONVENTIONS §9). */
const MAGE_NAMESPACE = "mage:";
/** Generated per-wing awareness skill prefix (skills-cmd.ts WING_PREFIX). */
const WING_PREFIX = "mage-wing-";
/** Graduated procedure-skill prefix (reserved, CONVENTIONS §9; ships 0.0.8+). */
const SKILL_PREFIX = "mage-skill-";
/** Max keywords to snapshot per wing (matches deriveKeywords default ergonomics). */
const MAX_KEYWORDS = 12;

/**
 * True iff `skillName` is one of mage's OWN skills: a `mage:`-namespaced plugin
 * skill (mage:learn, …) OR a generated `mage-wing-*` / `mage-skill-*` skill.
 * Foreign (third-party) skills → false (recorded skill-only).
 */
export function isMageSkill(skillName: string): boolean {
  return (
    skillName.startsWith(MAGE_NAMESPACE) ||
    skillName.startsWith(WING_PREFIX) ||
    skillName.startsWith(SKILL_PREFIX)
  );
}

/** Strip the `mage:` plugin namespace so the bare id is used for path lookup. */
export function normalizeSkillName(skillName: string): string {
  return skillName.startsWith(MAGE_NAMESPACE)
    ? skillName.slice(MAGE_NAMESPACE.length)
    : skillName;
}

/** The wing encoded in a `mage-wing-<wing>` name; null for any other skill. */
function wingFromSkillName(skillName: string): string | null {
  if (!skillName.startsWith(WING_PREFIX)) return null;
  const wing = skillName.slice(WING_PREFIX.length);
  return safeSegment(wing) ? wing : null;
}

/**
 * Snapshot the match signal + trigger_hash for a mage-recognized skill at load
 * time. Returns null when the skill's SKILL.md can't be found/parsed OR the skill
 * isn't a wing skill (a `mage:` plugin skill has no wing/notes mapping) — the
 * caller then records skill-only, exactly like a foreign skill.
 *
 *   match.wing      <- the wing in the skill NAME (never the empty frontmatter tag)
 *   match.keywords  <- keywords aggregated from the wing's real notes
 *   match.paths     <- [] (reserved by ADR-0016 §1; no path-marking syntax yet)
 *   trigger_hash    <- sha256 of the SKILL.md description as loaded
 */
export async function snapshotSkillMatch(
  repoRoot: string,
  skillName: string,
): Promise<{ match: SkillMatch; trigger_hash: string } | null> {
  const normalized = normalizeSkillName(skillName);
  const wing = wingFromSkillName(normalized);
  if (wing === null) return null; // only wing skills carry a wing/notes match in 0.0.5.

  const fm = await readSkillFrontmatter(repoRoot, normalized);
  if (fm === null) return null;

  const keywords = await wingKeywords(repoRoot, wing);
  const description = typeof fm.description === "string" ? fm.description : "";
  return {
    match: { wing, keywords, paths: [] },
    trigger_hash: triggerHash(description),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Read + parse a skill's SKILL.md frontmatter. Tries `.claude/skills/<name>/` then
 * `.agents/skills/<name>/`. Returns null on any miss (readFile-with-catch — no
 * separate exists() probe, so symlinked plugin skills resolve transparently and
 * there is no TOCTOU). `<name>` is sanitized so a malicious id can't escape the
 * skills dir. parseNote hard-blocks executable frontmatter engines (note.ts).
 */
async function readSkillFrontmatter(
  repoRoot: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  if (!safeSegment(name)) return null; // a traversal in the name → refuse the lookup.
  for (const base of [CLAUDE_DIR, AGENTS_SKILLS_DIR]) {
    const file = join(repoRoot, base, "skills", name, "SKILL.md");
    try {
      const raw = await readFile(file, "utf8");
      return parseNote(raw).frontmatter as Record<string, unknown>;
    } catch {
      // try the next dir / fall through to null.
    }
  }
  return null;
}

/**
 * Aggregate keywords from the wing's REAL notes (the load-bearing context-match
 * signal, ADR-0016 §1). Scans the resolved docs root, keeps notes tagged under
 * `wing`, and unions their derived keywords. Returns [] (not null) when the wing
 * has no notes yet — a valid, forward-compatible thin match. Best-effort: any
 * scan error degrades to [].
 */
async function wingKeywords(repoRoot: string, wing: string): Promise<string[]> {
  try {
    const resolved = await resolveDocsRoot(repoRoot);
    if (!resolved) return [];
    const notes = await scanNotes(resolved.root);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of notes) {
      if (!n.wings.some((w) => w.wing === wing)) continue;
      for (const k of n.keywords) {
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(k.slice(0, PATH_MAX));
        if (out.length >= MAX_KEYWORDS) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
