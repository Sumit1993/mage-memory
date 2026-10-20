// #207 exit check: a knowledge base shaped like 0.0.17 ends migrated, with the memory
// hook and the PreToolUse observe arm present, and a second run changes nothing.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertBuilt, initKb, runMage, tmpKbDir } from "./lib/harness.js";

const group = (id: string, command: string, matcher?: string) => ({
  id,
  ...(matcher ? { matcher } : {}),
  hooks: [{ type: "command", command }],
});

describe("integration: mage migrate clears a 0.0.17 knowledge base (#207)", () => {
  it("migrates once, then is a no-op", async () => {
    assertBuilt();
    const { dir, root } = await initKb();
    const home = await tmpKbDir("mage-it-home-");
    const env = { HOME: home, USERPROFILE: home };

    // 0.0.17 settings: commandeer tier, auto-memory relocated, no PreToolUse observe arm.
    const settingsPath = join(dir, ".claude", "settings.local.json");
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          autoMemoryDirectory: root,
          hooks: {
            SessionStart: [group("mage:observe:SessionStart", "mage observe"), group("mage:nudge:SessionStart", "mage nudge")],
            Stop: [group("mage:observe:Stop", "mage observe")],
            PreToolUse: [group("mage:memory:PreToolUse", "mage memory-hook", "Write|Edit")],
            PostToolUse: [
              group("mage:observe:PostToolUse", "mage observe"),
              group("mage:memory:PostToolUse", "mage memory-hook", "Write|Edit"),
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    // 0.0.x state: the retired writers' files, a pending draft, a retired work/ file.
    const metrics = join(root, ".mage", "metrics");
    await mkdir(metrics, { recursive: true });
    await writeFile(join(metrics, "promote.json"), "{}");
    await writeFile(join(metrics, "nudge-throttle.json"), "{}");
    await mkdir(join(root, ".mage", "staging"), { recursive: true });
    await writeFile(join(root, ".mage", "staging", "d.md"), "# draft\n");
    await mkdir(join(root, "work"), { recursive: true });
    await writeFile(join(root, "work", "plan.md"), "# plan\n");

    // An AGENTS.md block from before hash stamps, with its own wording.
    const agentsPath = join(dir, "AGENTS.md");
    const legacy = (await readFile(agentsPath, "utf8"))
      .replace(/^<!-- mage-block-hash: [0-9a-f]{12} -->\n/m, "")
      .replace("/mage:learn", "mage:learn");
    await writeFile(agentsPath, legacy);

    const first = await runMage(["migrate"], { cwd: dir, env });
    expect(first.code, first.stderr).toBe(0);
    const out = first.stdout + first.stderr;
    expect(out).toContain("predates hash stamps");
    expect(out).toContain("work/ is retired");
    expect(out).toContain("1 draft(s) pending");
    expect(out).toContain("observe arm: added");

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const pre = settings.hooks.PreToolUse.map((g: { id: string }) => g.id);
    expect(pre).toContain("mage:observe:PreToolUse");
    expect(pre).toContain("mage:memory:PreToolUse");
    expect(settings.autoMemoryDirectory).toBe(root);
    await expect(stat(join(metrics, "promote.json"))).rejects.toThrow();
    await expect(stat(join(metrics, "nudge-throttle.json"))).rejects.toThrow();
    expect(await readFile(join(root, ".mage", "staging", "d.md"), "utf8")).toBe("# draft\n");
    expect(await readFile(join(root, "work", "plan.md"), "utf8")).toBe("# plan\n");
    expect(await readFile(agentsPath, "utf8")).toBe(legacy);

    const settingsBytes = await readFile(settingsPath, "utf8");
    const second = await runMage(["migrate"], { cwd: dir, env });
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout + second.stderr).toContain("hooks: unchanged");
    expect(await readFile(settingsPath, "utf8")).toBe(settingsBytes);
    expect(await readFile(agentsPath, "utf8")).toBe(legacy);

    // Only the project-local file is ever written, never the user's own settings.
    await expect(stat(join(home, ".claude", "settings.json"))).rejects.toThrow();
  });
});
