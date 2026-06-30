// Drift guard for the hand-authored loop docs (ADR-0032 §"Docs / diagram obligations",
// item 4). The `loop/overview.md` mermaid is the canonical map of the HARNESS-FREE
// self-grooming state model; the Claude Code capture redirect and the staged-rejects sink
// are documented on their own pages. This pins the states each page MUST show — so adding
// or removing a state in the code without updating the docs fails CI rather than letting
// the map rot — AND pins the core diagram as harness-free, so the adapter can't creep back
// into the overview (the contamination this rewrite removed).
//
// Deliberately keyword-level (not byte-exact): it asserts presence, not wording, so editors
// can rephrase a node label freely — only dropping a whole state (or re-contaminating the
// core diagram) trips it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Full text of a loop doc page. */
function docText(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../docs/src/content/docs/loop/${rel}`, import.meta.url)),
    "utf8",
  );
}

/**
 * The first ```mermaid fenced block's BODY in the overview page (the lifecycle diagram).
 * The fence info string may carry an accessibility caption after the language
 * (`remark-mermaid-pre.mjs` turns it into the figure's aria-label/figcaption), so we
 * skip to the newline before capturing — the caption is metadata, not diagram source.
 */
function lifecycleDiagram(): string {
  const body = docText("overview.md").match(/```mermaid[^\n]*\n([\s\S]*?)```/)?.[1];
  if (body === undefined) throw new Error("loop/overview.md has no mermaid lifecycle diagram");
  return body;
}

describe("loop docs drift guard", () => {
  const diagram = lifecycleDiagram();

  it("the overview diagram shows the shared capture + lesson-path states", () => {
    for (const token of ["Capture", "boundary", "staging", "groom", "notes/"]) {
      expect(diagram, `overview diagram should mention "${token}"`).toContain(token);
    }
  });

  it("the overview diagram shows the recurrence-path states", () => {
    for (const token of ["Distill", "Promote", "Graduate", "Optimize"]) {
      expect(diagram, `overview diagram should mention "${token}"`).toContain(token);
    }
  });

  it("the overview diagram stays HARNESS-FREE (no adapter specifics leak into the core map)", () => {
    for (const token of ["autoMemoryDirectory", "Gate-0", "Claude Code"]) {
      expect(
        diagram,
        `overview diagram must NOT name "${token}" — keep the core loop harness-free (it belongs on capture.md)`,
      ).not.toContain(token);
    }
  });

  it("documents the Claude Code capture redirect on the capture page (Gate-0 -> inbox -> ingest)", () => {
    const capture = docText("capture.md");
    for (const token of ["autoMemoryDirectory", "Gate-0", "inbox", "ingest"]) {
      expect(capture, `capture.md should document "${token}"`).toContain(token);
    }
  });

  it("documents the staged-rejects sink on the stage-and-groom page", () => {
    expect(docText("stage-groom.md")).toContain("staged-rejects.json");
  });
});
