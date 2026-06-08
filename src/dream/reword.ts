// reword — plan rewording a GENERATED skill's `description:` trigger (ADR-0016 §1/§3).
// READ-ONLY planner: it locates the skill's SKILL.md across TARGET_AGENT_DIRS, rewrites
// ONLY the frontmatter `description:` line(s) (the body is untouched), and returns a
// MutationPlan. It NEVER touches disk — the applier enforces the §3 ceilings then writes.
//
// Rewording changes the trigger_hash BY DESIGN: a fresh trigger string resets the
// context-match bucket (the load-bearing predicate, ADR-0016 §1), giving the reworded
// skill a clean window to prove its new trigger. THROWS if the skill isn't found on disk.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TARGET_AGENT_DIRS, yamlDescriptionValue } from "../skills-shared.js";
import type { MutationPlan } from "./types.js";

export interface RewordPayload {
  /** The generated skill name (e.g. `mage-skill-foo` or `mage-wing-bar`). */
  skill: string;
  /** The new one-line `description:` trigger. */
  description: string;
}

/**
 * Plan rewording a generated skill's `description:` trigger. Locates its SKILL.md in
 * every TARGET_AGENT_DIRS dir it exists in, rewrites ONLY the description line(s) in
 * frontmatter (the body stays byte-identical), and writes the result back to each.
 *
 *   writes       = one per dir the skill exists in (the rewritten SKILL.md).
 *   skillTargets = those same paths (bespoke-guarded by the applier — only GEN_MARKER
 *                  skills may be rewritten; a hand-authored skill is refused).
 *   removes      = [].  archives = [].
 *
 * THROWS if the skill's SKILL.md is found in NO target dir (nothing to reword).
 */
export async function planReword(repo: string, payload: RewordPayload): Promise<MutationPlan> {
  const found: Array<{ path: string; content: string }> = [];
  for (const base of TARGET_AGENT_DIRS) {
    const path = join(repo, base, payload.skill, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue; // not in this dir — try the next.
    }
    found.push({ path, content: rewriteDescription(raw, payload.description) });
  }

  if (found.length === 0) {
    throw new Error(
      `mage reword: skill "${payload.skill}" not found in any of ${TARGET_AGENT_DIRS.join(", ")}.`,
    );
  }

  return {
    action: "reword",
    writes: found,
    archives: [],
    removes: [],
    skillTargets: found.map((f) => f.path),
    summary: `reword ${payload.skill} description (${found.length} dir(s))`,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Replace the `description:` line(s) in a SKILL.md's YAML frontmatter with a single
 * `description: <new>` line, keeping everything else (name, wing, GEN_MARKER, body)
 * byte-identical. Operates ONLY within the first `---`…`---` block so a "description:"
 * appearing in the body is never touched. A multi-line (folded/block) description is
 * collapsed to one line: the continuation lines (more-indented than `description:`)
 * are dropped along with the original `description:` line.
 *
 * THROWS if no frontmatter block, or no `description:` key inside it.
 */
function rewriteDescription(raw: string, description: string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("mage reword: SKILL.md has no YAML frontmatter block to reword.");
  }
  // Find the closing fence of the frontmatter block.
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw new Error("mage reword: SKILL.md frontmatter block is unterminated.");
  }

  const out: string[] = [lines[0] as string];
  let replaced = false;
  let i = 1;
  while (i < close) {
    const line = lines[i] as string;
    if (!replaced && /^description\s*:/.test(line)) {
      out.push(`description: ${yamlDescriptionValue(description)}`);
      replaced = true;
      i++;
      // Drop any folded/block continuation lines (more-indented than the key).
      while (i < close) {
        const cont = lines[i] as string;
        if (/^\s/.test(cont) && cont.trim().length > 0) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    out.push(line);
    i++;
  }

  if (!replaced) {
    throw new Error("mage reword: SKILL.md frontmatter has no `description:` key to reword.");
  }

  // Re-attach the closing fence + body verbatim.
  for (let j = close; j < lines.length; j++) out.push(lines[j] as string);
  return out.join("\n");
}
