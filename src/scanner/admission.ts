import { recoverCcFrontmatter } from "../adapters/claude-code/cc-note.js";
import type { NoteFrontmatter } from "../note.js";

/** The rungs, lowest first. A note is the rung-5 case. */
export const RUNGS = ["impossible", "check", "hook", "rule", "note"] as const;
export type Rung = (typeof RUNGS)[number];

export interface AdmissionFields {
  /** `<unit>/<rung>/<slug>`, e.g. `repo/note/soak-monitor-blind-spots`. */
  id: string;
  rung: Rung;
  /** One reason per rung above this one. A `note` needs four. */
  skipped: Record<string, string>;
  /** What situation should bring this guard back. One line. */
  trigger: string;
  /** A markdown link to the issue, file or decision this guard points at. */
  pointer: string;
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
 * Validate note frontmatter against the admission schema.
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

  // 1. Validate id
  if (rawId === undefined || rawId === null) {
    problems.push({
      field: "id",
      message: "id is required",
      line: null,
    });
  } else if (typeof rawId !== "string") {
    problems.push({
      field: "id",
      message: "id must be a string",
      line: findFrontmatterLine(rawFile, "id"),
    });
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
  let validRung: Rung | undefined;
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
  } else {
    validRung = rawRung as Rung;
  }

  // 3. Validate skipped
  if (rawSkipped === undefined || rawSkipped === null) {
    problems.push({
      field: "skipped",
      message: "skipped is required",
      line: null,
    });
  } else if (typeof rawSkipped !== "object" || Array.isArray(rawSkipped)) {
    problems.push({
      field: "skipped",
      message: "skipped must be a mapping",
      line: findFrontmatterLine(rawFile, "skipped"),
    });
  } else if (validRung) {
    const skippedMap = rawSkipped as Record<string, unknown>;
    const rungIndex = RUNGS.indexOf(validRung);
    const requiredRungs = RUNGS.slice(0, rungIndex);
    for (const r of requiredRungs) {
      const val = skippedMap[r];
      if (val === undefined || val === null) {
        problems.push({
          field: "skipped",
          message: `missing required skipped reason for "${r}"`,
          line: findFrontmatterLine(rawFile, "skipped"),
        });
      } else if (typeof val !== "string" || !val.trim()) {
        problems.push({
          field: "skipped",
          message: `skipped reason for "${r}" must be a non-empty string`,
          line: findFrontmatterLine(rawFile, "skipped"),
        });
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
  } else if (typeof rawTrigger !== "string" || !rawTrigger.trim()) {
    problems.push({
      field: "trigger",
      message: "trigger must be a non-empty string",
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
