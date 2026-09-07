import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeHome } from "./projects.js";

/** Host plugin registry path (honors CLAUDE_CONFIG_DIR, else ~/.claude). */
export function pluginRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeHome(env), "plugins", "installed_plugins.json");
}

/** The installed `mage@<marketplace>` id from the host registry, or null. Fail-open. */
export async function mageSkillsInstalled(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  try {
    return mageInstalledIn(JSON.parse(await readFile(pluginRegistryPath(env), "utf8")));
  } catch {
    return null; // no registry / unreadable / bad JSON → treat as not installed
  }
}

/** PURE: the first `mage`/`mage@…` plugin id in a parsed installed_plugins.json, else null. */
export function mageInstalledIn(registry: unknown): string | null {
  const plugins = (registry as { plugins?: Record<string, unknown> } | null)?.plugins;
  if (!plugins || typeof plugins !== "object") return null;
  return Object.keys(plugins).find((k) => k === "mage" || k.startsWith("mage@")) ?? null;
}
