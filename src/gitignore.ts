import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GITIGNORE_FILE, exists } from "./paths.js";

/**
 * Ensure each pattern in `patterns` appears on its own line in <repo>/.gitignore.
 * Idempotent. Returns the patterns that were actually added.
 */
export async function ensureGitignored(repoPath: string, patterns: string[]): Promise<string[]> {
  const gi = join(repoPath, GITIGNORE_FILE);
  const current = (await exists(gi)) ? await readFile(gi, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/));
  const added: string[] = [];

  for (const pat of patterns) {
    if (!lines.has(pat)) {
      added.push(pat);
      lines.add(pat);
    }
  }

  if (added.length > 0) {
    const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    const appended = `${current}${sep}${added.join("\n")}\n`;
    await writeFile(gi, appended);
  }

  return added;
}
