import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HubProject } from "../paths.js";
import { verify } from "./verify.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A minimally-valid hub root (passes the structure checks) + a registry. */
async function makeHub(projects: HubProject[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-verify-"));
  made.push(dir);
  for (const d of ["projects", "notes", "archive"]) await mkdir(join(dir, d), { recursive: true });
  await writeFile(join(dir, "INDEX.md"), "# Index\n");
  await writeFile(
    join(dir, "metadata.json"),
    `${JSON.stringify({ schema: "mage.v1", name: "h", created_at: "2026-06-03", projects }, null, 2)}\n`,
  );
  return dir;
}
const project = (name: string, storage: HubProject["storage"]): HubProject => ({
  name,
  storage,
  code_repo_path: "/code",
  code_repo_url: "/code",
});

describe("mage verify — project drift is info, never a failure (ADR-0011 §7)", () => {
  it("a registered hub-owned project with 0 notes warns but passes", async () => {
    const hub = await makeHub([project("p1", "hub-owned")]);
    await mkdir(join(hub, "projects", "p1"), { recursive: true }); // empty
    const r = await verify({ hub });
    expect(r.passed).toBe(true);
    expect(r.projectChecks.find((c) => c.project === "p1")?.ok).toBe(true);
  });

  it("an on-disk projects/ dir not in the registry is info, passed unchanged", async () => {
    const hub = await makeHub([]);
    await mkdir(join(hub, "projects", "ghost"), { recursive: true });
    const r = await verify({ hub });
    expect(r.passed).toBe(true);
    expect(r.projectChecks.some((c) => c.project === "ghost")).toBe(true);
  });

  it("a hub-owned project WITH notes passes as a success", async () => {
    const hub = await makeHub([project("p1", "hub-owned")]);
    await mkdir(join(hub, "projects", "p1", "notes"), { recursive: true });
    await writeFile(join(hub, "projects", "p1", "notes", "n.md"), "---\ntags: [p1/x]\n---\n# N\n");
    const r = await verify({ hub });
    expect(r.passed).toBe(true);
    expect(r.projectChecks.find((c) => c.project === "p1")?.detail).toMatch(/file/);
  });
});
