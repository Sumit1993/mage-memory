import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertBuilt, initKb, runMage, tmpKbDir } from "./lib/harness.js";

describe("integration: AGENTS.md block preservation and force override", () => {
  it("keeps a hand-edited block on link with exit 0 and warns, and regenerates with --force-agents-md", async () => {
    assertBuilt();
    // 1. A fixture code repo (init via the CLI)
    const { dir: codeDir } = await initKb();

    // 2. A fixture hub (`mage init --hub`)
    const hubDir = await tmpKbDir("mage-hub-");
    const hubInit = await runMage(["init", "--hub", "--local", "--yes"], { cwd: hubDir });
    expect(hubInit.code).toBe(0);

    // 3. Hand-edit the block
    const agentsPath = join(codeDir, "AGENTS.md");
    const original = await readFile(agentsPath, "utf8");
    const edited = original.replace(/^2\. .*$/m, "## Cross-link, don't just file\n\nhand-written");
    expect(edited).not.toBe(original);
    await writeFile(agentsPath, edited);

    // 4. Run `node dist/cli.js link <hub> --project x --no-connect --yes`
    const linkRun1 = await runMage(
      ["link", hubDir, "--project", "x", "--no-connect", "--yes"],
      { cwd: codeDir },
    );
    expect(linkRun1.code).toBe(0);
    const output1 = linkRun1.stderr + linkRun1.stdout;
    expect(output1).toContain("has hand edits");
    const afterRun1 = await readFile(agentsPath, "utf8");
    expect(afterRun1).toBe(edited);

    // 5. Run again with `--force-agents-md`
    const linkRun2 = await runMage(
      ["link", hubDir, "--project", "x", "--no-connect", "--yes", "--force-agents-md"],
      { cwd: codeDir },
    );
    expect(linkRun2.code).toBe(0);
    const afterRun2 = await readFile(agentsPath, "utf8");
    expect(afterRun2).not.toContain("hand-written");
    expect(afterRun2).toContain("<!-- mage-block-hash: ");
  });
});
