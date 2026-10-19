// Drift guard for the hand-authored ladder docs (ADR-0032 docs obligations, ADR-0060).
// Each assertion pins a fact the code implements, read from the code, so the docs cannot
// drift from it. Keyword-level on purpose: presence, not wording.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAGE_HOOKS } from "../adapters/claude-code/settings.js";
import { LADDER_TEXT } from "../adapters/claude-code/memory-hook.js";
import { RUNGS } from "../scanner/admission.js";

const rel = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const docText = (name: string) => readFileSync(rel(`docs/src/content/docs/loop/${name}`), "utf8");

/** Body of the first mermaid block; the fence caption is metadata, not diagram source. */
function diagramOf(page: string): string {
  const body = docText(page).match(/```mermaid[^\n]*\n([\s\S]*?)```/)?.[1];
  if (body === undefined) throw new Error(`loop/${page} has no mermaid diagram`);
  return body;
}

describe("ladder docs drift guard", () => {
  const diagram = diagramOf("overview.md");

  it("overview lists every rung in RUNGS (src/scanner/admission.ts)", () => {
    const page = docText("overview.md");
    for (const rung of RUNGS) expect(page, `overview should name rung "${rung}"`).toContain(`\`${rung}\``);
  });

  it("overview diagram shows the memory hook, recall hook and groom, which MAGE_HOOKS wires (settings.ts)", () => {
    const wired = MAGE_HOOKS.map((h) => h.command);
    for (const cmd of ["mage memory-hook", "mage recall-hook"]) expect(wired).toContain(cmd);
    for (const token of ["Memory hook", "Recall hook", "mage groom", "mage index", "notes/"]) {
      expect(diagram, `overview diagram should mention "${token}"`).toContain(token);
    }
  });

  it("overview names the Stop hook command MAGE_HOOKS wires for indexing", () => {
    const stop = MAGE_HOOKS.find((h) => h.event === "Stop" && h.command.startsWith("mage index"));
    expect(stop?.command).toBe("mage index --hook");
    expect(docText("overview.md")).toContain(`\`${stop?.command}\``);
  });

  it("overview diagram stays harness-free (adapter specifics belong on capture.md)", () => {
    for (const token of ["autoMemoryDirectory", "Gate-0", "Claude Code"]) {
      expect(diagram, `overview diagram must NOT name "${token}"`).not.toContain(token);
    }
  });

  it("capture page documents the redirect and the gate (memory-hook.ts: LADDER_TEXT, ask once, deny-once opt-in)", () => {
    expect(LADDER_TEXT.length).toBeGreaterThan(0);
    const capture = docText("capture.md");
    for (const token of ["autoMemoryDirectory", "Gate-0", "once per session", "deny-once", "ladder.gate"]) {
      expect(capture, `capture.md should document "${token}"`).toContain(token);
    }
  });

  it("stage-groom.md is a retired pointer to an ADR-0060 that exists", () => {
    expect(existsSync(rel("mage/decisions/0060-the-ladder-reset.md"))).toBe(true);
    const page = docText("stage-groom.md");
    expect(page).toContain("ADR-0060");
    expect(page).toContain("retired");
  });
});
