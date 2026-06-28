import { describe, expect, it } from "vitest";
import {
  captureKey,
  captureSessions,
  ccSessionId,
  deKebab,
  isCcShaped,
  mapType,
  recoverCcFrontmatter,
  rewriteWikilinks,
} from "./cc-note.js";

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

describe("isCcShaped", () => {
  it("matches CC's metadata.node_type: memory discriminator", () => {
    expect(isCcShaped({ metadata: { node_type: "memory" } } as never)).toBe(true);
  });
  it("rejects a hand-authored mage note (no node_type)", () => {
    expect(isCcShaped({ type: "gotcha", tags: ["mage"] } as never)).toBe(false);
    expect(isCcShaped({ metadata: { node_type: "other" } } as never)).toBe(false);
    expect(isCcShaped({} as never)).toBe(false);
  });
});

describe("capture identity", () => {
  it("captureSessions reads bare ids from cc-session: sources only", () => {
    expect(captureSessions({ sources: ["cc-session:abc", "url:x"] } as never)).toEqual(["abc"]);
    expect(captureSessions({} as never)).toEqual([]);
  });
  it("ccSessionId reads the raw metadata.originSessionId", () => {
    expect(ccSessionId({ metadata: { originSessionId: "xyz" } } as never)).toBe("xyz");
    expect(ccSessionId({} as never)).toBeUndefined();
  });
  it("captureKey pairs session AND slug (never session alone)", () => {
    expect(captureKey("abc", "my-note")).toBe("abc::my-note");
  });
});

describe("recoverCcFrontmatter", () => {
  it("recovers buried mage fields, maps the nested CC type, strips CC keys, stamps cc-session", () => {
    const { frontmatter, sessionId } = recoverCcFrontmatter({
      name: "",
      metadata: {
        node_type: "memory",
        type: "reference",
        created: "2026-06-27",
        tags: ["mage/x"],
        originSessionId: "s1",
      },
    } as never);
    expect(frontmatter.type).toBe("pointer"); // nested CC type → mapped
    expect(frontmatter.created).toBe("2026-06-27");
    expect(frontmatter.tags).toEqual(["mage/x"]);
    expect(frontmatter.sources).toEqual(["cc-session:s1"]);
    expect((frontmatter as Record<string, unknown>).name).toBeUndefined();
    expect((frontmatter as Record<string, unknown>).metadata).toBeUndefined();
    expect(sessionId).toBe("s1");
  });
  it("top-level authored fields win over the nested copy and are kept as-is (not mapped)", () => {
    const { frontmatter } = recoverCcFrontmatter({
      type: "gotcha",
      tags: ["real/wing"],
      metadata: { node_type: "memory", type: "reference", tags: ["wrong"] },
    } as never);
    expect(frontmatter.type).toBe("gotcha");
    expect(frontmatter.tags).toEqual(["real/wing"]);
  });
});
