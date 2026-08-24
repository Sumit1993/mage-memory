import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

export interface Violation {
  file: string;
  line: number;
  lineContent: string;
  reason: string;
}

export interface Exemption {
  file: string;
  pattern: RegExp;
  category: "pass-through" | "recording" | "injected-read" | "machine-root" | "build-metadata" | "provisioning";
  rationale: string;
}

/**
 * ADR-0045 §7: No correctness path branches on environment identity.
 * Permitted exemptions are named explicitly below with category and rationale.
 */
export const EXEMPTIONS: readonly Exemption[] = [
  {
    file: "src/shell.ts",
    pattern: /env:\s*\{\s*\.\.\.process\.env,\s*\.\.\.opts\.env\s*\}/,
    category: "pass-through",
    rationale: "Pass-through to child process (ADR-0045 §7)",
  },
  {
    file: "src/commands/observe.ts",
    pattern: /process\.env\.CLAUDE_CODE_ENTRYPOINT\s*\|\|\s*"claude-code"/,
    category: "recording",
    rationale: "Stamping which harness produced a capture (ADR-0045 §7)",
  },
  {
    file: "src/hub-url.ts",
    pattern: /process\.env\.MAGE_HOME/,
    category: "machine-root",
    rationale: "Single machine state root relocation contract (ADR-0045 §1)",
  },
  {
    file: "src/version.ts",
    pattern: /process\.env\.npm_package_version/,
    category: "build-metadata",
    rationale: "Build/runtime package version lookup",
  },
  {
    file: "src/adapters/claude-code/settings.ts",
    pattern: /env:\s*NodeJS\.ProcessEnv\s*=\s*process\.env/,
    category: "injected-read",
    rationale: "Injected parameter default in adapter layer (ADR-0045 §7)",
  },
  {
    file: "src/adapters/claude-code/settings.ts",
    pattern: /env\.CLAUDE_CODE_DISABLE_AUTO_MEMORY/,
    category: "injected-read",
    rationale: "Injected harness config read in adapter layer",
  },
  {
    file: "src/adapters/claude-code/projects.ts",
    pattern: /claudeHome\(env:\s*NodeJS\.ProcessEnv\s*=\s*process\.env\)/,
    category: "injected-read",
    rationale: "Injected parameter default in adapter layer (ADR-0045 §7)",
  },
  {
    file: "src/adapters/claude-code/projects.ts",
    pattern: /env\.CLAUDE_CONFIG_DIR/,
    category: "injected-read",
    rationale: "Injected harness config read in adapter layer",
  },
  {
    file: "src/adapters/claude-code/plugins.ts",
    pattern: /env:\s*NodeJS\.ProcessEnv\s*=\s*process\.env/,
    category: "injected-read",
    rationale: "Injected parameter default in adapter layer (ADR-0045 §7)",
  },
  {
    file: "scripts/cloud-setup.sh",
    pattern: /CLAUDE_CODE_REMOTE/,
    category: "provisioning",
    rationale:
      "Installs tooling on a blank VM; it decides what to INSTALL, not what mage does, so ADR-0045 §7's correctness-path rule does not reach it. The check must stay: this script is wired to SessionStart in .claude/settings.json, and without it a local session would apt-install gh and npm -g the PUBLISHED mage over a contributor's working tree.",
  },
];

/**
 * Markers that indicate environment identity, test runners, CI systems, or cloud VMs.
 * Production code and shipped scripts must never branch on these.
 */
export const FORBIDDEN_ENV_MARKERS = [
  "VITEST",
  "JEST_WORKER_ID",
  "MOCHA",
  "CLAUDE_CODE_REMOTE",
  "CODESPACES",
  "GITPOD",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "JENKINS",
  "AWS_EXECUTION_ENV",
  "VERCEL",
  "NETLIFY",
  "REPLIT",
] as const;

/**
 * Strip comments from a line to check only executable code. Quote-aware on purpose:
 * a plain indexOf cut `fetch("https://x", process.env.CI)` at the URL and hid the read,
 * which is a silent false negative in a guard whose contract is to have none.
 */
