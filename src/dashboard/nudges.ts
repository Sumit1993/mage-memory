// DATA-DRIVEN command nudges + a commands reference card for the cockpit.
//
// The cockpit's owner doesn't remember every mage command. This module derives,
// from a {@link DashboardData} snapshot, small *contextual* nudges that tell them
// WHICH command to run next — and an always-available grouped reference card.
//
// Two design rules, both load-bearing:
//   1. PURE + DETERMINISTIC. `computeNudges(data)` reads only `data`, never the
//      clock / filesystem / randomness, so the same snapshot always yields the
//      same array. The HTML renderer embeds these, so determinism keeps the
//      output byte-stable (the dashboard's existing contract).
//   2. SUPPRESSION via thresholds. Capture/getting-started/notes nudges vanish
//      once notes pass their threshold; the proposal/distill nudges vanish once
//      proposals exist; graduate vanishes once a skill exists; health/optimize
//      are issue-gated. Net: a MATURE knowledge base shows few-to-no nudges, so
//      it stays clean while a cold one is gently guided.
//
// Command vocabulary (verified against the CLI surface + the in-repo skills):
//   - a `mage:`-prefixed name is a Claude Code SKILL — run it inside a Claude
//     session (mage:learn, mage:graduate, mage:optimize).
//   - a bare `mage ...` is a TERMINAL command (mage distill, mage promote,
//     mage dream, mage index, mage skills, mage dashboard --html, mage ingest,
//     mage connect, mage doctor, mage disconnect, mage link/list/verify/status).
//   - `mage observe` is hook-fired (never user-run) and is deliberately absent.

import type { DashboardData } from "./types.js";

/** Which cockpit panel a nudge attaches to (drives where the renderer mounts it). */
export type NudgePanel =
  | "getting-started"
  | "proposals"
  | "ladder"
  | "notes"
  | "skills"
  | "health"
  | "connection";

/** One contextual nudge: a target panel, the exact command(s) to run, and why. */
export interface Nudge {
  panel: NudgePanel;
  commands: string[];
  why: string;
}

// ─── thresholds (centralized, named — the suppression knobs) ──────────────────

/** At/below this note count the KB is "cold": the getting-started banner shows. */
export const COLD_NOTES = 5;
/** At/below this note count the KB is still "sparse": the grow-notes nudge shows. */
export const SPARSE_NOTES = 15;
/** A skill firing below this context-match % is mis-triggered → suggest optimize. */
export const LOW_MATCH = 50;

/**
 * Derive the contextual command nudges for a snapshot. PURE + DETERMINISTIC:
 * reads only `data`; same input → same output (no clock, no randomness). The
 * returned order is stable (the rules are applied in a fixed sequence).
 *
 * Suppression is baked into the conditions — see the module header. A mature KB
 * (many notes, a skill, no proposals, healthy graph) returns few-to-no nudges.
 */
