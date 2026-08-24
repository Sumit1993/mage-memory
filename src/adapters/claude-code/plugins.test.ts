import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../../../test/fixtures/kb.js";
import {
  mageInstalledIn,
  mageSkillsInstalled,
  pluginRegistryPath,
} from "./plugins.js";

describe("claude-code plugins adapter", () => {
  describe("pluginRegistryPath", () => {
    it("honors CLAUDE_CONFIG_DIR in injected env", () => {
      expect(pluginRegistryPath({ CLAUDE_CONFIG_DIR: "/custom/claude" })).toBe(
        "/custom/claude/plugins/installed_plugins.json",
      );
    });

    it("falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset or empty", () => {
      expect(pluginRegistryPath({})).toMatch(/[/\\]\.claude[/\\]plugins[/\\]installed_plugins\.json$/);
      expect(pluginRegistryPath({ CLAUDE_CONFIG_DIR: "" })).toMatch(
        /[/\\]\.claude[/\\]plugins[/\\]installed_plugins\.json$/,
      );
    });
  });

  describe("mageSkillsInstalled", () => {
    it("returns plugin id when registry holds mage plugin", async () => {
      const dir = await tmpDir("mage-plugins-test-");
      const pluginsDir = join(dir, "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(
        join(pluginsDir, "installed_plugins.json"),
        JSON.stringify({ plugins: { "mage@mage": [{}] } }),
      );

      const result = await mageSkillsInstalled({ CLAUDE_CONFIG_DIR: dir });
      expect(result).toBe("mage@mage");
    });

    it("returns null when registry is missing or malformed (fail-open)", async () => {
      const dir = await tmpDir("mage-plugins-test-");
      expect(await mageSkillsInstalled({ CLAUDE_CONFIG_DIR: dir })).toBeNull();

      const pluginsDir = join(dir, "plugins");
      await mkdir(pluginsDir, { recursive: true });
      await writeFile(join(pluginsDir, "installed_plugins.json"), "invalid json");
      expect(await mageSkillsInstalled({ CLAUDE_CONFIG_DIR: dir })).toBeNull();
    });
  });

  describe("mageInstalledIn", () => {
    it("finds bare mage or mage@ scoped plugin keys", () => {
      expect(mageInstalledIn({ plugins: { mage: [{}] } })).toBe("mage");
      expect(mageInstalledIn({ plugins: { "mage@marketplace": [{}] } })).toBe("mage@marketplace");
    });

    it("returns null for non-mage plugins or invalid shapes", () => {
      expect(mageInstalledIn({ plugins: { other: [{}] } })).toBeNull();
      expect(mageInstalledIn(null)).toBeNull();
      expect(mageInstalledIn({})).toBeNull();
      expect(mageInstalledIn({ plugins: "invalid" })).toBeNull();
    });
  });
});
