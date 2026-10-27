import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../lib/arms.mjs";
import { buildE2, MAGE_CLI, promptFile } from "../e2/run.mjs";
import { CORRECTIONS_HELDOUT, gradeE2 } from "../e2/grade.mjs";

const tmp = () => join(mkdtempSync(join(tmpdir(), "e2-test-")), "repo");
const put = (dir, rel, text) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

test("e2 grade: nothing landed scores 0", { skip: !existsSync(MAGE_CLI) }, () => {
  const dir = tmp();
  const { base } = buildE2("E2-plain", dir);
  const g = gradeE2({ dir, base, configDir: join(dir, "none") });
  assert.equal(g.score, 0);
  assert.ok(g.corrections.every((c) => c.landed === "nothing"));
});

test("e2 grade: each correction is classified to the highest rung that mentions it", { skip: !existsSync(MAGE_CLI) }, () => {
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

test("e2 grade: a deny permission counts as impossible and a config-dir memory file as note", { skip: !existsSync(MAGE_CLI) }, () => {
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
  assert.deepEqual(events, ["PreToolUse"]);
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
  assert.deepEqual(Object.keys(b.hooks).sort(), ["PreToolUse"]);
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

test("proto hook: first memory write denied, second allowed, non-KB paths ignored", async () => {
  const { decide, REASON } = await import("../e2/proto-ladder-hook.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "proto-"));
  const marks = join(cwd, ".claude");
  const w = (file_path, tool_name = "Write", session_id = "s1") => ({ tool_name, cwd, session_id, tool_input: { file_path } });
  assert.equal(decide(w(join(cwd, "src", "cart.js")), marks), null);
  assert.equal(decide(w(join(cwd, "CLAUDE.md")), marks), null);
  assert.equal(decide(w(join(cwd, "mage", "MEMORY.md")), marks), null);
  assert.equal(decide(w(join(cwd, "mage", "INDEX.md")), marks), null);
  assert.equal(decide({ tool_name: "Read", cwd, session_id: "s1", tool_input: { file_path: join(cwd, "mage", "a.md") } }, marks), null);
  const first = decide(w(join(cwd, "mage", "corrections.md")), marks);
  assert.equal(first.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(first.hookSpecificOutput.permissionDecisionReason, REASON);
  assert.equal(decide(w(join(cwd, "mage", "corrections.md")), marks), null);
  assert.equal(decide(w("mage/notes/x.md", "Edit", "s2"), marks).hookSpecificOutput.permissionDecision, "deny");
});

test("e2 setup: E2-proto is E2-mage plus the proto group first", { skip: !existsSync(MAGE_CLI) }, () => {
  const mage = buildE2("E2-mage", tmp()).registered;
  const proto = buildE2("E2-proto", tmp()).registered;
  const pre = proto.hooks.PreToolUse;
  assert.equal(pre[0].id, "proto:ladder:PreToolUse");
  assert.match(pre[0].hooks[0].command, /proto-ladder-hook\.mjs/);
  assert.deepEqual(pre.slice(1).map((g) => g.id), mage.hooks.PreToolUse.map((g) => g.id));
});

test("attach hook: allows the first memory write and attaches the ladder text once", async () => {
  const { decide, REASON } = await import("../e2/proto-ladder-hook.mjs");
  const cwd = mkdtempSync(join(tmpdir(), "attach-"));
  const marks = join(cwd, ".claude");
  const w = (file_path) => ({ tool_name: "Write", cwd, session_id: "s1", tool_input: { file_path } });
  assert.equal(decide(w(join(cwd, "src", "a.js")), marks, "attach"), null);
  const first = decide(w(join(cwd, "mage", "c.md")), marks, "attach");
  assert.equal(first.hookSpecificOutput.additionalContext, REASON);
  assert.equal(first.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(decide(w(join(cwd, "mage", "c.md")), marks, "attach"), null);
});

test("e2 setup: E2-attach registers the proto hook in attach mode", { skip: !existsSync(MAGE_CLI) }, () => {
  const s = buildE2("E2-attach", tmp()).registered;
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /proto-ladder-hook\.mjs" attach$/);
});

test("e2 grade heldout: each held-out correction is classified to the highest rung that mentions it", { skip: !existsSync(MAGE_CLI) }, () => {
  const dir = tmp();
  const { base } = buildE2("E2-plain", dir);
  put(dir, "CLAUDE.md", "# shopcart\n\nA tiny cart library. See README.md.\n- Prefer named exports over default exports.\n- Big suites need --shard on buildkite-agent-3.\n");
  put(dir, ".claude/settings.json", JSON.stringify({
    permissions: { deny: ["Bash(prisma migrate reset*)"] },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node block-force-push.mjs --force" }] }] },
  }));
  put(dir, "scripts/check-401.sh", "#!/bin/sh\ngrep -L '401' test/api/*.test.js && exit 1\n");
  put(dir, "mage/notes/runner.md", "---\nrung: note\n---\nthe runner is buildkite-agent-3, use --shard\n");
  const g = gradeE2({ dir, base, configDir: join(dir, "none"), prompt: "heldout" });
  const byId = Object.fromEntries(g.corrections.map((c) => [c.id, c]));
  assert.equal(g.of, 5);
  assert.equal(byId.h1.landed, "impossible");
  assert.equal(byId.h2.landed, "check");
  assert.equal(byId.h3.landed, "hook");
  assert.equal(byId.h4.landed, "rule");
  assert.equal(byId.h5.landed, "rule");
  assert.deepEqual(byId.h5.also, ["note"]);
  assert.equal(g.score, 5);
});

test("e2 grade heldout: nothing landed scores 0, and the default set is untouched", { skip: !existsSync(MAGE_CLI) }, () => {
  const dir = tmp();
  const { base } = buildE2("E2-plain", dir);
  const none = join(dir, "none");
  const heldout = gradeE2({ dir, base, configDir: none, prompt: "heldout" });
  assert.equal(heldout.score, 0);
  assert.deepEqual(heldout.corrections.map((c) => c.id), ["h1", "h2", "h3", "h4", "h5"]);
  assert.deepEqual(heldout.corrections.map((c) => c.expected), ["impossible", "check", "hook", "rule", "note"]);
  assert.deepEqual(gradeE2({ dir, base, configDir: none }).corrections.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5"]);
});

test("e2 grade heldout: the h3 pattern needs a force push, not any push", () => {
  const h3 = CORRECTIONS_HELDOUT.find((c) => c.id === "h3").pattern;
  assert.ok(h3.test("git push --force origin main"));
  assert.ok(h3.test("git push -f origin main"));
  assert.ok(h3.test("never force-push to main"));
  assert.ok(!h3.test("git push origin main"));
});

test("e2 prompt heldout: five corrections, none shared with the default prompt or the ladder text", () => {
  const heldout = readFileSync(promptFile("heldout"), "utf8");
  const standard = readFileSync(promptFile("default"), "utf8");
  assert.equal(heldout.split("\n").filter((l) => /^\d\. /.test(l)).length, 5);
  const ladder = readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "adapters", "claude-code", "memory-hook.ts"), "utf8");
  for (const word of ["prisma", "401", "force", "named export", "default export", "buildkite", "shard"]) {
    assert.ok(new RegExp(word, "i").test(heldout), word);
    assert.ok(!new RegExp(word, "i").test(standard), `${word} in the default prompt`);
    assert.ok(!new RegExp(word, "i").test(ladder), `${word} in the ladder text`);
  }
});

test("e2 batch: the summary uses the held-out correction set", async () => {
  const { summarizeE2 } = await import("../e2/batch.mjs");
  const mk = (arm, landed) => ({
    arm, rep: 1, score: 0, of: 5, prompt: "heldout", written: [],
    corrections: ["h1", "h2", "h3", "h4", "h5"].map((id) => ({ id, landed, ok: false })),
  });
  const md = summarizeE2([mk("E2-plain", "nothing"), mk("E2-mage", "rule")]);
  assert.match(md, /heldout prompt/);
  assert.match(md, /\| h1 never run prisma migrate reset \| impossible \|/);
  assert.match(md, /\| h5 CI runner buildkite-agent-3 needs --shard \| note \|/);
});

test("e2 run: --prompt heldout reads the held-out prompt file", () => {
  assert.match(promptFile("heldout"), /prompt-heldout\.md$/);
  assert.match(promptFile("default"), /prompt\.md$/);
  assert.match(promptFile(), /prompt\.md$/);
});

test("e2 setup: --gate writes ladder.gate into the mage arm's metadata and leaves the plain arm alone", { skip: !existsSync(MAGE_CLI) }, () => {
  const meta = (dir) => JSON.parse(readFileSync(join(dir, "mage", "metadata.json"), "utf8"));
  const deny = tmp();
  buildE2("E2-mage", deny, { gate: "deny-once" });
  assert.deepEqual(meta(deny).ladder, { gate: "deny-once" });
  const dflt = tmp();
  buildE2("E2-mage", dflt);
  assert.equal(meta(dflt).ladder, undefined);
  const plain = tmp();
  buildE2("E2-plain", plain, { gate: "deny-once" });
  assert.equal(meta(plain).ladder, undefined);
});

test("e2 claude auth: no ollama endpoint or token, config dir set, credentials removable", async () => {
  const { claudeEnv, removeCredentials } = await import("../lib/claude.mjs");
  const before = { ...process.env };
  process.env.ANTHROPIC_BASE_URL = "http://elsewhere";
  process.env.ANTHROPIC_AUTH_TOKEN = "x";
  try {
    const configDir = mkdtempSync(join(tmpdir(), "e2-claude-"));
    const env = claudeEnv({ model: "haiku", configDir, auth: "claude" });
    assert.equal(env.CLAUDE_CONFIG_DIR, configDir);
    for (const k of Object.keys(env)) assert.ok(!k.startsWith("ANTHROPIC_"), k);
    const ollama = claudeEnv({ model: "m", configDir });
    assert.equal(ollama.ANTHROPIC_BASE_URL, "http://localhost:11434");
    writeFileSync(join(configDir, ".credentials.json"), "{}");
    removeCredentials(configDir);
    assert.ok(!existsSync(join(configDir, ".credentials.json")));
    removeCredentials(configDir);
  } finally {
    process.env.ANTHROPIC_BASE_URL = before.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_AUTH_TOKEN = before.ANTHROPIC_AUTH_TOKEN;
    if (before.ANTHROPIC_BASE_URL === undefined) delete process.env.ANTHROPIC_BASE_URL;
    if (before.ANTHROPIC_AUTH_TOKEN === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
});
