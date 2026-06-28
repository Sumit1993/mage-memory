import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../../../test/fixtures/kb.js";
import {
  type ClaudeSettings,
  MAGE_HOOKS,
  MAGE_ID_PREFIX,
  isAutoMemoryEnabled,
  readClaudeSettings,
  removeMageHooks,
  resolveSettingsTarget,
  upsertMageHooks,
  writeClaudeSettings,
} from "./settings.js";

/** Count the mage-owned groups across every event. */
function countMage(s: ClaudeSettings): number {
  return Object.values(s.hooks ?? {})
    .flat()
    .filter((g) => typeof g.id === "string" && g.id.startsWith(MAGE_ID_PREFIX)).length;
}

const tmp = (): Promise<string> => tmpDir("mage-settings-");

describe("MAGE_HOOKS table", () => {
  it("wires exactly thirteen rows (10 base + 3 commandeer)", () => {
    expect(MAGE_HOOKS).toEqual([
      { event: "SessionStart", id: "mage:observe:SessionStart", command: "mage observe" },
      { event: "SessionStart", id: "mage:nudge:SessionStart", command: "mage nudge" },
      { event: "UserPromptSubmit", id: "mage:observe:UserPromptSubmit", command: "mage observe" },
      { event: "PostToolUse", id: "mage:observe:PostToolUse", command: "mage observe" },
      {
        event: "PostToolUseFailure",
        id: "mage:observe:PostToolUseFailure",
        command: "mage observe",
      },
      { event: "PreCompact", id: "mage:observe:PreCompact", command: "mage observe" },
      { event: "SessionEnd", id: "mage:observe:SessionEnd", command: "mage observe" },
      { event: "Stop", id: "mage:metrics:Stop", command: "mage skills --metrics --quiet" },
      { event: "Stop", id: "mage:observe:Stop", command: "mage observe" },
      { event: "SubagentStop", id: "mage:observe:SubagentStop", command: "mage observe" },
      {
        event: "PreToolUse",
        id: "mage:memory:PreToolUse",
        matcher: "Write|Edit",
        command: "mage memory-hook",
        commandeer: true,
      },
      {
        event: "PostToolUse",
        id: "mage:memory:PostToolUse",
        matcher: "Write|Edit",
        command: "mage memory-hook",
        commandeer: true,
      },
      {
        event: "Stop",
        id: "mage:flatten:Stop",
        command: "mage flatten --quiet",
        commandeer: true,
      },
    ]);
  });

  it("every id begins with the mage prefix", () => {
    for (const h of MAGE_HOOKS) expect(h.id.startsWith(MAGE_ID_PREFIX)).toBe(true);
  });
});

describe("resolveSettingsTarget", () => {
  it("user scope targets ~/.claude/settings.json", () => {
    const t = resolveSettingsTarget({ user: true });
    expect(t.scope).toBe("user");
    expect(t.path.endsWith(join(".claude", "settings.json"))).toBe(true);
  });

  it("local scope targets <cwd>/.claude/settings.local.json", () => {
    const t = resolveSettingsTarget({ cwd: "/some/repo" });
    expect(t.scope).toBe("local");
    expect(t.path).toBe(join("/some/repo", ".claude", "settings.local.json"));
  });

  it("local scope defaults cwd to process.cwd()", () => {
    const t = resolveSettingsTarget({});
    expect(t.scope).toBe("local");
    expect(t.path).toBe(join(process.cwd(), ".claude", "settings.local.json"));
  });
});

