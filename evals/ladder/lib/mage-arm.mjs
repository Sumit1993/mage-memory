import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAGE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist", "cli.js");

const runMage = (cwd, ...args) => {
  const r = spawnSync("node", [MAGE_CLI, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`mage ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};

/** The one note arm M uses for R6: it reaches the model only through `mage recall-hook`. */
export const R6_NOTE = `---
type: procedure
created: 2026-10-20
rung: note
trigger:
  when: "adding a new exported function in src/"
  match: ["Edit(src/**)", "Write(src/**)"]
pointer: "[#282](https://github.com/Sumit1993/mage-memory/issues/282)"
---
# A new exported function gets a JSDoc example

A new exported function gets a JSDoc block that includes an \`@example\`.
`;

/**
 * Arm M: real \`mage init --in-repo\` and \`mage connect\`, then only the recall and memory hook
 * groups kept, their command pointed at this worktree's built CLI. Writes the R6 note and indexes.
 */
export function registerMageArm(dir) {
  runMage(dir, "init", "--in-repo", "--yes", "--no-connect");
  runMage(dir, "connect", "--yes", "--no-git-hook");
  mkdirSync(join(dir, "mage", "notes"), { recursive: true });
  writeFileSync(join(dir, "mage", "notes", "jsdoc-example-on-new-exports.md"), R6_NOTE);
  const indexOut = runMage(dir, "index");
  const path = join(dir, ".claude", "settings.local.json");
  const settings = JSON.parse(readFileSync(path, "utf8"));
  const kept = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const keep = groups
      .filter((g) => g.id?.startsWith("mage:memory:") || g.id?.startsWith("mage:recall:"))
      .map((g) => ({ ...g, hooks: g.hooks.map((h) => ({ ...h, command: h.command.replace(/^mage /, `node "${MAGE_CLI}" `) })) }));
    if (keep.length > 0) kept[event] = keep;
  }
  settings.hooks = kept;
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return { settings, indexOut };
}