function stripComments(line: string, isShell: boolean): string {
  let quote: string | null = null;
  let braceDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (isShell) {
      // `${VAR#pattern}` carries a literal # that does not start a comment.
      if (ch === "$" && line[i + 1] === "{") braceDepth++;
      else if (ch === "}" && braceDepth > 0) braceDepth--;
      else if (ch === "#" && braceDepth === 0) return line.slice(0, i);
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Scan source content for environment rule violations.
 */
export function scanSource(relPath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");
  const isShell = relPath.endsWith(".sh");
  const isTypeScript = relPath.endsWith(".ts") || relPath.endsWith(".js") || relPath.endsWith(".mjs");

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNum = i + 1;

    // Handle TS block comments
    if (!isShell) {
      if (inBlockComment) {
        if (rawLine.includes("*/")) {
          inBlockComment = false;
        }
        continue;
      }
      if (rawLine.includes("/*") && !rawLine.includes("*/")) {
        inBlockComment = true;
        continue;
      }
    }

    const code = stripComments(rawLine, isShell).trim();
    if (code.length === 0) continue;

    // 1. Check for forbidden environment identity markers
    for (const marker of FORBIDDEN_ENV_MARKERS) {
      if (code.includes(marker)) {
        // Check if this line is an explicitly permitted exemption
        const isExempt = EXEMPTIONS.some(
          (e) => e.file === relPath && e.pattern.test(rawLine),
        );
        if (!isExempt) {
          violations.push({
            file: relPath,
            line: lineNum,
            lineContent: rawLine.trim(),
            reason: `Branching or referencing environment identity marker '${marker}' (ADR-0045 §7)`,
          });
        }
      }
    }

    // 2. Check for unexempt process.env reads in TypeScript / JS
    if (isTypeScript && code.includes("process.env")) {
      const isExempt = EXEMPTIONS.some(
        (e) => e.file === relPath && e.pattern.test(rawLine),
      );
      if (!isExempt) {
        violations.push({
          file: relPath,
          line: lineNum,
          lineContent: rawLine.trim(),
          reason: "Unexempt process.env access; move to adapter layer with injected default (ADR-0045 §7)",
        });
      }
    }

    // 3. Check for shell environment branching on generic CI/vendor variables
    if (isShell) {
      // A leading \b made the bracket alternatives unreachable (\b cannot hold before
      // `[` unless a word char precedes it) and missed `elif`/`while`/`until` entirely.
      if (/(?:^|[\s;&|(])(?:(?:if|elif|while|until)\s+\[|test\s+|\[\s)|\[\[/.test(code)) {
        const matches = code.matchAll(/\$\{?([A-Z0-9_]+)/g);
        for (const match of matches) {
          const varName = match[1];
          if (
            varName === "CI" ||
            varName === "CONTINUOUS_INTEGRATION" ||
            FORBIDDEN_ENV_MARKERS.includes(varName as typeof FORBIDDEN_ENV_MARKERS[number])
          ) {
            // The shell path honours EXEMPTIONS like the TypeScript paths do; without
            // this a shipped script has no way to record a reviewed exception.
            if (EXEMPTIONS.some((e) => e.file === relPath && e.pattern.test(rawLine))) continue;
            violations.push({
              file: relPath,
              line: lineNum,
              lineContent: rawLine.trim(),
              reason: `Shell branching on environment variable '$${varName}' (ADR-0045 §7)`,
            });
          }
        }
      }
    }
  }

  return violations;
}

/** Recursively collect files in a directory. */
async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/** Get list of all production source files and shipped scripts. */
export async function getProductionFiles(root: string = REPO_ROOT): Promise<string[]> {
  const srcFiles = (await collectFiles(join(root, "src")))
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.ts"))
    .filter((f) => !f.endsWith(".d.ts"))
    .filter((f) => !f.endsWith(".generated.ts"));

  const scriptFiles = (await collectFiles(join(root, "scripts")))
    .filter((f) => f.endsWith(".sh") || f.endsWith(".mjs"));

  return [...srcFiles, ...scriptFiles].map((p) => relative(root, p));
}

describe("ADR-0045 §7 — Environment Rule Guard", () => {
  describe("negative fixtures (proves guard detects violations)", () => {
    it("detects process.env.VITEST branching in TypeScript (known violation 1)", () => {
      const code = `
        export function check(opts: DoctorOptions) {
          if (opts.quiet || process.env.VITEST) return;
        }
      `;
      const findings = scanSource("src/commands/doctor.ts", code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.reason.includes("VITEST"))).toBe(true);
    });

    it("detects CLAUDE_CONFIG_DIR read outside adapter layer (known violation 2)", () => {
      const code = `
        function pluginRegistryPath(): string {
          const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
          return join(base, "plugins", "installed_plugins.json");
        }
      `;
      const findings = scanSource("src/commands/doctor.ts", code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.reason.includes("Unexempt process.env"))).toBe(true);
    });

    it("detects CLAUDE_CODE_REMOTE branching in shell scripts (known violation 3)", () => {
      const script = `
        #!/bin/bash
        set -u
        if [ "\${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
          exit 0
        fi
      `;
      // A NON-exempt shell path: cloud-setup.sh carries a reviewed exemption, so using
      // it here would prove nothing about the detector.
      const findings = scanSource("scripts/unexempt-example.sh", script);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.reason.includes("CLAUDE_CODE_REMOTE"))).toBe(true);
    });

    it("detects process.env.CI branching in TypeScript", () => {
      const code = `
        const timeout = process.env.CI ? 10000 : 1000;
      `;
      const findings = scanSource("src/utils.ts", code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.reason.includes("CI") || f.reason.includes("process.env"))).toBe(true);
    });

    it("detects CI branching in elif, while and bare [[ shell shapes", () => {
      // A leading \b in the old condition regex made all three unreachable.
      for (const shape of [
        'elif [ "$CI" = "true" ]; then',
        'while [ "$CI" ]; do',
        '[[ "$CI" == "true" ]] && echo hi',
      ]) {
        expect(scanSource("scripts/unexempt-example.sh", shape).length).toBeGreaterThan(0);
      }
    });

    it("does not lose a process.env read that sits after a URL on the same line", () => {
      // The old stripComments cut the line at the `//` inside "https://".
      const code = 'const ok = await fetch("https://x.com", { flag: process.env.CI });';
      expect(scanSource("src/example.ts", code).length).toBeGreaterThan(0);
    });

    it("does not mistake a ${VAR#pattern} expansion for a shell comment", () => {
      const script = 'VAL="${PATH#/usr}"; if [ "$CI" = true ]; then';
      expect(scanSource("scripts/unexempt-example.sh", script).length).toBeGreaterThan(0);
    });

    it("the cloud-setup.sh exemption is what silences that same script", () => {
      const script = `if [ "\${CLAUDE_CODE_REMOTE:-}" != "true" ]; then\n  exit 0\nfi`;
      expect(scanSource("scripts/unexempt-example.sh", script).length).toBeGreaterThan(0);
      expect(scanSource("scripts/cloud-setup.sh", script)).toHaveLength(0);
    });

    it("detects unexempt process.env access in TypeScript", () => {
      const code = `
        const customDir = process.env.CUSTOM_CONFIG_DIR ?? "/default";
      `;
      const findings = scanSource("src/commands/custom.ts", code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.reason.includes("Unexempt process.env"))).toBe(true);
    });

    it("detects CI environment check in shell scripts", () => {
      const script = `
        #!/bin/bash
        if [ -n "$CI" ]; then
          echo "running in CI"
        fi
      `;
      const findings = scanSource("scripts/deploy.sh", script);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.reason.includes("CI"))).toBe(true);
    });
  });

  describe("production codebase scan", () => {
    it("scans non-empty set of production files and shipped scripts", async () => {
      const files = await getProductionFiles();
      // Ensure the guard examined real files (cannot silently pass by examining 0 files)
      expect(files.length).toBeGreaterThanOrEqual(40);
      expect(files.some((f) => f.startsWith("src/"))).toBe(true);
      expect(files.some((f) => f.startsWith("scripts/"))).toBe(true);
      expect(files).toContain("scripts/cloud-setup.sh");
    });

    it("finds zero environment identity branching violations across production sources", async () => {
      const files = await getProductionFiles();
      const allViolations: Violation[] = [];

      for (const relPath of files) {
        const fullPath = join(REPO_ROOT, relPath);
        const content = await readFile(fullPath, "utf8");
        const violations = scanSource(relPath, content);
        allViolations.push(...violations);
      }

      if (allViolations.length > 0) {
        const report = allViolations
          .map((v) => `  ${v.file}:${v.line} - ${v.reason}\n    code: ${v.lineContent}`)
          .join("\n");
        expect.fail(`Found ${allViolations.length} environment rule violations:\n${report}`);
      }

      expect(allViolations).toEqual([]);
    });
  });
});
