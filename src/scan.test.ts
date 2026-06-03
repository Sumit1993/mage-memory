import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CROSS, scanNotes } from "./scan.js";

async function mkVault(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mage-scan-"));
}

async function put(root: string, rel: string, content: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

/** A note body with the given tags and optional extra frontmatter lines. */
function note(tags: string[], extra = ""): string {
  const t = tags.length ? `tags: [${tags.map((x) => JSON.stringify(x)).join(", ")}]\n` : "";
  return `---\n${t}${extra}---\n# Title\n\nbody text\n`;
}

describe("scanNotes — recursive deny-list walk (ADR-0011 §2)", () => {
  it("recurses into projects/ (the headline regression fix)", async () => {
    const root = await mkVault();
    await put(root, "projects/engine/notes/x.md", note(["engine/api"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toContain("projects/engine/notes/x.md");
  });

  it("recurses into any top-level dir, not just notes/decisions/work", async () => {
    const root = await mkVault();
    await put(root, "design/y.md", note(["design/ui"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toContain("design/y.md");
  });

  it("excludes archive/ (a deny-list member, ADR-0011 §5)", async () => {
    const root = await mkVault();
    await put(root, "archive/old.md", note(["x/y"]));
    await put(root, "notes/keep.md", note(["x/y"]));
    const out = await scanNotes(root);
    const paths = out.map((n) => n.relPath);
    expect(paths).toContain("notes/keep.md");
    expect(paths).not.toContain("archive/old.md");
  });

  it("excludes the whole deny-list skip-set", async () => {
    const root = await mkVault();
    for (const d of [".obsidian", ".git", "node_modules", "artifacts", ".learnings"]) {
      await put(root, `${d}/junk.md`, note(["x/y"]));
    }
    await put(root, "notes/real.md", note(["x/y"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toEqual(["notes/real.md"]);
  });

  it("excludes agent skill dirs (.claude, .agents) — where `mage skills` writes", async () => {
    // At a hub root these dirs sit beside the notes; their generated SKILL.md
    // must never be ingested as knowledge notes (caught while migrating a hub).
    const root = await mkVault();
    await put(root, ".claude/skills/mage-wing-x/SKILL.md", note([]));
    await put(root, ".agents/skills/mage-wing-x/SKILL.md", note([]));
    await put(root, "notes/real.md", note(["x/y"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toEqual(["notes/real.md"]);
  });

  it("excludes generated index files ANYWHERE (INDEX.md + _index.*.md)", async () => {
    const root = await mkVault();
    await put(root, "INDEX.md", "# generated\n");
    await put(root, "_index.foo.md", "# generated wing index\n");
    await put(root, "projects/x/_index.bar.md", "# planted deep\n");
    await put(root, "notes/real.md", note(["x/y"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toEqual(["notes/real.md"]);
  });

  it("excludes mage's root scaffolding (AGENTS/CLAUDE/IDENTITY)", async () => {
    // Recursing from the docs ROOT, a hub's own scaffolding lives there. It is
    // not knowledge — it must never pollute the index.
    const root = await mkVault();
    for (const f of ["AGENTS.md", "CLAUDE.md", "IDENTITY.md"]) {
      await put(root, f, "# scaffolding\n");
    }
    await put(root, "notes/real.md", note(["x/y"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toEqual(["notes/real.md"]);
  });

  it("skips an unparseable note with a warning, without crashing the scan", async () => {
    const root = await mkVault();
    await put(root, "notes/bad.md", "---js\nmodule.exports = { x: 1 }\n---\nbody\n");
    await put(root, "notes/good.md", note(["x/y"]));
    const out = await scanNotes(root);
    expect(out.map((n) => n.relPath)).toEqual(["notes/good.md"]);
  });
});

describe("scanNotes — date frontmatter (quoted-string invariant)", () => {
  it("keeps a quoted date as a string", async () => {
    const root = await mkVault();
    await put(root, "notes/a.md", note(["x/y"], 'last_reviewed: "2026-06-03"\n'));
    const out = await scanNotes(root);
    expect(out[0]?.lastReviewed).toBe("2026-06-03");
  });

  it("drops an unquoted YAML date (Date object) without crashing", async () => {
    const root = await mkVault();
    await put(root, "notes/a.md", note(["x/y"], "last_reviewed: 2026-06-03\n"));
    const out = await scanNotes(root);
    expect(out).toHaveLength(1);
    expect(out[0]?.lastReviewed).toBeUndefined();
  });
});

describe("scanNotes — multi-home wings[] (ADR-0012 §5)", () => {
  it("exposes every safe tag-wing, de-duped, primary first", async () => {
    const root = await mkVault();
    await put(root, "notes/a.md", note(["a/x", "b/y", "a/z"]));
    const out = await scanNotes(root);
    expect(out[0]?.wings).toEqual([
      { wing: "a", room: "x" },
      { wing: "b", room: "y" },
    ]);
    expect(out[0]?.wing).toBe("a");
    expect(out[0]?.room).toBe("x");
  });

  it("drops an unsafe segment and promotes the first SAFE wing to primary", async () => {
    const root = await mkVault();
    await put(root, "notes/a.md", note(["../evil", "real/x"]));
    const out = await scanNotes(root);
    expect(out[0]?.wings).toEqual([{ wing: "real", room: "x" }]);
    expect(out[0]?.wing).toBe("real");
  });

  it("an all-unsafe or untagged note is cross-cutting with empty wings[]", async () => {
    const root = await mkVault();
    await put(root, "notes/unsafe.md", note(["../evil"]));
    await put(root, "notes/untagged.md", note([]));
    const out = await scanNotes(root);
    for (const n of out) {
      expect(n.wings).toEqual([]);
      expect(n.wing).toBe(CROSS);
    }
  });
});
