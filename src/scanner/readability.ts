export interface ReadabilityProblem {
  rule: string;
  message: string;
  line: number;
}

export const JARGON_WORDS = [
  "substrate",
  "wedge",
  "vector",
  "locus",
  "harness",
  "surface",
  "primitive",
  "paradigm",
  "north star",
  "flywheel",
  "leverage",
  "utilize",
  "delve",
  "landscape",
  "tapestry",
  "testament",
  "pivotal",
  "crucial",
  "showcase",
  "underscore",
] as const;

const JARGON_PATTERN = new RegExp(
  `\\b(${JARGON_WORDS.join("|")})\\b`,
  "gi",
);

const SELF_CONTAINED_PATTERNS: RegExp[] = [
  /\bsection \d+(?:\.\d+)*\b/gi,
  /\bthe plan page\b/gi,
  /\btonight['’]s ruling\b/gi,
  /\bWP-\d+\b/gi,
  /\bthe inventory\b/gi,
  /\bthe redirection page\b/gi,
];

const CODE_FENCE_PATTERN = /^\s*(```|~~~)/;

/**
 * Check a note file for readability rules: length, self-contained references, and plain words.
 * Returns an empty array when all rules pass.
 */
export function checkReadability(rawFile: string): ReadabilityProblem[] {
  const problems: ReadabilityProblem[] = [];
  const lines = rawFile.split(/\r?\n/);

  // Identify frontmatter boundaries
  let bodyStartIndex = 0;
  if (lines.length > 0 && lines[0]?.trim() === "---") {
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        closingIndex = i;
        break;
      }
    }
    if (closingIndex !== -1) {
      bodyStartIndex = closingIndex + 1;
    }
  }

  const bodyLines = lines.slice(bodyStartIndex);
  let trimmedBodyLines = bodyLines;
  if (
    trimmedBodyLines.length > 0 &&
    trimmedBodyLines[trimmedBodyLines.length - 1] === ""
  ) {
    trimmedBodyLines = trimmedBodyLines.slice(0, -1);
  }

  const bodyStartLine = bodyStartIndex + 1;

  // 1. Length rule: under 40 lines and under 350 words
  const lineCount = trimmedBodyLines.length;
  if (lineCount >= 40) {
    problems.push({
      rule: "length",
      message: `body has ${lineCount} lines (limit is under 40)`,
      line: bodyStartLine,
    });
  }

  const bodyText = trimmedBodyLines.join("\n");
  const words = bodyText.match(/\S+/g) ?? [];
  const wordCount = words.length;
  if (wordCount >= 350) {
    problems.push({
      rule: "length",
      message: `body has ${wordCount} words (limit is under 350)`,
      line: bodyStartLine,
    });
  }

  // 2 and 3: Self-contained and Plain words rules
  let inCodeBlock = false;

  for (let idx = bodyStartIndex; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const lineNumber = idx + 1;

    if (CODE_FENCE_PATTERN.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    // Mask inline code spans for plain-words check
    const maskedLine = line.replace(/`+[^`]*`+/g, (match) =>
      " ".repeat(match.length),
    );

    // Rule 2: Self-contained references
    // Find all markdown link spans on this line: [text](target)
    const linkRanges: [number, number][] = [];
    const linkRegex = /\[[^\]]*\]\([^)]*\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRegex.exec(line)) !== null) {
      linkRanges.push([lm.index, lm.index + lm[0].length]);
    }

    // Find all inline code spans on this line
    const codeRanges: [number, number][] = [];
    const codeRegex = /`+[^`]*`+/g;
    let cm: RegExpExecArray | null;
    while ((cm = codeRegex.exec(line)) !== null) {
      codeRanges.push([cm.index, cm.index + cm[0].length]);
    }

    for (const pattern of SELF_CONTAINED_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const insideLink = linkRanges.some(
          ([ls, le]) => start >= ls && end <= le,
        );
        const insideCode = codeRanges.some(
          ([cs, ce]) => start >= cs && end <= ce,
        );
        if (!insideLink && !insideCode) {
          problems.push({
            rule: "self-contained",
            message: `unlinked reference to "${match[0]}"`,
            line: lineNumber,
          });
        }
      }
    }

    // Rule 3: Plain words
    if (maskedLine.includes("\u2014")) {
      problems.push({
        rule: "plain-words",
        message: "em dash (—) is disallowed",
        line: lineNumber,
      });
    }

    JARGON_PATTERN.lastIndex = 0;
    let jm: RegExpExecArray | null;
    while ((jm = JARGON_PATTERN.exec(maskedLine)) !== null) {
      problems.push({
        rule: "plain-words",
        message: `jargon word "${jm[0]}" is disallowed`,
        line: lineNumber,
      });
    }
  }

  return problems;
}