describe("readClaudeSettings", () => {
  it("ENOENT -> {null, existed:false, malformed:false}", async () => {
    const dir = await tmp();
    const r = await readClaudeSettings(join(dir, "nope.json"));
    expect(r).toEqual({ settings: null, existed: false, malformed: false });
  });

  it("malformed JSON -> {null, existed:true, malformed:true}", async () => {
    const dir = await tmp();
    const p = join(dir, "settings.json");
    await writeFile(p, "{ not json");
    const r = await readClaudeSettings(p);
    expect(r).toEqual({ settings: null, existed: true, malformed: true });
  });

  it("valid JSON -> {parsed, existed:true, malformed:false}", async () => {
    const dir = await tmp();
    const p = join(dir, "settings.json");
    await writeFile(p, JSON.stringify({ permissions: { allow: ["X"] } }));
    const r = await readClaudeSettings(p);
    expect(r.existed).toBe(true);
    expect(r.malformed).toBe(false);
    expect(r.settings).toEqual({ permissions: { allow: ["X"] } });
  });
});

describe("upsertMageHooks", () => {
  it("creates hooks from absent and preserves unknown top-level keys", () => {
    const original: ClaudeSettings = { permissions: { allow: ["Read(/x)"] } };
    const merged = upsertMageHooks(original, { commandeer: true });

    // unknown top-level key survives untouched
    expect(merged.permissions).toEqual({ allow: ["Read(/x)"] });
    // hooks created
    expect(merged.hooks).toBeDefined();
    for (const h of MAGE_HOOKS) {
      const groups = merged.hooks?.[h.event] ?? [];
      const mine = groups.find((g) => g.id === h.id);
      expect(mine).toBeDefined();
      expect(mine?.matcher).toBe(h.matcher); // undefined for base rows, "Write|Edit" for commandeer
      expect(mine?.hooks).toEqual([{ type: "command", command: h.command }]);
    }
  });

  it("is pure — does not mutate the input", () => {
    const original: ClaudeSettings = { permissions: { allow: ["Read(/x)"] } };
    const snapshot = structuredClone(original);
    upsertMageHooks(original);
    expect(original).toEqual(snapshot);
    expect(original.hooks).toBeUndefined();
  });

  it("accepts null and produces a settings object with hooks", () => {
    const merged = upsertMageHooks(null);
    expect(merged.hooks).toBeDefined();
    expect(merged.hooks?.SessionStart?.[0]?.id).toBe("mage:observe:SessionStart");
  });

  it("preserves non-mage groups and other events on the same event key", () => {
    const original: ClaudeSettings = {
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "user-tool" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "other" }] }],
      },
    };
    const merged = upsertMageHooks(original);

    const ss = merged.hooks?.SessionStart ?? [];
    // the user's non-mage group survives
    expect(ss.find((g) => g.command === undefined && g.hooks[0]?.command === "user-tool")).toBeTruthy();
    // both mage SessionStart groups appended (observe + the 0.0.12 nudge)
    expect(ss.find((g) => g.id === "mage:observe:SessionStart")).toBeTruthy();
    expect(ss.find((g) => g.id === "mage:nudge:SessionStart")).toBeTruthy();
    expect(ss.length).toBe(3);
  });

  it("is idempotent — re-upsert produces no duplicate mage groups", () => {
    const once = upsertMageHooks(null, { commandeer: true });
    const twice = upsertMageHooks(once, { commandeer: true });
    for (const h of MAGE_HOOKS) {
      const groups = twice.hooks?.[h.event] ?? [];
      const mine = groups.filter((g) => g.id === h.id);
      expect(mine.length).toBe(1);
    }
    expect(twice).toEqual(once);
  });

  it("replace-by-id updates a changed command (no stale dupe)", () => {
    // simulate a previously-wired settings whose stored command drifted
    const stale: ClaudeSettings = {
      hooks: {
        SessionStart: [
          {
            id: "mage:observe:SessionStart",
            hooks: [{ type: "command", command: "mage observe --old" }],
          },
        ],
      },
    };
    const merged = upsertMageHooks(stale);
    const groups = merged.hooks?.SessionStart ?? [];
    const mine = groups.filter((g) => g.id === "mage:observe:SessionStart");
    expect(mine.length).toBe(1);
    expect(mine[0]?.hooks).toEqual([{ type: "command", command: "mage observe" }]);
  });
});

