import { describe, expect, it } from "vitest";
import { deKebab, mapType, rewriteWikilinks } from "./schema-map.js";

describe("mapType", () => {
  it("aliases the known CC metadata types", () => {
    expect(mapType("reference")).toBe("pointer");
    expect(mapType("project")).toBe("note");
    expect(mapType("REFERENCE")).toBe("pointer"); // case-insensitive
  });
  it("passes an unknown type through (mage type is open vocab)", () => {
    expect(mapType("playbook")).toBe("playbook");
  });
  it("defaults to 'note' when absent — never composeDraft's 'gotcha'", () => {
    expect(mapType(undefined)).toBe("note");
    expect(mapType("")).toBe("note");
  });
});

describe("rewriteWikilinks", () => {
  it("rewrites [[name]] into a flat relative link", () => {
    expect(rewriteWikilinks("see [[de-tell-lens-dominates]] for more")).toBe(
      "see [de-tell-lens-dominates](de-tell-lens-dominates.md) for more",
    );
  });
  it("honors an alias [[name|alias]] and slugs the target path", () => {
    expect(rewriteWikilinks("see [[Some Note|the note]]")).toBe(
      "see [the note](some-note.md)",
    );
  });
  it("leaves prose without wikilinks untouched", () => {
    expect(rewriteWikilinks("a normal [link](x.md) and text")).toBe(
      "a normal [link](x.md) and text",
    );
  });
});

describe("deKebab", () => {
  it("turns a kebab/underscore slug into a readable, capitalized title", () => {
    expect(deKebab("wsl-rancher-container-gotchas")).toBe("Wsl rancher container gotchas");
    expect(deKebab("quick_note")).toBe("Quick note");
  });
  it("returns empty string for an empty/whitespace name", () => {
    expect(deKebab("")).toBe("");
    expect(deKebab("   ")).toBe("");
  });
});
