// Denied memory writes kept under `notes/.held/` until a climb or a re-file (#282).

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { heldDirPath } from "./paths.js";

/** Absolute paths of the held files, sorted; only this session's when `session` is given. */
export async function listHeld(root: string, session?: string): Promise<string[]> {
  const dir = heldDirPath(root);
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => n.endsWith(".md") && (session === undefined || n.startsWith(`${session}-`)))
    .sort()
    .map((n) => join(dir, n));
}
