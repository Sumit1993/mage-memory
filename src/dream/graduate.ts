// graduate — plan a note → Procedure SKILL.md graduation (ADR-0019 §5, ADR-0013 §1).
// READ-ONLY planner: it renders the SKILL.md + the re-written note and returns a
// MutationPlan of INTENDED writes. It NEVER touches disk — the single applier
// (applier.ts) enforces the §3 ceilings then performs every write.
//
// Only PROCEDURAL notes graduate: a skill is auto-loaded into context, so it must be
// an actionable PROCEDURE, not a fact (ADR-0019 §5). renderProcedureSkill THROWS if the
// note's type is not "playbook"/"gotcha" — a structural gate, not a runtime check.
// The backing note stays the substrate (ADR-0013 §1): graduation re-writes it with a
// `graduated_skill` pointer; it is never deleted.

import { join } from "node:path";
import { type Note, stringifyNote } from "../note.js";
import {
  GEN_MARKER,
  procedureSkillName,
  procedureSkillSlug,
  SKILL_PREFIX,
  TARGET_AGENT_DIRS,
  yamlDescriptionValue,
} from "../skills-shared.js";
import type { MutationPlan } from "./types.js";

/** Note types that graduate — a skill auto-loads a PROCEDURE, not a fact (ADR-0019 §5). */
const GRADUATABLE_TYPES: ReadonlySet<string> = new Set(["playbook", "gotcha"]);

/**
 * Render a Procedure SKILL.md from a playbook/gotcha note. Mirrors `renderWingSkill`
 * (skills-cmd.ts) for shape: `---`/`name:`/`description:`/`wing:`/`---`, blank,
 * GEN_MARKER, blank, `# <title>`, the procedure body, the backing-note pointer.
 *
 * Carries (so the applier recognizes it + snapshotSkillMatch can score it):
 *   - GEN_MARKER (mage-owned, safe to mutate/remove — ADR-0016 §3).
 *   - `name: mage-skill-<slug>`.
 *   - a `description:` "Load when…" trigger (the optimize target, ADR-0016 §1).
 *   - `wing: <wing>` so snapshotSkillMatch reads the wing from frontmatter.
 *
 * THROWS if `note.frontmatter.type` is not "playbook" or "gotcha" (structural gate).
 */
export function renderProcedureSkill(
  slug: string,
  note: Note,
  wing: string,
  noteRelPath: string,
): string {
  const type = typeof note.frontmatter.type === "string" ? note.frontmatter.type.trim() : "";
  if (!GRADUATABLE_TYPES.has(type)) {
    throw new Error(
      `mage graduate: only playbook/gotcha notes graduate to a skill (got type "${type || "(none)"}"). ` +
        `A skill is auto-loaded — you auto-load a procedure, not a fact (ADR-0019 §5).`,
    );
  }

  const name = procedureSkillName(slug);
  const title = noteTitleOf(note, slug);
  const body = note.body.trim();

  const out: string[] = [
    "---",
    `name: ${name}`,
    `description: ${yamlDescriptionValue(describeTrigger(title, wing))}`,
    `wing: ${wing}`,
    "---",
    "",
    GEN_MARKER,
    "",
    `# ${title}`,
    "",
    body,
    "",
    "## Backing note",
    "",
    `This skill graduated from \`${noteRelPath}\` — the note stays the substrate (ADR-0013 §1). ` +
      "Verify the note before relying on a stale procedure; capture refinements there, then re-run `mage promote`.",
    "",
  ];
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * Plan graduating a note → Procedure skill. Pure planner.
 *   writes       = the SKILL.md into BOTH TARGET_AGENT_DIRS + the note re-written
 *                  with a `graduated_skill: mage-skill-<slug>` pointer (+ bumped `updated`).
 *   skillTargets = the two SKILL.md abs paths (bespoke-guarded by the applier).
 *   removes      = [].  archives = [].
 */
export async function planGraduate(
  repo: string,
  docsRoot: string,
  noteRelPath: string,
  note: Note,
  wing: string,
): Promise<MutationPlan> {
  const slug = procedureSkillSlug(noteTitleOf(note, "note"));
  const name = procedureSkillName(slug);
  const skillBody = renderProcedureSkill(slug, note, wing, noteRelPath);

  const skillTargets = TARGET_AGENT_DIRS.map((base) => join(repo, base, name, "SKILL.md"));
  const writes = skillTargets.map((path) => ({ path, content: skillBody }));

  // Re-write the note with the graduated_skill pointer (+ bumped updated). Immutable:
  // a fresh frontmatter object, never a mutation of note.frontmatter.
  const notePath = join(docsRoot, noteRelPath);
  const updated = todayStamp();
  const newFrontmatter = {
    ...note.frontmatter,
    graduated_skill: name,
    updated,
  };
  writes.push({ path: notePath, content: stringifyNote(newFrontmatter, note.body) });

  return {
    action: "graduate",
    writes,
    archives: [],
    removes: [],
    skillTargets,
    summary: `graduate ${noteRelPath} → ${name} (${TARGET_AGENT_DIRS.length} dir(s))`,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** The skill's display title: the note's H1, else its frontmatter, else the slug. */
function noteTitleOf(note: Note, fallback: string): string {
  const h1 = note.body.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim();
  if (typeof note.frontmatter.title === "string" && note.frontmatter.title.trim()) {
    return note.frontmatter.title.trim();
  }
  return fallback;
}

/** A one-line `Load when…` trigger (the optimize target — ADR-0016 §1). */
function describeTrigger(title: string, wing: string): string {
  const where = wing ? ` in the ${wing} wing` : "";
  return `${title} — a proven procedure${where}. Load when the task matches this situation so you don't relearn it.`;
}

/** UTC YYYY-MM-DD stamp for the bumped `updated` field. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// Re-export so callers can branch on the gate without importing the set directly.
export { SKILL_PREFIX };
