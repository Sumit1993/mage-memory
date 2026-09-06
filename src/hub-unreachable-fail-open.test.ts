// Issue #158, the OTHER half of the contract: an external-mode repo whose hub is
// unreachable must be VISIBLE on the interactive surfaces (doctor/connect/adopt/
// skills/dashboard — pinned in those files' own tests) and STAY SILENT on the
// capture hot path. Silence there is the deliberate mechanism, not the defect:
// a session must start, a tool call must return, and a pre-commit gate must not
// block, on a machine where the hub simply is not cloned. These pin that.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import { scanStaged } from "./staged-scan.js";
import { memoryPreToolUse } from "./adapters/claude-code/memory-hook.js";
import { nudgeCmd } from "./adapters/claude-code/nudge.js";
import { resolveLearningsDir } from "./observe/store.js";
import { METADATA_SCHEMA, resolveDocsRoot } from "./paths.js";

/** A code repo in external mode whose hub is NOT on this machine. */
async function unreachableExternalRepo(): Promise<string> {
  const code = await tmpDir("mage-failopen-");
  const missing = join(await tmpDir("mage-failopen-hub-"), "not-cloned");
  await mkdir(join(code, "mage"), { recursive: true });
  await writeFile(
    join(code, "mage", "metadata.json"),
    JSON.stringify({
      schema: METADATA_SCHEMA,
      mode: "external",
      project: "engine",
      hub_path: missing,
      hub_repo: null,
      hub_refs: [],
      linked_at: "",
    }),
  );
  return code;
}

describe("unreachable external hub — the capture hot path stays fail-open (#158)", () => {
  it("resolveDocsRoot returns null rather than throwing", async () => {
    const code = await unreachableExternalRepo();
    await expect(resolveDocsRoot(code)).resolves.toBeNull();
  });

  it("observe's sink resolution yields null, never a throw", async () => {
    const code = await unreachableExternalRepo();
    await expect(resolveLearningsDir(code)).resolves.toBeNull();
  });

  it("the memory-hook PASSES the write through instead of throwing", async () => {
    const code = await unreachableExternalRepo();
    const decision = await memoryPreToolUse(
      { tool_name: "Write", tool_input: { file_path: join(code, "note.md"), content: "x" } },
      { cwd: code },
    );
    expect(decision.kind).toBe("pass");
  });

  it("the boundary nudge surfaces the unreachable-hub message (ADR-0045 §6)", async () => {
    const code = await unreachableExternalRepo();
    const r = await nudgeCmd({ cwd: code, source: "startup", sessionId: "s1" });
    expect(r.ran).toBe(true);
    expect(r.nudge).not.toBeNull();
  });

  it("the Gate-2 staged scan opens the gate instead of blocking a commit", async () => {
    const code = await unreachableExternalRepo();
    const r = await scanStaged(code);
    expect(r.blocked).toBe(false);
    expect(r.findings).toEqual([]);
  });
});
