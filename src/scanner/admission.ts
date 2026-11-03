import { recoverCcFrontmatter } from "../adapters/claude-code/cc-note.js";
import type { NoteFrontmatter } from "../note.js";
import { parseTrigger } from "./trigger.js";

/** The rungs, lowest first. A note is the rung-5 case. */
export const RUNGS = ["impossible", "check", "hook", "rule", "note"] as const;
export type Rung = (typeof RUNGS)[number];

export interface AdmissionFields {
  rung: Rung;
  /** The moment it matters: prose, or `{when, match}` for recall at the action (#282). */
  trigger: string | { when: string; match?: string | string[] };
  /** A markdown link to the issue, file or decision this guard points at. */
  pointer: string;
  /** Optional; `<unit>/<rung>/<slug>`, e.g. `repo/note/soak-monitor-blind-spots`. */
  id?: string;
  /** Optional; one reason per rung passed over. A missing rung is fine. */
  skipped?: Record<string, string>;
}

export interface AdmissionProblem {
  field: string;
  message: string;
  /** 1-indexed line in the file, or null when the field is absent entirely. */
  line: number | null;
}

const ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*\/(impossible|check|hook|rule|note)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MARKDOWN_LINK_PATTERN = /\[.+?\]\(.+?\)/;

/** Locate the 1-indexed line of a field inside the frontmatter block, or null. */
function findFrontmatterLine(rawFile: string, field: string): number | null {
  const lines = rawFile.split(/\r?\n/);
  if (lines.length === 0 || lines[0]?.trim() !== "---") return null;

  let closingLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingLine = i;
      break;
    }
  }
  if (closingLine === -1) return null;

  const fieldRegex = new RegExp(`^\\s*${field}\\s*:`);
  for (let i = 1; i < closingLine; i++) {
    if (fieldRegex.test(lines[i] ?? "")) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Validate note frontmatter against the admission schema (#282): `rung`, `trigger` and
 * `pointer` are required; `id` and `skipped` are checked only when present.
 * Reports every problem found; returns an empty array when valid.
 */
export function checkAdmission(
  frontmatter: unknown,
  rawFile: string,
): AdmissionProblem[] {
  const problems: AdmissionProblem[] = [];

  const rawObj =
    frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
      ? (frontmatter as NoteFrontmatter)
      : undefined;

  const recovered: Record<string, unknown> = rawObj
    ? recoverCcFrontmatter(rawObj).frontmatter
    : {};

  const rawId = recovered.id;
  const rawRung = recovered.rung;
  const rawSkipped = recovered.skipped;
  const rawTrigger = recovered.trigger;
  const rawPointer = recovered.pointer;

  // 1. Validate id (optional, checked when present)
  if (typeof rawId !== "string") {
    if (rawId !== undefined && rawId !== null) {
      problems.push({
        field: "id",
        message: "id must be a string",
        line: findFrontmatterLine(rawFile, "id"),
      });
    }
  } else {
    const match = ID_PATTERN.exec(rawId);
    if (!match) {
      problems.push({
        field: "id",
        message: `id "${rawId}" does not match required pattern <unit>/<rung>/<slug>`,
        line: findFrontmatterLine(rawFile, "id"),
      });
    } else if (typeof rawRung === "string" && (RUNGS as readonly string[]).includes(rawRung)) {
      const middleSegment = match[1];
      if (middleSegment !== rawRung) {
        problems.push({
          field: "id",
          message: `id middle segment "${middleSegment}" does not match rung "${rawRung}"`,
          line: findFrontmatterLine(rawFile, "id"),
        });
      }
    }
  }

  // 2. Validate rung
  if (rawRung === undefined || rawRung === null) {
    problems.push({
      field: "rung",
      message: "rung is required",
      line: null,
    });
  } else if (typeof rawRung !== "string" || !(RUNGS as readonly string[]).includes(rawRung)) {
    problems.push({
      field: "rung",
      message: `rung "${String(rawRung)}" must be one of: ${RUNGS.join(", ")}`,
      line: findFrontmatterLine(rawFile, "rung"),
    });
  }

  // 3. Validate skipped (optional, checked when present)
  if (rawSkipped !== undefined && rawSkipped !== null) {
    if (typeof rawSkipped !== "object" || Array.isArray(rawSkipped)) {
      problems.push({
        field: "skipped",
        message: "skipped must be a mapping",
        line: findFrontmatterLine(rawFile, "skipped"),
      });
    } else {
      for (const [r, val] of Object.entries(rawSkipped as Record<string, unknown>)) {
        if (typeof val !== "string" || !val.trim()) {
          problems.push({
            field: "skipped",
            message: `skipped reason for "${r}" must be a non-empty string`,
            line: findFrontmatterLine(rawFile, "skipped"),
          });
        }
      }
    }
  }

  // 4. Validate trigger
  if (rawTrigger === undefined || rawTrigger === null) {
    problems.push({
      field: "trigger",
      message: "trigger is required",
      line: null,
    });
  } else if (parseTrigger(rawTrigger) === null) {
    problems.push({
      field: "trigger",
      message: "trigger must be a non-empty string, or a mapping with a non-empty when",
      line: findFrontmatterLine(rawFile, "trigger"),
    });
  }

  // 5. Validate pointer
  if (rawPointer === undefined || rawPointer === null) {
    problems.push({
      field: "pointer",
      message: "pointer is required",
      line: null,
    });
  } else if (typeof rawPointer !== "string" || !MARKDOWN_LINK_PATTERN.test(rawPointer)) {
    problems.push({
      field: "pointer",
      message: "pointer must contain at least one markdown link [text](target)",
      line: findFrontmatterLine(rawFile, "pointer"),
    });
  }

  return problems;
}
