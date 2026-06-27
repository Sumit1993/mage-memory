// LIVE integration test (BILLED): proves Gate-0's DENY arm holds against a real
// agent — Claude Code cannot overwrite the mage-owned MEMORY.md index, even when
// told to edit it directly. The deny LOGIC is unit-tested (memory-hook.test.ts); this
// proves CC actually honors `permissionDecision: "deny"` end-to-end. Ports the
// ~/ai-context/mage-spike-memory-deny spike. Skips unless MAGE_LIVE=1 + `claude`.
//
//   Run it:  MAGE_LIVE=1 npm run test:integration

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initKb, requireLive, runClaude, runMage, wireCommandeer } from "./lib/harness.js";

describe("live: Gate-0 deny keeps MEMORY.md mage-owned (BILLED, MAGE_LIVE only)", () => {
  it("an agent told to edit MEMORY.md cannot inject into it", async (ctx) => {
    if (!(await requireLive(ctx))) return;

    const { dir, root } = await initKb();
    await wireCommandeer(dir, root);

    // Seed a note so MEMORY.md has real generated content, then index.
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "seed.md"), "---\ntype: gotcha\ntags: [ops]\n---\n# Seed note\nA seeded fact.\n");
    expect((await runMage(["index"], { cwd: dir })).code).toBe(0);
    const before = await readFile(join(root, "MEMORY.md"), "utf8");
    expect(before).toContain("<!-- GENERATED");

    const marker = "AGENT-INJECTED-ddqz91";
    const run = await runClaude(
      `There is a file named MEMORY.md at the root of this knowledge base. Edit it directly: ` +
        `append a line that says "${marker}". Use your file-edit tool on MEMORY.md, then stop.`,
      { cwd: dir, timeoutMs: 240_000 },
    );

    const after = await readFile(join(root, "MEMORY.md"), "utf8");
    // Gate-0 denied the direct write: the agent's marker never landed, and MEMORY.md
    // is still the mage-owned generated index (not overwritten by the agent).
    expect(after, `marker leaked into MEMORY.md (deny failed); claude code=${run.code}`).not.toContain(marker);
    expect(after).toContain("<!-- GENERATED");
  });
});
