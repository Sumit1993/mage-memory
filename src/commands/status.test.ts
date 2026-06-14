import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METADATA_SCHEMA } from "../paths.js";
import { status } from "./status.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});
async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mage-status-"));
  made.push(d);
  return d;
}

async function makeInRepo(dir: string, project: string): Promise<void> {
  await mkdir(join(dir, "mage"), { recursive: true });
  const meta = {
    schema: METADATA_SCHEMA,
    mode: "in-repo",
    project,
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: "",
  };
  await writeFile(join(dir, "mage", "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

describe("status — hub expansion (Decision 11B)", () => {
  it("a hub argument expands to its registered project code repos", async () => {
    const hub = await freshDir();
    await mkdir(join(hub, "projects"), { recursive: true });
    const a = await freshDir();
    await makeInRepo(a, "alpha");
    const meta = {
      schema: METADATA_SCHEMA,
      name: "h",
      created_at: "",
      projects: [{ name: "alpha", storage: "repo-owned", code_repo_path: a, code_repo_url: "" }],
    };
    await writeFile(join(hub, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const r = await status({ codeRepos: [hub] });
    // The hub root itself is NOT treated as a code repo — it expands to project a.
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]?.codeRepo).toBe(a);
    expect(r.repos[0]?.metadata.ok).toBe(true);
  });

  it("a non-hub code repo passes through unchanged", async () => {
    const a = await freshDir();
    await makeInRepo(a, "solo");
    const r = await status({ codeRepos: [a] });
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]?.codeRepo).toBe(a);
  });
});
