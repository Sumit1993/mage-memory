import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../lib/arms.mjs";
import { buildE2, MAGE_CLI } from "../e2/run.mjs";
import { gradeE2 } from "../e2/grade.mjs";

const tmp = () => join(mkdtempSync(join(tmpdir(), "e2-test-")), "repo");
const put = (dir, rel, text) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

test("e2 grade: nothing landed scores 0", () => {
  const dir = tmp();
  const { base } = buildE2("E2-plain", dir);
  const g = gradeE2({ dir, base, configDir: join(dir, "none") });
  assert.equal(g.score, 0);
  assert.ok(g.corrections.every((c) => c.landed === "nothing"));
});

test("e2 grade: each correction is classified to the highest rung that mentions it", () => {
  const dir = tmp();
  const { base } = buildE2("E2-plain", dir);
  put(dir, "CLAUDE.md", "# shopcart\n\nA tiny cart library. See README.md.\n- Keep commit subjects short, under 60 characters.\n- Staging is hermes-2 and needs the VPN.\n- Never edit generated/.\n");
  put(dir, ".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "node block.mjs generated" }] }] } }));
  put(dir, ".git/hooks/pre-commit", "#!/bin/sh\ngrep -r 'console.log' src && exit 1\n");
  put(dir, "mage/notes/hermes.md", "---\nrung: note\n---\nhermes-2 needs VPN\n");
  const byId = Object.fromEntries(gradeE2({ dir, base, configDir: join(dir, "none") }).corrections.map((c) => [c.id, c]));
  assert.equal(byId.c1.landed, "hook");
  assert.equal(byId.c2.landed, "check");
  assert.equal(byId.c3.landed, "nothing");
  assert.equal(byId.c4.landed, "rule");
  assert.deepEqual(byId.c4.also, ["note"]);
  assert.equal(byId.c5.landed, "rule");
  assert.equal(gradeE2({ dir, base, configDir: join(dir, "none") }).score, 4);
});

test("e2 grade: a deny permission counts as impossible and a config-dir memory file as note", () => {
  const dir = tmp();
  const { base } = buildE2("E2-plain", dir);
  put(dir, ".claude/settings.json", JSON.stringify({ permissions: { deny: ["Edit(generated/**)"] } }));
  const configDir = join(mkdtempSync(join(tmpdir(), "e2-cfg-")), "config");
  put(configDir, "projects/x/memory/feedback.md", "Always remember the issue number in commits.\n");
  const g = gradeE2({ dir, base, configDir });
  assert.equal(g.corrections.find((c) => c.id === "c1").landed, "impossible");
  assert.equal(g.corrections.find((c) => c.id === "c3").landed, "note");
  assert.equal(g.corrections.find((c) => c.id === "c3").ok, false);
});

test("e2 setup: the mage arm registers only the memory hook, pointed at this build", { skip: !existsSync(MAGE_CLI) }, () => {
  const dir = tmp();
  const { base, registered } = buildE2("E2-mage", dir);
  const events = Object.keys(registered.hooks).sort();
  assert.deepEqual(events, ["PostToolUse", "PreToolUse"]);
  for (const groups of Object.values(registered.hooks)) {
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, "Write|Edit");
    assert.match(groups[0].hooks[0].command, /cli\.js" memory-hook$/);
  }
  assert.equal(registered.autoMemoryDirectory, join(dir, "mage"));
  assert.ok(existsSync(join(dir, "mage", "metadata.json")));
  assert.equal(git(dir, "status", "--porcelain").trim(), "");
  assert.ok(base.length >= 7);
});

test("e2 setup: the arms' settings differ only in the memory hook groups", { skip: !existsSync(MAGE_CLI) }, () => {
  const plain = buildE2("E2-plain", tmp());
  const mage = buildE2("E2-mage", tmp());
  const strip = (s) => {
    const { hooks, autoMemoryDirectory, ...rest } = s;
    return { rest, hooks };
  };
  const a = strip(plain.registered);
  const b = strip(mage.registered);
  assert.equal(a.hooks, undefined);
  assert.deepEqual(Object.keys(b.hooks).sort(), ["PostToolUse", "PreToolUse"]);
  assert.ok(Object.values(b.hooks).flat().every((g) => g.id.startsWith("mage:memory:")));
  assert.deepEqual(a.rest, b.rest);
  assert.ok(plain.registered.autoMemoryDirectory.endsWith("mage"));
});

test("e2 batch: summary counts rungs per correction per arm", async () => {
  const { summarizeE2 } = await import("../e2/batch.mjs");
  const mk = (arm, rep, landed, written) => ({
    arm, rep, score: 1, of: 5, written,
    corrections: ["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id, landed, ok: landed === "note" && id === "c4" })),
  });
  const md = summarizeE2([mk("E2-plain", 1, "note", ["a.md"]), mk("E2-plain", 2, "nothing", []), mk("E2-mage", 1, "note", ["mage/x.md"])]);
  assert.ok(md.includes("| note | note x1 (ok 1/1) | note x1, nothing x1 (ok 1/2) |"));
  assert.match(md, /E2-plain rep 2: \(nothing written\)/);
});
