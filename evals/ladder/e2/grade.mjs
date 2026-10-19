import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const RANK = { nothing: 0, note: 1, rule: 2, hook: 3, check: 4, impossible: 5 };

export const CORRECTIONS = [
  { id: "c1", name: "never edit generated/", pattern: /generated/i, expected: "hook" },
  { id: "c2", name: "no console.log", pattern: /console\.log|console[ -]log/i, expected: "check" },
  { id: "c3", name: "commits need the issue number", pattern: /issue|\(#|#\d|#N\b/i, expected: "hook" },
  { id: "c4", name: "staging box hermes-2 needs VPN", pattern: /hermes-2/i, expected: "note" },
  { id: "c5", name: "short commit subjects under 60", pattern: /\b60\b|short(er)?\b.*(subject|commit)|(subject|commit).*\bshort/i, expected: "rule" },
];

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

function changedFiles(dir, base) {
  const tracked = git(dir, "diff", "--name-only", base).split("\n");
  const untracked = git(dir, "ls-files", "--others", "--exclude-standard").split("\n");
  return [...new Set([...tracked, ...untracked].filter(Boolean))];
}

function addedLines(dir, base, file) {
  const before = new Set(
    (() => {
      try {
        return git(dir, "show", `${base}:${file}`).split("\n");
      } catch {
        return [];
      }
    })(),
  );
  return read(join(dir, file)).split("\n").filter((l) => l.trim() && !before.has(l));
}

function settingsFiles(dir) {
  return [".claude/settings.json", ".claude/settings.local.json"]
    .map((f) => join(dir, f))
    .filter(existsSync)
    .map((p) => {
      try {
        return JSON.parse(readFileSync(p, "utf8"));
      } catch {
        return {};
      }
    });
}

const isMageGroup = (g) => typeof g?.id === "string" && g.id.startsWith("mage:");

/** The text each rung holds, drawn from the final state of a run. */
export function rungBlobs({ dir, base, configDir }) {
  const changed = changedFiles(dir, base);
  const settings = settingsFiles(dir);

  const impossible = settings.map((s) => JSON.stringify(s.permissions?.deny ?? [])).join("\n");

  const hookGroups = settings.flatMap((s) => Object.values(s.hooks ?? {}).flat().filter((g) => !isMageGroup(g)));
  const hook = [JSON.stringify(hookGroups), ...walk(join(dir, ".claude", "hooks")).map(read)].join("\n");

  const gitHooks = walk(join(dir, ".git", "hooks")).filter((p) => !p.endsWith(".sample"));
  const checkFiles = changed.filter(
    (f) =>
      !/^(src|test|generated|schema|mage|\.claude)\//.test(f) &&
      !/^(CLAUDE|AGENTS)\.md$/.test(f) &&
      !/^(CHANGELOG|README)\.md$/.test(f) &&
      f !== ".gitignore",
  );
  const check = [...gitHooks.map(read), ...checkFiles.map((f) => read(join(dir, f)))].join("\n");

  const ruleFiles = ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"];
  const rule = ruleFiles.flatMap((f) => addedLines(dir, base, f)).join("\n");

  const noteFiles = [
    ...changed.filter((f) => /^mage\/.*\.md$/.test(f) && !/(^|\/)(INDEX|MEMORY)\.md$/.test(f)).map((f) => join(dir, f)),
    ...walk(join(configDir ?? "", "projects")).filter((p) => /[\\/]memory[\\/].*\.md$/.test(p)),
  ];
  const note = noteFiles.map(read).join("\n");

  return { impossible, check, hook, rule, note };
}

export function classify(blobs) {
  const order = ["impossible", "check", "hook", "rule", "note"];
  return CORRECTIONS.map((c) => {
    const landed = order.filter((rung) => c.pattern.test(blobs[rung] ?? ""));
    const rung = landed[0] ?? "nothing";
    return {
      id: c.id,
      name: c.name,
      expected: c.expected,
      landed: rung,
      also: landed.slice(1),
      ok: RANK[rung] >= RANK[c.expected],
    };
  });
}

export function gradeE2({ dir, base, configDir }) {
  const corrections = classify(rungBlobs({ dir, base, configDir }));
  return { corrections, score: corrections.filter((c) => c.ok).length, of: corrections.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, base, configDir] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(gradeE2({ dir, base, configDir }), null, 2)}\n`);
}
