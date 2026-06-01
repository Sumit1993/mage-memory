import { describe, expect, it } from "vitest";
import { deriveKeywords, noteRoom, noteWing, normalizeTags, parseNote, stringifyNote } from "./note.js";

describe("note frontmatter", () => {
  it("round-trips frontmatter and body", () => {
    const fm = { type: "interface", tags: ["billing/payments"], status: "active" };
    const body = "# Title\n\nBody text.\n";
    const parsed = parseNote(stringifyNote(fm, body));
    expect(parsed.frontmatter.type).toBe("interface");
    expect(parsed.frontmatter.tags).toEqual(["billing/payments"]);
    expect(parsed.body).toContain("Body text.");
  });

  it("parses a note with no frontmatter (graceful)", () => {
    const parsed = parseNote("# Just markdown\n\nNo frontmatter.\n");
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toContain("Just markdown");
  });

  it("omits the frontmatter block when empty", () => {
    expect(stringifyNote({}, "# Body only\n").startsWith("---")).toBe(false);
  });

  it("derives wing and room from the first tag", () => {
    expect(noteWing({ tags: ["billing/payments"] })).toBe("billing");
    expect(noteRoom({ tags: ["billing/payments"] })).toBe("payments");
    expect(noteWing({ tags: [] })).toBeNull();
    expect(noteWing({})).toBeNull();
    expect(noteRoom({ tags: ["billing"] })).toBeNull();
  });

  it("normalizes tags (strips leading #)", () => {
    expect(normalizeTags(["#billing/payments", "web"])).toEqual(["billing/payments", "web"]);
  });
});

describe("deriveKeywords", () => {
  it("uses frontmatter keywords verbatim when present", () => {
    expect(deriveKeywords({ keywords: ["a", "b"] }, "# Title", "x.md")).toEqual(["a", "b"]);
  });

  it("is deterministic and drops stopwords / short words", () => {
    const args = [{ tags: ["billing/payments"] }, "# How the payments service works", "x.md"] as const;
    const kw = deriveKeywords(...args);
    expect(kw).toEqual(deriveKeywords(...args));
    expect(kw).not.toContain("the");
    expect(kw).toContain("payments");
    expect(kw).toContain("service");
  });

  it("derives keywords from non-ASCII (non-Latin) titles", () => {
    const kw = deriveKeywords({}, "# Спецификация платежей", "x.md");
    expect(kw.length).toBeGreaterThan(0);
  });
});

describe("note security", () => {
  it("blocks executable (JavaScript) frontmatter engines", () => {
    expect(() => parseNote("---js\nmodule.exports = { x: 1 }\n---\nbody\n")).toThrow();
  });
});
