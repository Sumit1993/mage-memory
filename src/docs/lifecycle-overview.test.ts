// Drift guard for the hand-authored lifecycle diagram (ADR-0032 §"Docs / diagram
// obligations", item 4). The `loop/overview.md` mermaid is the canonical map of the
// self-grooming state model; it sits outside the generated-data drift test. This
// pins the states + transitions the diagram MUST show, so adding/removing a state in
// the code without updating the map fails CI rather than letting the docs rot.
//
// Deliberately keyword-level (not byte-exact): it asserts presence, not wording, so
// editors can rephrase a node label freely — only dropping a whole state trips it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const OVERVIEW = fileURLToPath(
  new URL("../../docs/src/content/docs/loop/overview.md", import.meta.url),
);

/** The first ```mermaid fenced block in the overview page (the lifecycle diagram). */
function lifecycleDiagram(): string {
  const md = readFileSync(OVERVIEW, "utf8");
  const m = md.match(/```mermaid\n([\s\S]*?)```/);
  if (!m) throw new Error("loop/overview.md has no mermaid lifecycle diagram");
  return m[1];
}

describe("lifecycle overview diagram", () => {
  const diagram = lifecycleDiagram();

  it("shows the shared capture + lesson-path states", () => {
    for (const token of ["mage observe", "boundary", ".mage/staging", "groom", "notes/"]) {
      expect(diagram, `lifecycle diagram should mention "${token}"`).toContain(token);
    }
  });

  it("shows the recurrence-path states", () => {
    for (const token of ["Distill", "Promote", "Graduate", "Optimize"]) {
      expect(diagram, `lifecycle diagram should mention "${token}"`).toContain(token);
    }
  });

  it("shows the Claude Code capture redirect (Gate-0 -> inbox -> staging)", () => {
    // ADR-0032: the native-memory redirect, its scrub/deny gate, and the inbox feeder.
    for (const token of ["autoMemoryDirectory", "Gate-0", "inbox", "ingest"]) {
      expect(diagram, `lifecycle diagram should mention "${token}"`).toContain(token);
    }
  });

  it("shows the staged-rejects sink (distinct from the recurrence rejected.json)", () => {
    expect(diagram).toContain("staged-rejects.json");
  });
});
