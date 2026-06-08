import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { type IngestSource, scanIngestSources } from "./ingest.js";

async function mkDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mage-ingest-"));
}

async function put(root: string, rel: string, content: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

/** Index the scanned sources by relPath for ergonomic per-file assertions. */
function byPath(sources: IngestSource[]): Map<string, IngestSource> {
  return new Map(sources.map((s) => [s.relPath, s]));
}

describe("scanIngestSources — classification (ADR-0018, no feeders, read-only)", () => {
  async function fixture(): Promise<IngestSource[]> {
    const root = await mkDir();
    // skill: SKILL.md with name + description
    await put(
      root,
      "pack/SKILL.md",
      "---\nname: my-skill\ndescription: |\n  Does a thing.\n  More detail on a second line.\n---\n# My Skill\n",
    );
    // skipped: instinct yaml under instincts/ — foreign memory, NOT harvested
    // (ADR-0018 §8 feeders cut). It must be absent from the manifest entirely.
    await put(
      root,
      "instincts/inst-1.yaml",
      "id: inst-1\ntrigger: on save\nconfidence: 0.8\n",
    );
    // prose: MEMORY.md carries no mage frontmatter, so it is plain prose now —
    // no native-memory special case (ADR-0018 §8).
    await put(root, "memory/MEMORY.md", "# Memory Index\n\n- a thing\n");
    // transcript: a .jsonl file
    await put(root, "logs/foo.jsonl", '{"role":"user","content":"hi"}\n');
    // note: mage-shaped .md with type + tags
    await put(
      root,
      "notes/real.md",
      "---\ntype: gotcha\ntags: [x/y]\n---\n# Real Note\n\nbody\n",
    );
    // prose: a plain .md with no frontmatter
    await put(root, "docs/readme.md", "# Plain Prose\n\nsome text\n");
    // skipped: a binary image
    await put(root, "assets/pic.png", "\x89PNG\r\n");
    return scanIngestSources(root);
  }

  it("classifies a SKILL.md as 'skill' with name + first-line description", async () => {
    const m = byPath(await fixture());
    const s = m.get("pack/SKILL.md");
    expect(s?.kind).toBe("skill");
    expect(s?.title).toBe("my-skill");
    expect(s?.summary).toBe("Does a thing.");
  });

  it("skips an instincts/*.yaml (foreign memory, not harvested)", async () => {
    const m = byPath(await fixture());
    expect(m.has("instincts/inst-1.yaml")).toBe(false);
  });

  it("classifies a frontmatter-less MEMORY.md as plain 'prose'", async () => {
    const m = byPath(await fixture());
    const s = m.get("memory/MEMORY.md");
    expect(s?.kind).toBe("prose");
    expect(s?.title).toBe("Memory Index");
  });

  it("classifies a .jsonl file as 'transcript'", async () => {
    const m = byPath(await fixture());
    expect(m.get("logs/foo.jsonl")?.kind).toBe("transcript");
  });

  it("classifies a mage-shaped note (type/tags) as 'note' with H1 title", async () => {
    const m = byPath(await fixture());
    const s = m.get("notes/real.md");
    expect(s?.kind).toBe("note");
    expect(s?.title).toBe("Real Note");
  });

  it("classifies a plain markdown file as 'prose' with H1 title", async () => {
    const m = byPath(await fixture());
    const s = m.get("docs/readme.md");
    expect(s?.kind).toBe("prose");
    expect(s?.title).toBe("Plain Prose");
  });

  it("skips binary/image files (not returned)", async () => {
    const paths = (await fixture()).map((s) => s.relPath);
    expect(paths).not.toContain("assets/pic.png");
  });

  it("returns sources sorted by relPath, one per ingestable file (no yaml)", async () => {
    const paths = (await fixture()).map((s) => s.relPath);
    expect(paths).toEqual([...paths].sort());
    // instincts/inst-1.yaml and assets/pic.png are skipped; MEMORY.md is prose.
    expect(paths).toEqual([
      "docs/readme.md",
      "logs/foo.jsonl",
      "memory/MEMORY.md",
      "notes/real.md",
      "pack/SKILL.md",
    ]);
  });
});

describe("scanIngestSources — yaml is never ingestable (feeders cut)", () => {
  it("skips a .yml that looks like an ECC instinct (trigger+confidence)", async () => {
    // Foreign instinct YAML carries trigger+confidence, but mage no longer
    // harvests it — it distills only its own `.learnings/` schema (ADR-0018 §8).
    const root = await mkDir();
    await put(root, "rules/r.yml", "name: r-rule\ntrigger: edit\nconfidence: 0.5\n");
    const out = await scanIngestSources(root);
    expect(out).toEqual([]);
  });

  it("skips a plain config .yaml", async () => {
    const root = await mkDir();
    await put(root, "config/app.yaml", "name: app\nport: 8080\n");
    const out = await scanIngestSources(root);
    expect(out).toEqual([]);
  });
});

describe("scanIngestSources — a .md with metadata.type classifies by its real frontmatter", () => {
  it("a .md with metadata.type but no mage type/tags is 'prose' (no native case)", async () => {
    // What used to trip the native-feeder detector now falls through the normal
    // .md branch: with no top-level mage `type`/`tags`, it is plain prose.
    const root = await mkDir();
    await put(
      root,
      "mem/note.md",
      "---\nname: A User Fact\nmetadata:\n  type: user\n---\n# A User Fact\n\nbody\n",
    );
    const m = byPath(await scanIngestSources(root));
    const s = m.get("mem/note.md");
    expect(s?.kind).toBe("prose");
    expect(s?.title).toBe("A User Fact");
  });

  it("a .md with metadata.type AND a real mage type is a 'note'", async () => {
    // Real mage frontmatter wins: a top-level `type` makes it a tracked note,
    // regardless of any incidental `metadata.type`.
    const root = await mkDir();
    await put(
      root,
      "mem/tracked.md",
      "---\ntype: gotcha\nmetadata:\n  type: user\n---\n# Tracked\n\nbody\n",
    );
    const m = byPath(await scanIngestSources(root));
    const s = m.get("mem/tracked.md");
    expect(s?.kind).toBe("note");
    expect(s?.title).toBe("Tracked");
  });
});

describe("scanIngestSources — prose title fallbacks", () => {
  it("uses the first non-empty line when there is no H1", async () => {
    const root = await mkDir();
    await put(root, "p.txt", "\n\nFirst real line\nsecond line\n");
    const m = byPath(await scanIngestSources(root));
    expect(m.get("p.txt")?.kind).toBe("prose");
    expect(m.get("p.txt")?.title).toBe("First real line");
  });

  it("treats a .markdown file as prose too", async () => {
    const root = await mkDir();
    await put(root, "doc.markdown", "# Heading\n");
    const m = byPath(await scanIngestSources(root));
    expect(m.get("doc.markdown")?.kind).toBe("prose");
    expect(m.get("doc.markdown")?.title).toBe("Heading");
  });
});

describe("scanIngestSources — walking + skips", () => {
  it("walks nested directories", async () => {
    const root = await mkDir();
    await put(root, "a/b/c/deep.md", "# Deep\n");
    const paths = (await scanIngestSources(root)).map((s) => s.relPath);
    expect(paths).toContain("a/b/c/deep.md");
  });

  it("skips .git, node_modules, dist, .obsidian", async () => {
    const root = await mkDir();
    for (const d of [".git", "node_modules", "dist", ".obsidian"]) {
      await put(root, `${d}/junk.md`, "# Junk\n");
    }
    await put(root, "keep.md", "# Keep\n");
    const paths = (await scanIngestSources(root)).map((s) => s.relPath);
    expect(paths).toEqual(["keep.md"]);
  });

  it("returns [] for an empty directory", async () => {
    const root = await mkDir();
    expect(await scanIngestSources(root)).toEqual([]);
  });

  it("degrades an unparseable-frontmatter .md to 'prose' instead of throwing", async () => {
    const root = await mkDir();
    // An executable-frontmatter engine is hard-disabled — must not crash the scan.
    await put(root, "bad.md", "---js\nmodule.exports = { x: 1 }\n---\nbody\n");
    const m = byPath(await scanIngestSources(root));
    expect(m.get("bad.md")?.kind).toBe("prose");
  });

  it("skips a .yaml without reading it (no crash on malformed content)", async () => {
    const root = await mkDir();
    await put(root, "weird.yaml", "::: not : valid : yaml :::\n");
    // YAML is never ingestable now — skipped before any parse, so no throw.
    const out = await scanIngestSources(root);
    expect(out).toEqual([]);
  });
});

describe("scanIngestSources — priority invariants", () => {
  it("a SKILL.md carrying mage note frontmatter (type/tags) is still 'skill'", async () => {
    // The SKILL.md basename check must win over the .md note branch — a future
    // reorder that broke this would silently re-tag skills as notes (ADR-0013).
    const root = await mkDir();
    await put(
      root,
      "p/SKILL.md",
      "---\nname: dual\ndescription: both shapes\ntype: gotcha\ntags: [x/y]\n---\n# Dual\n",
    );
    const m = byPath(await scanIngestSources(root));
    expect(m.get("p/SKILL.md")?.kind).toBe("skill");
  });

  it("an empty .yaml under instincts/ is skipped, without throwing", async () => {
    const root = await mkDir();
    await put(root, "instincts/empty.yaml", "");
    const out = await scanIngestSources(root);
    expect(out).toEqual([]);
  });
});