describe("commandeer-tier gating (ADR-0032)", () => {
  it("omits the commandeer rows by default (10 groups, no PreToolUse)", () => {
    const merged = upsertMageHooks(null);
    expect(countMage(merged)).toBe(10);
    expect(merged.hooks?.PreToolUse).toBeUndefined();
    // PostToolUse carries only the observe group, not the memory one.
    const post = merged.hooks?.PostToolUse ?? [];
    expect(post.find((g) => g.id === "mage:memory:PostToolUse")).toBeUndefined();
    expect(post.find((g) => g.id === "mage:observe:PostToolUse")).toBeTruthy();
  });

  it("adds the commandeer rows with matchers when commandeer:true (13 groups)", () => {
    const merged = upsertMageHooks(null, { commandeer: true });
    expect(countMage(merged)).toBe(13);
    const pre = merged.hooks?.PreToolUse ?? [];
    expect(pre).toHaveLength(1);
    expect(pre[0]?.id).toBe("mage:memory:PreToolUse");
    expect(pre[0]?.matcher).toBe("Write|Edit");
    expect(pre[0]?.hooks).toEqual([{ type: "command", command: "mage memory-hook" }]);
    // PostToolUse now coexists: observe + memory.
    const post = merged.hooks?.PostToolUse ?? [];
    expect(post.find((g) => g.id === "mage:memory:PostToolUse")).toBeTruthy();
    expect(post.find((g) => g.id === "mage:observe:PostToolUse")).toBeTruthy();
  });

  it("self-heals: re-upserting with commandeer off removes a prior commandeer group", () => {
    const on = upsertMageHooks(null, { commandeer: true });
    expect(on.hooks?.PreToolUse).toHaveLength(1);
    const off = upsertMageHooks(on, { commandeer: false });
    expect(off.hooks?.PreToolUse).toBeUndefined(); // event pruned
    expect(countMage(off)).toBe(10);
    expect(off.hooks?.PostToolUse?.find((g) => g.id === "mage:memory:PostToolUse")).toBeUndefined();
  });
});

describe("isAutoMemoryEnabled", () => {
  it("defaults to true (CC's documented default)", () => {
    expect(isAutoMemoryEnabled(null, {})).toBe(true);
    expect(isAutoMemoryEnabled({}, {})).toBe(true);
    expect(isAutoMemoryEnabled({ autoMemoryEnabled: true }, {})).toBe(true);
  });

  it("is false when autoMemoryEnabled is explicitly false", () => {
    expect(isAutoMemoryEnabled({ autoMemoryEnabled: false }, {})).toBe(false);
  });

  it("is false when CLAUDE_CODE_DISABLE_AUTO_MEMORY is set in env", () => {
    expect(isAutoMemoryEnabled({}, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" })).toBe(false);
    // env override beats an enabled setting
    expect(
      isAutoMemoryEnabled({ autoMemoryEnabled: true }, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }),
    ).toBe(false);
  });
});

describe("removeMageHooks", () => {
  it("strips only mage groups, prunes empties, and counts removed", () => {
    const wired = upsertMageHooks(
      {
        hooks: {
          SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "user-tool" }] }],
        },
      },
      { commandeer: true },
    );
    const { settings, removed } = removeMageHooks(wired);

    expect(removed).toBe(MAGE_HOOKS.length);
    // the user's non-mage group survives
    const ss = settings.hooks?.SessionStart ?? [];
    expect(ss.length).toBe(1);
    expect(ss[0]?.hooks[0]?.command).toBe("user-tool");
    // events that held only mage groups are pruned entirely
    expect(settings.hooks?.Stop).toBeUndefined();
    expect(settings.hooks?.PostToolUse).toBeUndefined();
  });

  it("prunes the hooks{} key entirely when it becomes empty", () => {
    const wired = upsertMageHooks({ permissions: { allow: ["X"] } }, { commandeer: true });
    const { settings, removed } = removeMageHooks(wired);
    expect(removed).toBe(MAGE_HOOKS.length);
    expect(settings.hooks).toBeUndefined();
    // other top-level keys preserved
    expect(settings.permissions).toEqual({ allow: ["X"] });
  });

  it("is pure — does not mutate the input", () => {
    const wired = upsertMageHooks(null);
    const snapshot = structuredClone(wired);
    removeMageHooks(wired);
    expect(wired).toEqual(snapshot);
  });

  it("null input yields an empty settings and zero removed", () => {
    const { settings, removed } = removeMageHooks(null);
    expect(removed).toBe(0);
    expect(settings).toEqual({});
  });

  it("ignores groups whose id is not a string or not mage-prefixed", () => {
    const original: ClaudeSettings = {
      hooks: {
        SessionStart: [
          { id: "other:thing", hooks: [{ type: "command", command: "x" }] },
          { hooks: [{ type: "command", command: "no-id" }] },
        ],
      },
    };
    const { settings, removed } = removeMageHooks(original);
    expect(removed).toBe(0);
    expect(settings.hooks?.SessionStart?.length).toBe(2);
  });
});

