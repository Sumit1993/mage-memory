import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { renderKnowledgeBase } from "./bases.js";
import type { DashboardData } from "./types.js";

// ─── YAML parse helper ───────────────────────────────────────────────────────
//
// The package ships no YAML library, but `gray-matter` bundles a YAML engine.
// Wrap the emitted `.base` body in frontmatter delimiters and parse it back: a
// clean parse PROVES the renderer produced valid YAML. We assert on the parsed
// object so the test is structural (not string-brittle).

interface BasesDoc {
  properties?: Record<string, { displayName?: string }>;
  views?: BasesView[];
}

interface BasesView {
  type?: string;
  name?: string;
  filters?: { and?: unknown[]; or?: unknown[]; not?: unknown[] };
  groupBy?: { property?: string; direction?: string };
  order?: string[];
}

function parseBase(yaml: string): BasesDoc {
  return matter(`---\n${yaml}---\n`).data as BasesDoc;
}

// ─── fixture ─────────────────────────────────────────────────────────────────

function fixture(): DashboardData {
  return {
    meta: {
      kbName: "demo",
      kind: "in-repo",
      root: "/abs/demo/mage",
      mageVersion: "9.9.9",
      lastRefreshed: "2026-06-09T12:00:00.000Z",
    },
    kpis: { notes: 3, skills: 0, wings: 2, contextMatchPct: 0, awaitingYou: 0, graduateReady: 0 },
    proposals: [],
    wings: [
      // unsorted + a cross-cutting ("") wing to prove sort + filter behavior.
      { name: "beta", noteCount: 1, skillCount: 0 },
      { name: "", noteCount: 1, skillCount: 0 },
      { name: "alpha", noteCount: 1, skillCount: 0, rooms: ["core"] },
    ],
    notes: [],
    skills: [],
    graph: { nodes: [], edges: [] },
    activity: [],
    ladder: { scratch: 0, notes: 3, skills: 0, climbing: [] },
    health: { notesDueForReview: 0, danglingLinks: 0, orphanNotes: 0, lastCommit: null },
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("renderKnowledgeBase", () => {
  it("emits valid YAML that parses cleanly", () => {
    const yaml = renderKnowledgeBase(fixture());
    expect(() => parseBase(yaml)).not.toThrow();
    const doc = parseBase(yaml);
    expect(doc).toBeTypeOf("object");
    expect(Array.isArray(doc.views)).toBe(true);
  });

  it("declares frontmatter-only property display names", () => {
    const doc = parseBase(renderKnowledgeBase(fixture()));
    expect(doc.properties).toBeDefined();
    expect(doc.properties?.["note.type"]).toEqual({ displayName: "Type" });
    expect(doc.properties?.["note.status"]).toEqual({ displayName: "Status" });
    expect(doc.properties?.["note.last_reviewed"]).toEqual({ displayName: "Last reviewed" });
  });

  it("includes an All-notes table grouped by type", () => {
    const doc = parseBase(renderKnowledgeBase(fixture()));
    const view = doc.views?.find((v) => v.name === "All notes");
    expect(view).toBeDefined();
    expect(view?.type).toBe("table");
    expect(view?.groupBy).toEqual({ property: "note.type", direction: "ASC" });
    expect(view?.order).toEqual([
      "file.name",
      "note.type",
      "note.status",
      "note.last_reviewed",
    ]);
  });

  it("includes a Due-for-review view filtered on last_reviewed only", () => {
    const doc = parseBase(renderKnowledgeBase(fixture()));
    const view = doc.views?.find((v) => v.name === "Due for review");
    expect(view).toBeDefined();
    expect(view?.type).toBe("table");
    expect(view?.filters?.or).toEqual([
      "!note.last_reviewed",
      'note.last_reviewed < (now() - "180d")',
    ]);
  });

  it("derives one wing view per non-empty wing, sorted, tag-filtered", () => {
    const doc = parseBase(renderKnowledgeBase(fixture()));
    const wingViews = (doc.views ?? []).filter((v) => v.name?.startsWith("Wing · "));
    expect(wingViews.map((v) => v.name)).toEqual(["Wing · alpha", "Wing · beta"]);
    // cross-cutting wing ("") yields no view.
    expect(doc.views?.some((v) => v.name === "Wing · ")).toBe(false);
    const alpha = wingViews.find((v) => v.name === "Wing · alpha");
    expect(alpha?.filters?.and).toEqual(['file.hasTag("alpha")']);
    expect(alpha?.groupBy).toEqual({ property: "note.type", direction: "ASC" });
  });

  it("references NO .metrics-derived value (frontmatter half only)", () => {
    const yaml = renderKnowledgeBase(fixture());
    expect(yaml).not.toContain("context");
    expect(yaml).not.toContain("contextMatch");
    expect(yaml).not.toContain("proposal");
    expect(yaml).not.toContain("scratch");
    expect(yaml).not.toContain("awaiting");
  });

  it("is deterministic — same data yields identical bytes", () => {
    const a = renderKnowledgeBase(fixture());
    const b = renderKnowledgeBase(fixture());
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });

  it("handles a KB with no wings — still valid YAML with the two base views", () => {
    const noWings: DashboardData = { ...fixture(), wings: [] };
    const doc = parseBase(renderKnowledgeBase(noWings));
    expect(doc.views?.map((v) => v.name)).toEqual(["All notes", "Due for review"]);
  });
});
