import { describe, expect, it } from "vitest";
import {
  type CcMemoryNote,
  mapCcMemoryToMageNote,
  mapType,
  rewriteWikilinks,
} from "./schema-map.js";

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

describe("mapCcMemoryToMageNote", () => {
  const cc: CcMemoryNote = {
    frontmatter: {
      name: "wsl-rancher-container-gotchas",
      description: "Rancher Desktop on WSL needs the moby engine, not containerd.",
      metadata: {
        node_type: "memory",
        type: "reference",
        originSessionId: "abc-123-uuid",
      },
    },
    body: "**Symptom:** pods stuck pending. See [[de-tell-lens-dominates]].",
  };

  it("maps name → slug and a de-kebabbed H1 title", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage" });
    expect(r.slug).toBe("wsl-rancher-container-gotchas");
    expect(r.body.startsWith("# Wsl rancher container gotchas")).toBe(true);
  });

  it("maps metadata.type → mage type and drops node_type", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage" });
    expect(r.frontmatter.type).toBe("pointer");
    expect(r.frontmatter).not.toHaveProperty("node_type");
    expect(JSON.stringify(r.frontmatter)).not.toContain("memory"); // node_type discriminator gone
  });

  it("folds the description into the body lead (mage has no description field)", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage" });
    expect(r.body).toContain("Rancher Desktop on WSL needs the moby engine");
    expect(r.frontmatter).not.toHaveProperty("description");
  });

  it("rewrites body wikilinks to flat relative links", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage" });
    expect(r.body).toContain("[de-tell-lens-dominates](de-tell-lens-dominates.md)");
    expect(r.body).not.toContain("[[");
  });

  it("routes originSessionId to a sources pointer (not provenance)", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage" });
    expect(r.frontmatter.sources).toEqual(["cc-session:abc-123-uuid"]);
    expect(r.frontmatter.provenance).toBeUndefined();
  });

  it("best-guesses the wing tag from ctx.wing (groom confirms it)", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage" });
    expect(r.frontmatter.tags).toContain("mage");
  });

  it("never stamps promote-time fields (status / last_reviewed / provenance)", () => {
    const r = mapCcMemoryToMageNote(cc, { wing: "mage", created: "2026-06-27" });
    expect(r.frontmatter.status).toBeUndefined();
    expect(r.frontmatter.last_reviewed).toBeUndefined();
    expect(r.frontmatter.provenance).toBeUndefined();
    expect(r.frontmatter.created).toBe("2026-06-27");
  });

  it("handles a minimal note (no description, no metadata) without throwing", () => {
    const r = mapCcMemoryToMageNote({ frontmatter: { name: "quick-note" }, body: "a body" });
    expect(r.slug).toBe("quick-note");
    expect(r.frontmatter.type).toBe("note");
    expect(r.frontmatter.sources).toBeUndefined();
  });
});