describe("round-trip", () => {
  it("upsert then remove yields the original (minus mage)", () => {
    const original: ClaudeSettings = {
      permissions: { allow: ["Read(/x)"] },
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "user-tool" }] }],
      },
    };
    const wired = upsertMageHooks(original);
    const { settings } = removeMageHooks(wired);
    expect(settings).toEqual(original);
  });

  it("upsert then remove on a hooks-less settings restores the bare object", () => {
    const original: ClaudeSettings = { permissions: { allow: ["X"] } };
    const wired = upsertMageHooks(original);
    const { settings } = removeMageHooks(wired);
    expect(settings).toEqual(original);
  });
});

describe("writeClaudeSettings", () => {
  it("creates parent dirs (mkdir -p) and writes pretty JSON with trailing newline", async () => {
    const dir = await tmp();
    const p = join(dir, "nested", "deep", "settings.json");
    const { backedUp } = await writeClaudeSettings(p, { permissions: { allow: ["X"] } });
    expect(backedUp).toBe(false);
    const text = await readFile(p, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ permissions: { allow: ["X"] } });
    // pretty printed (2-space indent)
    expect(text).toContain('\n  "permissions"');
  });

  it("creates a .bak when the file pre-exists, before overwriting", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const p = join(dir, ".claude", "settings.json");
    await writeFile(p, JSON.stringify({ original: true }));

    const { backedUp } = await writeClaudeSettings(p, { replaced: true });
    expect(backedUp).toBe(true);

    // .bak holds the PRE-write content
    const bak = await readFile(`${p}.bak`, "utf8");
    expect(JSON.parse(bak)).toEqual({ original: true });
    // the live file holds the new content
    const live = await readFile(p, "utf8");
    expect(JSON.parse(live)).toEqual({ replaced: true });
  });
});

describe("integration: wire then unwire a real-shaped file", () => {
  it("merges into a permissions-only file then fully reverts", async () => {
    const dir = await tmp();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const p = join(dir, ".claude", "settings.local.json");
    const live = { permissions: { allow: ["Read(//home/x/**)"] } };
    await writeFile(p, `${JSON.stringify(live, null, 2)}\n`);

    const r = await readClaudeSettings(p);
    expect(r.existed).toBe(true);
    const merged = upsertMageHooks(r.settings);
    await writeClaudeSettings(p, merged);

    const after = await readClaudeSettings(p);
    expect(after.settings?.permissions).toEqual({ allow: ["Read(//home/x/**)"] });
    expect(after.settings?.hooks?.Stop?.[0]?.id).toBe("mage:metrics:Stop");

    const { settings: reverted } = removeMageHooks(after.settings);
    expect(reverted).toEqual(live);
  });
});
