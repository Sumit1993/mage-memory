import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hubMetadataPath, metadataPath } from "../paths.js";
import { mageMigrate } from "./migrate.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

describe("mage migrate", () => {
  it("upgrades a v1 code-repo metadata file to v2 on disk (mode normalized + persisted)", async () => {
    const code = await tmp("mage-mig-code-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [{ hub_path: "/h", hub_repo: "u", project: "x" }],
        linked_at: "t",
      }),
    );
    const result = await mageMigrate({ dir: code });
    expect(result.migrated).toHaveLength(1);
    expect(result.migrated[0]?.from).toBe("mage.v1");
    expect(result.migrated[0]?.to).toBe("mage.v2");
    const raw = JSON.parse(await readFile(metadataPath(code), "utf8"));
    expect(raw.schema).toBe("mage.v2");
    expect(raw.mode).toBe("hybrid"); // v1 in-repo + hub_refs → hybrid, persisted
  });

  it("upgrades a v1 hub metadata file (storage in-repo → repo-owned, schema v2)", async () => {
    const hub = await tmp("mage-mig-hub-");
    await mkdir(join(hub, "projects"), { recursive: true }); // makes looksLikeHub() true
    await writeFile(
      hubMetadataPath(hub),
      JSON.stringify({
        schema: "mage.v1",
        name: "h",
        created_at: "t",
        projects: [{ name: "a", storage: "in-repo", code_repo_path: "/a", code_repo_url: "u" }],
      }),
    );
    const result = await mageMigrate({ dir: hub });
    expect(result.migrated.map((m) => m.to)).toContain("mage.v2");
    const raw = JSON.parse(await readFile(hubMetadataPath(hub), "utf8"));
    expect(raw.schema).toBe("mage.v2");
    expect(raw.projects[0].storage).toBe("repo-owned");
  });

  it("is idempotent: a v2 KB reports already-current and rewrites nothing", async () => {
    const code = await tmp("mage-mig-v2-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v2",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [],
        linked_at: "t",
      }),
    );
    const result = await mageMigrate({ dir: code });
    expect(result.migrated).toHaveLength(0);
    expect(result.alreadyCurrent).toHaveLength(1);
  });

  it("walks up from a subdir to find the code repo", async () => {
    const code = await tmp("mage-mig-walk-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [],
        linked_at: "t",
      }),
    );
    const sub = join(code, "src", "deep");
    await mkdir(sub, { recursive: true });
    expect((await mageMigrate({ dir: sub })).migrated).toHaveLength(1);
  });

  it("throws when there is no KB at or above dir", async () => {
    const empty = await tmp("mage-mig-none-");
    await expect(mageMigrate({ dir: empty })).rejects.toThrow(/no mage knowledge base/i);
  });
});
