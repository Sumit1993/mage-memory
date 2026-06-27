// The docs-site data generator (single source of truth → docs).
//
// The mage docs website (docs/) must NOT hand-copy volatile facts — thresholds,
// the hook table — because they drift. This module derives them from the SAME
// runtime constants the CLI uses (`BASE_THRESHOLDS`, `thresholdsFor`, `MAGE_HOOKS`),
// so the generated reference is the code, rendered.
//
// Flow: `scripts/gen-docs.mjs` (post-build) imports `buildGeneratedDocsData` from
// the package entry and writes docs/src/generated/mage-data.json. A vitest drift
// test (generated-data.test.ts) re-derives it from src and fails CI if the
// committed JSON is stale — so a threshold or hook change that skips `pnpm docs:gen`
// breaks the build, not your memory.
//
// PURE: imports constants only, no fs / no async. Deterministic key order so the
// JSON diff is stable.

import { type Command, Help } from "commander";
import { MAGE_HOOKS } from "../adapters/claude-code/settings.js";
import { buildProgram } from "../cli-program.js";
import {
  BASE_THRESHOLDS,
  DEFAULT_SENSITIVITY,
  MIN_CHAPTER_WORK_EVENTS,
  type Sensitivity,
  thresholdsFor,
} from "../grooming/thresholds.js";

/** Bump when the JSON shape changes (the site reads against this). v2 added the `commands` inventory. */
export const DOCS_DATA_SCHEMA = 2;

/** One row of the thresholds reference table. Value comes from code; the prose is authored once here. */
export interface ThresholdRow {
  key: keyof typeof BASE_THRESHOLDS;
  /** Short symbol where the codebase uses one (K / M), else "". */
  symbol: string;
  value: number;
  /** Does the sensitivity dial scale this field? (Only the two recurrence gates do.) */
  dialScaled: boolean;
  /** What it gates — authored prose, kept beside the value so the table is self-describing. */
  meaning: string;
}

/** One row of the hook reference table — event, id, command from MAGE_HOOKS; purpose authored. */
export interface HookRow {
  event: string;
  id: string;
  command: string;
  purpose: string;
}

/** One declared option of a command — the raw `--flag` spec and its one-line description. */
export interface CommandOption {
  /** The flags string exactly as declared (e.g. "-d, --dir <path>"). */
  flags: string;
  /** The option's one-line description (may be "" for an undocumented flag). */
  description: string;
}

/**
 * One registered CLI command, as a structural inventory derived from
 * `buildProgram()`. NO example prose — examples are hand-authored later from
 * this skeleton. Only the facts commander already knows.
 */
export interface CommandRow {
  /** The command verb (e.g. "init", "connect"). */
  name: string;
  /** The one-line summary (commander's `.summary()`, falling back to `.description()`). */
  summary: string;
  /** Declared aliases in declaration order (empty when none). */
  aliases: string[];
  /**
   * True for hook-only plumbing commands hidden from `mage --help`. Determined
   * via commander's Help class (visibleCommands), never a private field.
   */
  hidden: boolean;
  /** Declared options in declaration order (commander injects no `--help` here). */
  options: CommandOption[];
}

export interface GeneratedDocsData {
  schema: number;
  thresholds: {
    rows: ThresholdRow[];
    /** The recurrence gates per dial position — the only dial-scaled fields. */
    sensitivities: Record<Sensitivity, { promoteSessions: number; graduateSessions: number }>;
    defaultSensitivity: Sensitivity;
    /** Min WORK events for a compact chapter to count as one recurrence unit. */
    minChapterWorkEvents: number;
  };
  hooks: HookRow[];
  /** The CLI command inventory, derived from `buildProgram()` in registration order. */
  commands: CommandRow[];
}

// Authored prose, keyed by field — the *values* above are generated, these explain them.
const THRESHOLD_MEANING: Record<keyof typeof BASE_THRESHOLDS, { symbol: string; dialScaled: boolean; meaning: string }> = {
  promoteSessions: {
    symbol: "K",
    dialScaled: true,
    meaning:
      "Distinct compact-chapters a pattern must recur across (with no covering note) before `mage promote` drafts a NEW note candidate. Counts chapters, not session ids — one continuously-compacted chat still accrues recurrence.",
  },
  graduateSessions: {
    symbol: "M",
    dialScaled: true,
    meaning:
      "Distinct compact-chapters a proven procedural note must recur across before it can graduate into its own loadable `mage-skill-<slug>`.",
  },
  noteSizeCap: {
    symbol: "",
    dialScaled: false,
    meaning: "Authored-note body char cap; past it `mage groom` proposes a split. A quality floor — the dial never moves it.",
  },
  rewordRate: {
    symbol: "",
    dialScaled: false,
    meaning: "Context-match rate below which a generated skill's trigger is flagged for reword (imported from context-match.ts; single-sourced).",
  },
  demoteRate: {
    symbol: "",
    dialScaled: false,
    meaning: "Context-match rate below which a generated skill is flagged for demote back to its note (imported from context-match.ts).",
  },
  minLoads: {
    symbol: "",
    dialScaled: false,
    meaning: "Minimum skill auto-loads before context-match is allowed to suggest reword/demote — no judgement on thin evidence.",
  },
  editBudget: {
    symbol: "",
    dialScaled: false,
    meaning: "Max edits `mage:optimize` applies per pass — a bounded textual learning rate so a skill never thrashes.",
  },
  promotionBudget: {
    symbol: "",
    dialScaled: false,
    meaning: "Max note candidates `mage promote` surfaces per pass (ranked strongest-first); the rest defer to the next pass.",
  },
  lessonNoteCap: {
    symbol: "",
    dialScaled: false,
    meaning: "SOFT target size for an organic lesson draft (`mage stage`) — one distilled fact + Why/How. `mage stage` warns past it but never blocks (frictionless inline capture).",
  },
  stagingBudget: {
    symbol: "",
    dialScaled: false,
    meaning: "Max staged lesson drafts `mage groom` surfaces per pass (anti-flood); the rest defer.",
  },
};

