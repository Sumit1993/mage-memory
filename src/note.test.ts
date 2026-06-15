import { describe, expect, it } from "vitest";
import { deriveKeywords, noteRoom, noteWing, noteWings, normalizeTags, parseNote, stringifyNote } from "./note.js";

describe("note frontmatter", () => {
  it("round-trips frontmatter and body", () => {
    const fm = { type: "interface", tags: ["billing/payments"], status: "active" };
    const body = "# Title\n\nBody text.\n";
    const parsed = parseNote(stringifyNote(fm, body));
    expect(parsed.frontmatter.type).toBe("interface");
    expect(parsed.frontmatter.tags).toEqual(["billing/payments"]);
    expect(parsed.body).toContain("Body text.");
  });

  it("round-trips a full frontmatter shape losslessly (nested maps, arrays, dates, unknown keys)", () => {
    const fm = {
      type: "gotcha",
      tags: ["mage/release", "web"],
      created: "2026-06-15",
      provenance: { repo: "mage-memory", work: "0.0.11-release" },
      sources: ["package.json", "README.md"],
      status: "active" as const,
      custom_unknown: { nested: ["x", "y"], n: 3 },
    };
    const body = "# Title\n\nBody with a colon: value, and a [link](x.md).\n";
    const parsed = parseNote(stringifyNote(fm, body));
    expect(parsed.frontmatter).toEqual(fm); // nothing lost or coerced
    expect(parsed.body).toBe(body);
    // YAML 1.1: a quoted date stays a STRING (matching the `created?: string` type),
    // not a Date object — guarding the engine pin.
    expect(typeof parsed.frontmatter.created).toBe("string");
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

describe("noteWings (multi-home by tags, ADR-0012 §5)", () => {
  it("returns every tag's wing/room in order", () => {
    expect(noteWings({ tags: ["a/x", "b/y"] })).toEqual([
      { wing: "a", room: "x" },
      { wing: "b", room: "y" },
    ]);
  });

  it("de-dupes by wing, first occurrence wins (keeps its room)", () => {
    expect(noteWings({ tags: ["a/x", "a/z"] })).toEqual([{ wing: "a", room: "x" }]);
  });

  it("is empty for untagged notes", () => {
    expect(noteWings({ tags: [] })).toEqual([]);
    expect(noteWings({})).toEqual([]);
  });

  it("yields an empty room for a wing-only tag", () => {
    expect(noteWings({ tags: ["a", "b/y"] })).toEqual([
      { wing: "a", room: "" },
      { wing: "b", room: "y" },
    ]);
  });

  it("nested rooms keep the full path", () => {
    expect(noteWings({ tags: ["a/x/deep"] })).toEqual([{ wing: "a", room: "x/deep" }]);
  });

  it("primary wing equals noteWing(fm) for any tagged note", () => {
    const fm = { tags: ["billing/payments", "web/api"] };
    expect(noteWings(fm)[0]?.wing).toBe(noteWing(fm));
  });

  it("strips leading '#' and trims via normalizeTags", () => {
    expect(noteWings({ tags: ["#a/x", " b/y "] })).toEqual([
      { wing: "a", room: "x" },
      { wing: "b", room: "y" },
    ]);
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
  it("has no executable frontmatter engine — parsing never runs code", () => {
    // gray-matter shipped JS/CoffeeScript engines that RAN CODE for a `---js`
    // fence; the yaml parser has none. A `---js` header is not a recognized fence,
    // so it stays inert — no frontmatter, nothing executed.
    expect(parseNote("---js\nmodule.exports = { x: 1 }\n---\nbody\n").frontmatter).toEqual({});
    // And a `!!js/function` tag is never deserialized to a callable (js-yaml's old
    // RCE surface): it resolves to a harmless string.
    const tagged = parseNote('---\nx: !!js/function "function(){return 42}"\n---\nbody\n');
    expect(typeof tagged.frontmatter.x).not.toBe("function");
  });
});