export function computeNudges(data: DashboardData): Nudge[] {
  const nudges: Nudge[] = [];
  const { kpis, proposals, ladder, skills, health } = data;

  // 1. getting-started — the cold-KB welcome banner.
  if (kpis.notes <= COLD_NOTES) {
    nudges.push({
      panel: "getting-started",
      commands: ["mage:learn", "mage distill"],
      why: "Capture your first notes — run mage:learn in a Claude Code session, or mage distill to mine sessions mage has already observed.",
    });
  }

  // 2. proposals — no candidates to judge yet: how to generate some.
  if (proposals.length === 0) {
    nudges.push({
      panel: "proposals",
      commands: ["mage distill", "mage promote", "mage dream"],
      why: "No proposals yet. Generate candidates from what mage observed: distill (scratch -> notes), promote (proven notes -> skills), dream (health sweep).",
    });
  }

  // 3. ladder (distill) — observed events are waiting and nothing is queued.
  if (ladder.scratch > 0 && proposals.length === 0) {
    nudges.push({
      panel: "ladder",
      commands: ["mage distill"],
      why: `${ladder.scratch} observed events are waiting — distill them into notes.`,
    });
  }

  // 4. skills (graduate) — notes proven, but no skill yet. Mounts in the Skills tab.
  if (ladder.notes >= 3 && kpis.skills === 0) {
    nudges.push({
      panel: "skills",
      commands: ["mage:graduate"],
      why: "You have notes but no skills — graduate a proven note into an auto-loading skill.",
    });
  }

  // 5. notes — sparse KB: how to grow it (capture or import).
  if (kpis.notes <= SPARSE_NOTES) {
    nudges.push({
      panel: "notes",
      commands: ["mage:learn", "mage ingest <dir>"],
      why: "Grow the knowledge base — capture with mage:learn, or import existing docs with mage ingest <dir> then mage:learn --from.",
    });
  }

  // 6. skills (optimize) — issue-gated: any skill firing in the wrong context.
  if (skills.some((s) => s.contextMatchPct != null && s.contextMatchPct < LOW_MATCH)) {
    nudges.push({
      panel: "skills",
      commands: ["mage:optimize"],
      why: "A skill is firing in the wrong context — mage:optimize tightens its triggers.",
    });
  }

  // 7. health — issue-gated: any dangling links / orphans / overdue reviews.
  if (health.danglingLinks + health.orphanNotes + health.notesDueForReview > 0) {
    nudges.push({
      panel: "health",
      commands: ["mage dream", "mage index"],
      why: "Heal the graph — dream surfaces these as proposals; index rebuilds INDEX.md after edits.",
    });
  }

  // 8. connection — capture is quiet: wire mage into the agent's sessions.
  if (ladder.scratch === 0) {
    nudges.push({
      panel: "connection",
      commands: ["mage connect"],
      why: "Capture is quiet — wire mage into your Claude Code sessions with mage connect so it learns as you work.",
    });
  }

  return nudges;
}

/** One reference row: an exact invocation + a one-line description. */
interface CommandRef {
  cmd: string;
  desc: string;
}

/** One reference group: a section heading + its rows. */
interface CommandRefGroup {
  group: string;
  items: CommandRef[];
}

/**
 * The always-available grouped command reference. Mostly CONSTANT — `data` only
 * gates the hub-only rows (the "Hub" group is appended for a hub KB). `mage
 * observe` is intentionally omitted (it is hook-fired, never user-run).
 */
export function commandReference(data: DashboardData): CommandRefGroup[] {
  const groups: CommandRefGroup[] = [
    {
      group: "Capture",
      items: [
        { cmd: "mage:learn", desc: "save a note" },
        { cmd: "mage ingest <dir>", desc: "find importable docs" },
        { cmd: "mage connect", desc: "auto-capture from sessions" },
      ],
    },
    {
      group: "Curate",
      items: [
        { cmd: "mage distill", desc: "scratch -> notes" },
        { cmd: "mage promote", desc: "used notes -> skills" },
        { cmd: "mage:graduate", desc: "note -> skill" },
        { cmd: "mage:optimize", desc: "tune skill triggers" },
        { cmd: "mage dream", desc: "health + apply proposals" },
      ],
    },
    {
      group: "Maintain",
      items: [
        { cmd: "mage index", desc: "rebuild INDEX" },
        { cmd: "mage skills", desc: "regenerate wing skills" },
        { cmd: "mage dashboard --html", desc: "refresh this cockpit" },
      ],
    },
    {
      group: "Setup & health",
      items: [
        { cmd: "mage doctor", desc: "env + KB health" },
        { cmd: "mage doctor --fix", desc: "repair ignores" },
        { cmd: "mage doctor --report", desc: "bundle for issues" },
        { cmd: "mage disconnect", desc: "stop capture" },
      ],
    },
  ];

  if (data.meta.kind === "hub") {
    groups.push({
      group: "Hub",
      items: [
        { cmd: "mage link <hub>", desc: "link a code repo to this hub" },
        { cmd: "mage list", desc: "list registered projects" },
        { cmd: "mage verify", desc: "sanity-check hub structure" },
        { cmd: "mage status <repo>", desc: "per-machine link health" },
      ],
    });
  }

  return groups;
}
