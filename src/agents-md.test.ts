import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeAgentsMd } from "./agents-md.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mage-agents-"));
  made.push(d);
  return d;
}
const readAgents = (d: string) => readFile(join(d, "AGENTS.md"), "utf8");

describe("writeAgentsMd — external kind (ADR-0011/0012)", () => {
  it("points an external code repo at <hub>/_index.<project>.md", async () => {
    const repo = await tmp();
    await writeAgentsMd(repo, { kind: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" });
    const agents = await readAgents(repo);
    expect(agents).toContain("/abs/hub/_index.engine.md");
    expect(agents).toContain("/abs/hub"); // hub path present
  });

  it("does NOT reference the retired per-project entry path", async () => {
    const repo = await tmp();
    await writeAgentsMd(repo, { kind: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" });
    const agents = await readAgents(repo);
    expect(agents).not.toContain("projects/engine/mage/INDEX.md");
    expect(agents).not.toContain("/projects/");
  });

  it("is idempotent (a second write replaces, not appends, the block)", async () => {
    const repo = await tmp();
    const opts = { kind: "external" as const, docsRel: "mage", hubPath: "/abs/hub", project: "engine" };
    await writeAgentsMd(repo, opts);
    const first = await readAgents(repo);
    await writeAgentsMd(repo, opts);
    const second = await readAgents(repo);
    expect(second).toBe(first);
    expect((second.match(/<!-- BEGIN mage -->/g) ?? []).length).toBe(1);
  });

  it("adds the @AGENTS.md import to CLAUDE.md", async () => {
    const repo = await tmp();
    await writeAgentsMd(repo, { kind: "external", docsRel: "mage", hubPath: "/abs/hub", project: "engine" });
    expect(await readFile(join(repo, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
  });

  it("rejects an unsafe project name and writes nothing", async () => {
    const repo = await tmp();
    await expect(
      writeAgentsMd(repo, { kind: "external", docsRel: "mage", hubPath: "/abs/hub", project: "../evil" }),
    ).rejects.toThrow();
  });

  it("leaves the in-repo kind unchanged", async () => {
    const repo = await tmp();
    await writeAgentsMd(repo, { kind: "in-repo", docsRel: "mage" });
    const agents = await readAgents(repo);
    expect(agents).toContain("knowledge base at `mage/`");
    expect(agents).not.toContain("_index.");
  });
});