// Authored purpose, keyed by hook id — event/command come from MAGE_HOOKS.
const HOOK_PURPOSE: Record<string, string> = {
  "mage:observe:SessionStart": "Capture session-start context into the git-ignored learnings scratch.",
  "mage:nudge:SessionStart":
    "The boundary nudge: on a post-compaction SessionStart, surface the just-closed chapter's earned-signal digest (failures, external commands, corrections) as additionalContext for the agent to mine and `mage stage` (ADR-0029). The additionalContext is scaled by the per-KB autonomy level (Operator/Approver/Overseer, ADR-0030): at Operator it is a reminder; at Approver/Overseer it becomes the agent's mandate to groom and write durable notes into the working tree (uncommitted, Gate-2 enforced). It also carries a deterministic capped backlog tally — staged drafts, unmined closed chapters (capped at 9+), and graduation-eligible signatures from the persisted promote tally — rendered as one work-list line. Fires on SessionStart source compact/startup/resume (clear stays a fast no-op); the backlog scan is mtime-gated so a no-new-scratch startup/resume stays ~instant.",
  "mage:observe:UserPromptSubmit": "Capture the prompt's intent.",
  "mage:observe:PostToolUse": "Capture each tool use — which tool, which files, which skill loaded.",
  "mage:observe:PostToolUseFailure": "Capture tool failures (a distinct salient signal).",
  "mage:observe:PreCompact": "Mark the chapter boundary just before the host compacts.",
  "mage:observe:SessionEnd": "Capture session end.",
  "mage:metrics:Stop": "Roll up context-match: did the skills that auto-loaded actually match the work that followed?",
  "mage:observe:Stop": "Capture the agent's final reply (ADR-0019 amendment to ADR-0015).",
  "mage:observe:SubagentStop": "Capture autonomous subagent work — a Task subagent's final reply, the one capture point for multi-agent workflows.",
};

/**
 * Derive the generated docs data from the live runtime constants. Pure +
 * deterministic — the same input constants always produce byte-identical JSON.
 */
export function buildGeneratedDocsData(): GeneratedDocsData {
  const rows: ThresholdRow[] = (Object.keys(BASE_THRESHOLDS) as (keyof typeof BASE_THRESHOLDS)[]).map((key) => {
    const m = THRESHOLD_MEANING[key];
    return { key, symbol: m.symbol, value: BASE_THRESHOLDS[key], dialScaled: m.dialScaled, meaning: m.meaning };
  });

  const sensitivities = {
    low: gateOnly(thresholdsFor("low")),
    normal: gateOnly(thresholdsFor("normal")),
    high: gateOnly(thresholdsFor("high")),
  };

  const hooks: HookRow[] = MAGE_HOOKS.map((h) => ({
    event: h.event,
    id: h.id,
    command: h.command,
    purpose: HOOK_PURPOSE[h.id] ?? "",
  }));

  return {
    schema: DOCS_DATA_SCHEMA,
    thresholds: { rows, sensitivities, defaultSensitivity: DEFAULT_SENSITIVITY, minChapterWorkEvents: MIN_CHAPTER_WORK_EVENTS },
    hooks,
    commands: commandInventory(),
  };
}

/**
 * The structural CLI command inventory, derived from `buildProgram()`. Pure:
 * `buildProgram()` is side-effect-free on import (it parses no argv). We preserve
 * commander's registration order for commands and the declared order for options,
 * so the rendered JSON is deterministic. Visibility is computed from commander's
 * Help class rather than reaching into a private `_hidden` field.
 */
function commandInventory(): CommandRow[] {
  const program = buildProgram();
  const visible = new Set<Command>(new Help().visibleCommands(program));
  return program.commands.map((cmd) => ({
    name: cmd.name(),
    summary: cmd.summary() || cmd.description(),
    aliases: cmd.aliases(),
    hidden: !visible.has(cmd),
    options: cmd.options.map((opt) => ({ flags: opt.flags, description: opt.description })),
  }));
}

function gateOnly(t: { promoteSessions: number; graduateSessions: number }) {
  return { promoteSessions: t.promoteSessions, graduateSessions: t.graduateSessions };
}

/** Canonical serialization the generator writes and the drift test compares (trailing newline). */
export function serializeGeneratedDocsData(data: GeneratedDocsData): string {
  return JSON.stringify(data, null, 2) + "\n";
}
