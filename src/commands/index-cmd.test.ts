import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import {
  AUTO_MEMORY_MAX_BYTES,
  AUTO_MEMORY_MAX_LINES,
} from "../adapters/claude-code/constants.js";
import { BREACH_RATIO } from "../metrics/footprint.js";
import type { HubProject } from "../paths.js";
import type { ScannedNote } from "../scan.js";
import { index, renderMemory, SCAFFOLDING_WORDS } from "./index-cmd.js";
import { init } from "./init.js";

async function vault(): Promise<string> {
  const dir = await tmpDir("mage-idx-");
  await init({ mode: "in-repo", yes: true, codeRepo: dir, project: "t" });
  return dir;
}

async function note(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, "mage", "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}

// The on-disk metadata.json may carry the legacy v1 `storage: "in-repo"` alias,
// which readHubMetadata normalizes to "repo-owned" on read. Model that raw shape
// so a fixture can exercise the normalization path (the `schema: "mage.v1"` file
// written below is exactly where the legacy value is valid). withKb refuses the
// legacy `in-repo` storage alias, so this foreign-schema writer stays local.
type RawHubProject = Omit<HubProject, "storage"> & {
  storage: HubProject["storage"] | "in-repo";
};

/** A hub root (kind=hub): projects/ dir + a top-level metadata.json registry. */
async function hub(projects: RawHubProject[] = []): Promise<string> {
  const dir = await tmpDir("mage-hub-");
  await mkdir(join(dir, "projects"), { recursive: true });
  const meta = {
    schema: "mage.v1",
    name: "myhub",
    created_at: "2026-06-03",
    projects,
  };
  await writeFile(
    join(dir, "metadata.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  return dir;
}

/** Write a note at an arbitrary path under a docs root (hub-relative). */
async function put(
  root: string,
  relUnderRoot: string,
  content: string,
): Promise<void> {
  const p = join(root, relUnderRoot);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}
const readIndex = (root: string) => readFile(join(root, "INDEX.md"), "utf8");

describe("mage index", () => {
  it("produces a flat index grouped by wing, with a cross-cutting section", async () => {
    const dir = await vault();
    await note(
      dir,
      "billing/pay.md",
      "---\ntype: procedure\ntags: [billing/payments]\n---\n# Pay\n",
    );
    await note(dir, "overview.md", "---\ntype: note\n---\n# Overview\n");
    const r = await index({ dir });
    expect(r.hierarchical).toBe(false);
    expect(r.wings).toEqual(["billing"]);
    expect(r.noteCount).toBe(2);
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("## billing");
    expect(idx).toContain("## Cross-cutting");
    expect(idx).toContain("[Pay](notes/billing/pay.md)");
  });

  it("is idempotent (re-run = byte-identical)", async () => {
    const dir = await vault();
    await note(dir, "a.md", "---\ntype: note\ntags: [x/y]\n---\n# A\n");
    await index({ dir });
    const first = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    await index({ dir });
    const second = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(second).toBe(first);
  });

  // ─── MEMORY.md — the Claude Code adapter twin (ADR-0032/0033) ────────────────

  it("emits a MEMORY.md twin alongside INDEX.md (flat single-wing KB)", async () => {
    const dir = await vault();
    await note(
      dir,
      "billing/pay.md",
      "---\ntype: procedure\ntags: [billing/payments]\n---\n# Pay\n",
    );
    const r = await index({ dir });
    expect(r.written).toContain("MEMORY.md");
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    // Flat KB: MEMORY.md folds the per-note list inline with an overflow line.
    expect(mem).toContain("[Pay](notes/billing/pay.md)");
    expect(mem).toContain("1 memory note total (1 shown)");
    expect(mem).toContain("Read INDEX.md before non-trivial work.");
  });

  it("folds the per-note list INTO MEMORY.md for a single-wing hierarchical KB", async () => {
    const dir = await vault();
    for (let i = 0; i < 21; i++)
      await note(
        dir,
        `n${i}.md`,
        `---\ntype: note\ntags: [one/r]\n---\n# n${i}\n`,
      );
    const r = await index({ dir });
    expect(r.hierarchical).toBe(true);
    expect(r.wings).toEqual(["one"]);
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    // INDEX.md stays the bounded wings-map (links OUT to the per-wing index)…
    expect(idx).toContain("[_index.one.md](_index.one.md)");
    expect(idx).not.toContain("[n0](notes/n0.md)");
    // …but MEMORY.md folds the per-note list inline (CC self-bounds the load at 25KB).
    expect(mem).toContain("[n0](notes/n0.md)");
    expect(mem).not.toContain("_index.one.md");
  });

  it("keeps MEMORY.md a bounded wings-map twin for a multi-wing hierarchical KB", async () => {
    const dir = await vault();
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(
        dir,
        `${w}.md`,
        `---\ntype: note\ntags: [${w}/r]\n---\n# ${w}\n`,
      );
    }
    const r = await index({ dir });
    expect(r.hierarchical).toBe(true);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    // Multi-wing: never inline every wing — MEMORY.md is the wings-map twin of INDEX.md.
    expect(mem).toContain("## Wings");
    expect(mem).toContain("[_index.a.md](_index.a.md)");
    expect(mem).toBe(await readFile(join(dir, "mage", "INDEX.md"), "utf8"));
  });

  it("MEMORY.md is idempotent (re-run = byte-identical)", async () => {
    const dir = await vault();
    await note(dir, "a.md", "---\ntype: note\ntags: [x/y]\n---\n# A\n");
    await index({ dir });
    const first = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    await index({ dir });
    expect(await readFile(join(dir, "mage", "MEMORY.md"), "utf8")).toBe(first);
  });

  it("goes hierarchical past the wing threshold and writes per-wing files", async () => {
    const dir = await vault();
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(
        dir,
        `${w}.md`,
        `---\ntype: note\ntags: [${w}/r]\n---\n# ${w}\n`,
      );
    }
    const r = await index({ dir });
    expect(r.hierarchical).toBe(true);
    expect(r.wings.length).toBe(5);
    const root = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(root).toContain("## Wings");
    expect(root).toContain("[_index.a.md](_index.a.md)");
    expect(await readFile(join(dir, "mage", "_index.a.md"), "utf8")).toContain(
      "# a",
    );
  });

  it("keeps the heading hierarchy contiguous in BOTH index shapes (no MD001 skip)", async () => {
    // Rooms nest one level under their document's own title: the root index puts them
    // under `## <wing>` (so `###`), a per-wing index under its `# <wing>` (so `##`).
    // Hardcoding `###` for both skipped a level in the per-wing file — and because that
    // file is GENERATED, the only place to fix it is the renderer.
    const dir = await vault();
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(
        dir,
        `${w}.md`,
        `---\ntype: note\ntags: [${w}/r]\n---\n# ${w}\n`,
      );
    }
    await index({ dir });

    const wingIdx = await readFile(join(dir, "mage", "_index.a.md"), "utf8");
    expect(wingIdx).toContain("# a");
    expect(wingIdx).toContain("## r"); // one level under the `# a` title
    expect(wingIdx).not.toContain("### r"); // the skip this test exists to prevent

    const root = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(root).toContain("## Wings"); // rooms are not rendered in the bounded root map
  });

  it("cleans up stale per-wing index files when dropping back to flat", async () => {
    const dir = await vault();
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(
        dir,
        `${w}.md`,
        `---\ntype: note\ntags: [${w}/r]\n---\n# ${w}\n`,
      );
    }
    await index({ dir });
    for (const w of ["b", "c", "d", "e"])
      await rm(join(dir, "mage", "notes", `${w}.md`));
    const r = await index({ dir });
    expect(r.hierarchical).toBe(false);
    await expect(
      readFile(join(dir, "mage", "_index.b.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("throws when there is no knowledge base", async () => {
    const dir = await tmpDir("mage-none-");
    await expect(index({ dir })).rejects.toThrow(/No mage knowledge base/);
  });

  it("stays flat at exactly the thresholds and flips just past them", async () => {
    const wingVault = async (wings: string[]) => {
      const d = await vault();
      for (const w of wings)
        await note(
          d,
          `${w}.md`,
          `---\ntype: note\ntags: [${w}/r]\n---\n# ${w}\n`,
        );
      return (await index({ dir: d })).hierarchical;
    };
    const noteVault = async (n: number) => {
      const d = await vault();
      for (let i = 0; i < n; i++)
        await note(
          d,
          `n${i}.md`,
          `---\ntype: note\ntags: [one/r]\n---\n# n${i}\n`,
        );
      return (await index({ dir: d })).hierarchical;
    };
    expect(await wingVault(["a", "b", "c", "d"])).toBe(false); // exactly 4 wings → flat
    expect(await wingVault(["a", "b", "c", "d", "e"])).toBe(true); // 5 wings → hierarchical
    expect(await noteVault(20)).toBe(false); // exactly 20 notes → flat
    expect(await noteVault(21)).toBe(true); // 21 notes → hierarchical
  });

  it("percent-encodes special characters in note link destinations", async () => {
    const dir = await vault();
    await note(
      dir,
      "weird (v2) #1.md",
      "---\ntype: note\ntags: [x/y]\n---\n# Weird\n",
    );
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("(notes/weird%20%28v2%29%20%231.md)");
    expect(idx).not.toContain("(notes/weird (v2) #1.md)");
  });

  it("treats _index.*.md as a reserved generated name (excluded everywhere)", async () => {
    // ADR-0011 §2: the recursive walk now visits the docs root, where generated
    // `_index.<wing>.md` live — so the `_index.*.md` namespace is reserved for
    // mage's own output and never indexed as a user note.
    const dir = await vault();
    await note(
      dir,
      "_index.architecture.md",
      "---\ntype: note\ntags: [sys/arch]\n---\n# Architecture\n",
    );
    await note(
      dir,
      "real.md",
      "---\ntype: note\ntags: [sys/arch]\n---\n# Real\n",
    );
    const r = await index({ dir });
    expect(r.noteCount).toBe(1); // only real.md; the _index.* file is reserved
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).not.toContain("Architecture");
    expect(idx).toContain("Real");
  });

  it("reclassifies an unsafe wing tag to cross-cutting (no traversal filename)", async () => {
    const dir = await vault();
    await note(
      dir,
      "evil.md",
      "---\ntype: note\ntags: [../escape/x]\n---\n# Evil\n",
    );
    const r = await index({ dir });
    expect(r.wings).toEqual([]); // ".." wing rejected
    expect(r.noteCount).toBe(1); // still indexed, as cross-cutting
  });

  it("cross-lists a multi-homed note under every tagged wing (per-wing room)", async () => {
    const dir = await vault();
    await note(
      dir,
      "rel.md",
      "---\ntype: pointer\ntags: [a/x, b/y]\n---\n# My Rel\n",
    );
    const r = await index({ dir });
    expect(r.wings).toEqual(["a", "b"]);
    expect(r.noteCount).toBe(1); // counted once, listed twice
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("## a");
    expect(idx).toContain("## b");
    expect(idx).toContain("### x"); // room under primary wing a
    expect(idx).toContain("### y"); // room under secondary wing b
    expect((idx.match(/My Rel/g) ?? []).length).toBe(2); // appears in both wings
    expect(idx).not.toContain("## Cross-cutting"); // multi-homed ≠ cross-cutting
  });
});

describe("mage index — hub projects + registry (ADR-0011/0012)", () => {
  it("indexes hub-owned project notes and excludes their archive/", async () => {
    const root = await hub([
      {
        name: "engine",
        storage: "hub-owned",
        code_repo_path: "/code/engine",
        code_repo_url: "git@github.com:me/engine.git",
      },
    ]);
    await put(
      root,
      "projects/engine/notes/api.md",
      "---\ntype: note\ntags: [engine/api]\n---\n# Engine API\n",
    );
    await put(
      root,
      "projects/engine/archive/old.md",
      "---\ntype: note\ntags: [engine/api]\n---\n# Old\n",
    );
    const r = await index({ dir: root });
    expect(r.wings).toContain("engine");
    expect(r.noteCount).toBe(1); // archived note excluded
    const idx = await readIndex(root);
    expect(idx).toContain("Engine API");
    expect(idx).not.toContain("# Old");
  });

  it("decorates a wing that matches a registered project with its code-repo pointer", async () => {
    const root = await hub([
      {
        name: "engine",
        storage: "hub-owned",
        code_repo_path: "/code/engine",
        code_repo_url: "git@github.com:me/engine.git",
      },
    ]);
    await put(
      root,
      "projects/engine/notes/api.md",
      "---\ntype: note\ntags: [engine/api]\n---\n# Engine API\n",
    );
    const idx = await (async () => {
      await index({ dir: root });
      return readIndex(root);
    })();
    expect(idx).toContain("git@github.com:me/engine.git"); // code-repo decoration
  });

  it("does not decorate when there is no registry (registry-enriched, never -dependent)", async () => {
    const dir = await vault(); // in-repo: no hub metadata
    await note(
      dir,
      "api.md",
      "---\ntype: note\ntags: [engine/api]\n---\n# Engine API\n",
    );
    const r = await index({ dir });
    expect(r.wings).toEqual(["engine"]);
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).not.toContain("code repo:");
  });

  it("renders an in-repo member as a visible pointer, even with zero hub-owned notes", async () => {
    const root = await hub([
      {
        name: "web",
        storage: "in-repo",
        code_repo_path: "/code/web",
        code_repo_url: "git@github.com:me/web.git",
      },
    ]);
    const r = await index({ dir: root });
    expect(r.noteCount).toBe(0);
    const idx = await readIndex(root);
    expect(idx).toContain("Linked repositories");
    expect(idx).toContain("/code/web"); // pointer to where its notes live
    expect(idx).toContain("INDEX"); // → open its INDEX
  });

  it("is idempotent on a hub (re-run byte-identical; no self-ingestion)", async () => {
    const root = await hub([]);
    for (const w of ["a", "b", "c", "d", "e"]) {
      await put(
        root,
        `projects/p/notes/${w}.md`,
        `---\ntype: note\ntags: [${w}/r]\n---\n# ${w}\n`,
      );
    }
    await index({ dir: root });
    const first = await readIndex(root);
    const r = await index({ dir: root });
    const second = await readIndex(root);
    expect(second).toBe(first);
    expect(r.hierarchical).toBe(true); // 5 wings
  });

  it("flips hierarchical when one note carries >4 distinct tag-wings", async () => {
    const dir = await vault();
    await note(
      dir,
      "wide.md",
      "---\ntype: note\ntags: [a/1, b/2, c/3, d/4, e/5]\n---\n# Wide\n",
    );
    const r = await index({ dir });
    expect(r.wings.length).toBe(5);
    expect(r.hierarchical).toBe(true);
  });
});

describe("mage index — dedupe generated index payload (ADR-0039 §5)", () => {
  it("drops keywords redundant with title, path, or type badge", async () => {
    const dir = await vault();
    await note(
      dir,
      "foo/bar.md",
      "---\ntype: note\nkeywords: [foo, bar, note, the-foo-title]\n---\n# The Foo Title\n",
    );
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");

    expect(idx).toContain("- `note` [The Foo Title](notes/foo/bar.md)");
    expect(idx).toMatch(/- `note` \[The Foo Title\]\(notes\/foo\/bar\.md\)$/m);
  });

  it("survives novel keywords and multi-part keywords where only SOME parts appear", async () => {
    const dir = await vault();
    await note(
      dir,
      "test.md",
      "---\ntype: note\nkeywords: [stale-binary, the-novel]\n---\n# The Title\n",
    );
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");

    expect(idx).toContain(
      "- `note` [The Title](notes/test.md) — stale-binary, the-novel",
    );
  });

  it("drops each scaffolding stoplist word", async () => {
    const dir = await vault();
    await note(
      dir,
      "scaffold.md",
      `---\ntype: note\nkeywords: [${SCAFFOLDING_WORDS.join(", ")}]\n---\n# Scaffold\n`,
    );
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");

    expect(idx).toContain("- `note` [Scaffold](notes/scaffold.md)");
    expect(idx).toMatch(/- `note` \[Scaffold\]\(notes\/scaffold\.md\)$/m);
  });

  it("renders no lifecycle suffix for 'accepted' status or when no caution status applies", async () => {
    const dir = await vault();
    await note(
      dir,
      "a.md",
      "---\ntype: note\nstatus: accepted\nlastReviewed: 2026-07-01\n---\n# A\n",
    );
    await note(
      dir,
      "b.md",
      "---\ntype: note\nlastReviewed: 2026-07-02\n---\n# B\n",
    );
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");

    expect(idx).toContain("- `note` [A](notes/a.md)\n");
    expect(idx).toContain("- `note` [B](notes/b.md)\n");
    expect(idx).not.toContain("_()");
    expect(idx).not.toContain("accepted");
  });

  it("renders suffix for 'stale-suspect' and never renders reviewed date", async () => {
    const dir = await vault();
    await note(
      dir,
      "c.md",
      "---\ntype: note\nstatus: stale-suspect\nlastReviewed: 2026-07-03\n---\n# C\n",
    );
    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");

    expect(idx).toContain("- `note` [C](notes/c.md) _(stale-suspect)_");
    expect(idx).not.toContain("2026-07-03");
  });
});

describe("mage index — bounded roster MEMORY.md (ADR-0041 Amendment)", () => {
  const thresholdBytes = Math.floor(BREACH_RATIO * AUTO_MEMORY_MAX_BYTES);
  const thresholdLines = Math.floor(BREACH_RATIO * AUTO_MEMORY_MAX_LINES);

  /** Line count the way the renderer and `mage footprint` both count. */
  function countLines(content: string): number {
    const raw = content.split("\n").length;
    return content.endsWith("\n") ? raw - 1 : raw;
  }

  /** Write the co-located promote tally: note relPath → distinct chapters read. */
  async function tally(
    dir: string,
    notes: Record<string, number>,
  ): Promise<void> {
    await mkdir(join(dir, "mage", ".mage", "metrics"), { recursive: true });
    await writeFile(
      join(dir, "mage", ".mage", "metrics", "promote.json"),
      JSON.stringify({
        v: 4,
        notes: Object.fromEntries(
          Object.entries(notes).map(([rel, chapters]) => [rel, { chapters }]),
        ),
        sessions: {},
      }),
    );
  }

  async function generateKb(dir: string, count: number) {
    for (let i = 0; i < count; i++) {
      await note(
        dir,
        `note${i.toString().padStart(3, "0")}.md`,
        `---
type: note
status: stale-suspect
keywords: [kw${i}, ${"k".repeat(25)}]
---
# Note ${i} ${"t".repeat(120)}
`,
      );
    }
  }

  it("1. roster fits both thresholds by construction with a large synthetic KB (300 notes)", async () => {
    const dir = await vault();
    await generateKb(dir, 300);
    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(1);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    const bytes = Buffer.byteLength(mem, "utf8");
    expect(countLines(mem)).toBeLessThanOrEqual(180);
    expect(bytes).toBeLessThanOrEqual(23040);
    expect(mem).toContain("300 memory notes total");
    expect(mem).toContain("Read INDEX.md before non-trivial work.");
  });

  it("2. ranking: proven-flag ordering, recency ordering within tier, relPath tiebreak", async () => {
    const dir = await vault();
    // unproven, old date
    await note(dir, "b.md", "---\ntype: note\nlast_reviewed: '2026-01-01'\n---\n# B\n");
    // unproven, new date
    await note(dir, "c.md", "---\ntype: note\nlast_reviewed: '2026-07-29'\n---\n# C\n");
    // proven (5 chapters >= the normal-dial graduateSessions of 5), old date
    await note(dir, "a.md", "---\ntype: note\nlast_reviewed: '2026-01-01'\n---\n# A\n");
    await tally(dir, { "notes/a.md": 5 });

    await index({ dir, quiet: true });
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    const posA = mem.indexOf("[A](notes/a.md)");
    const posC = mem.indexOf("[C](notes/c.md)");
    const posB = mem.indexOf("[B](notes/b.md)");
    expect(posA).toBeGreaterThan(-1);
    expect(posC).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeLessThan(posC); // proven A beats unproven C despite being older
    expect(posC).toBeLessThan(posB); // newer C beats older B
  });

  it("2b. relPath ascending breaks a full tie (same proven bucket, same date)", async () => {
    const dir = await vault();
    // z + m tie on everything but relPath; y is newer and must sort above both, so the
    // tie is asserted around a moving neighbour rather than on an already-sorted list.
    await note(dir, "z-tie.md", "---\ntype: note\nlast_reviewed: '2026-02-02'\n---\n# Ztie\n");
    await note(dir, "m-tie.md", "---\ntype: note\nlast_reviewed: '2026-02-02'\n---\n# Mtie\n");
    await note(dir, "y-new.md", "---\ntype: note\nlast_reviewed: '2026-09-09'\n---\n# Ynew\n");

    await index({ dir, quiet: true });
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    const posY = mem.indexOf("[Ynew](notes/y-new.md)");
    const posM = mem.indexOf("[Mtie](notes/m-tie.md)");
    const posZ = mem.indexOf("[Ztie](notes/z-tie.md)");
    expect(posY).toBeGreaterThan(-1);
    expect(posY).toBeLessThan(posM); // recency still outranks the tied pair
    expect(posM).toBeLessThan(posZ); // notes/m-tie.md < notes/z-tie.md
  });

  it("2c. a proven note survives the cut that drops a newer unproven one", async () => {
    const dir = await vault();
    // 200 fillers dated 2026-06-01 overflow the 180-line budget on their own.
    for (let i = 0; i < 200; i++) {
      await note(
        dir,
        `f${i.toString().padStart(3, "0")}.md`,
        `---\ntype: note\nlast_reviewed: '2026-06-01'\n---\n# Filler ${i}\n`,
      );
    }
    // Oldest of all, so recency alone would rank it dead last — the tally lifts it.
    await note(dir, "proven.md", "---\ntype: note\nlast_reviewed: '2020-01-01'\n---\n# Proven\n");
    // Unproven and NEWER than the proven note, but still below every filler.
    await note(dir, "oldish.md", "---\ntype: note\nlast_reviewed: '2021-01-01'\n---\n# Oldish\n");
    await tally(dir, { "notes/proven.md": 5 });

    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(1);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem).toContain("[Proven](notes/proven.md)"); // proven, ranked first, kept
    expect(mem).not.toContain("[Oldish](notes/oldish.md)"); // newer but unproven, cut
    expect(mem).toContain("202 memory notes total");
    expect(countLines(mem)).toBeLessThanOrEqual(thresholdLines);
  });

  it("3. fail-open: no tally file -> recency order, no throw, byte-identical across runs", async () => {
    const dir = await vault();
    await note(dir, "old.md", "---\ntype: note\nlast_reviewed: '2026-01-01'\n---\n# Old\n");
    await note(dir, "new.md", "---\ntype: note\nlast_reviewed: '2026-07-29'\n---\n# New\n");

    const r1 = await index({ dir, quiet: true });
    const mem1 = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem1.indexOf("[New](notes/new.md)")).toBeLessThan(mem1.indexOf("[Old](notes/old.md)"));

    const r2 = await index({ dir, quiet: true });
    const mem2 = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem2).toBe(mem1);
    expect(r2.memoryTier).toBe(r1.memoryTier);
  });

  it("4. overflow line: always present; correct total and shown counts; points at INDEX.md", async () => {
    const dir = await vault();
    await note(dir, "n1.md", "---\ntype: note\n---\n# N1\n");
    await note(dir, "n2.md", "---\ntype: note\n---\n# N2\n");
    await index({ dir, quiet: true });
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem).toContain("> 2 memory notes total (2 shown). Read INDEX.md before non-trivial work.");
  });

  it("5. tier values: 0 when all fit, 1 when cut", async () => {
    const dir = await vault();
    await note(dir, "small.md", "---\ntype: note\n---\n# Small\n");
    const rSmall = await index({ dir, quiet: true });
    expect(rSmall.memoryTier).toBe(0);

    const dir2 = await vault();
    await generateKb(dir2, 200);
    const rLarge = await index({ dir: dir2, quiet: true });
    expect(rLarge.memoryTier).toBe(1);
  });

  it("a small KB renders at tier 0 — suffixes and keywords intact with overflow line", async () => {
    const dir = await vault();
    await generateKb(dir, 5);
    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(0);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem).toContain("_(stale-suspect)_");
    expect(mem).toContain(" — kw");
    expect(mem).toContain("> 5 memory notes total (5 shown). Read INDEX.md before non-trivial work.");
  });

  it("a KB over threshold cuts entries (tier 1) to fit line and byte budget", async () => {
    const dir = await vault();
    await generateKb(dir, 110);
    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(1);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem).toContain("_(stale-suspect)_");
    expect(mem).toContain(" — kw"); // entries that FIT keep their keyword tails
    expect(mem).toContain("110 memory notes total");
    expect(Buffer.byteLength(mem, "utf8")).toBeLessThanOrEqual(thresholdBytes);
    expect(countLines(mem)).toBeLessThanOrEqual(thresholdLines);
  });

  it("an oversized entry sheds its keyword tail instead of nuking the roster", async () => {
    const dir = await vault();
    // Ranked first (newest) AND far too wide to render in full: the prefix-cut fill this
    // replaced stopped dead here and shipped `(0 shown)` for the whole KB.
    await note(
      dir,
      "huge.md",
      `---
type: note
status: stale-suspect
last_reviewed: '2026-12-31'
keywords: [kw1, ${"k".repeat(30000)}]
---
# Huge Note
`,
    );
    await generateKb(dir, 20);
    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(1);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    const hugeLine = mem.split("\n").find((l) => l.includes("notes/huge.md"));
    expect(hugeLine).toBeDefined();
    expect(hugeLine).toContain("[Huge Note](notes/huge.md)"); // still listed
    expect(hugeLine).not.toContain("kkkk"); // its keyword tail is what got shed
    expect(hugeLine).toContain("_(stale-suspect)_"); // caution statuses never dropped
    expect(mem).toContain(" — kw"); // entries that FIT keep theirs
    expect(mem).toContain("[Note 0"); // the other 20 entries still fill the roster
    expect(mem).toContain("21 memory notes total (21 shown)");
    expect(Buffer.byteLength(mem, "utf8")).toBeLessThanOrEqual(thresholdBytes);
  });

  it("an entry too wide even bare is skipped, and lower-ranked entries still fill", async () => {
    const dir = await vault();
    // No keyword tail to shed — the title alone blows the byte budget, so the ladder's
    // last rung (skip) is the only one left.
    await note(
      dir,
      "monster.md",
      `---\ntype: note\nlast_reviewed: '2026-12-31'\n---\n# ${"M".repeat(30000)}\n`,
    );
    await generateKb(dir, 20);
    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(1);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem).not.toContain("notes/monster.md"); // skipped
    expect(mem).toContain("[Note 0"); // everything else still rendered
    expect(mem).toContain("21 memory notes total (20 shown)");
    expect(Buffer.byteLength(mem, "utf8")).toBeLessThanOrEqual(thresholdBytes);
  });

  it("tier 2: a budget too small for the structure alone falls back to the category map", () => {
    const entries: ScannedNote[] = [
      {
        relPath: "notes/a.md",
        wings: [{ wing: "w", room: "" }],
        wing: "w",
        room: "",
        title: "A",
        type: "note",
        keywords: [],
      },
    ];
    const reg = {
      decorationByWing: new Map<string, string>(),
      inRepoMembers: [],
    };
    // Four lines of header + the governance line + the overflow pointer cannot fit in
    // three lines — the pathological case the hierarchical fallback exists for.
    const { content, tier } = renderMemory(
      entries,
      ["w"],
      false,
      reg,
      false,
      3,
      undefined,
      5,
      { byteThreshold: 20, lineThreshold: 3 },
    );
    expect(tier).toBe(2);
    expect(content).toContain("## Wings");
    expect(content).toContain("Fallen back to category map");
    expect(content).toContain("_index.w.md");
  });

  it("tier 0/1 boundary is driven by the injected budget, not a hard-coded K", () => {
    const entries: ScannedNote[] = Array.from({ length: 5 }, (_, i) => ({
      relPath: `notes/n${i}.md`,
      wings: [{ wing: "w", room: "" }],
      wing: "w",
      room: "",
      title: `N${i}`,
      type: "note",
      keywords: [],
    }));
    const reg = {
      decorationByWing: new Map<string, string>(),
      inRepoMembers: [],
    };
    const render = (lineThreshold: number) =>
      renderMemory(entries, ["w"], false, reg, false, 0, undefined, 5, {
        byteThreshold: 23040,
        lineThreshold,
      });

    const roomy = render(180);
    expect(roomy.tier).toBe(0);
    expect(roomy.content).toContain("5 memory notes total (5 shown)");

    // Header(4) + separator(1) + overflow(1) = 6 reserved, so 8 lines admits 2 entries.
    const tight = render(8);
    expect(tight.tier).toBe(1);
    expect(tight.content).toContain("5 memory notes total (2 shown)");
    expect(countLines(tight.content)).toBeLessThanOrEqual(8);
  });

  it("a line-only breach cuts entries to fit 180-line budget", async () => {
    const dir = await vault();
    for (let i = 0; i < 190; i++) {
      await note(
        dir,
        `note${i}.md`,
        `---
type: note
---
# N${i}
`,
      );
    }
    const r = await index({ dir, quiet: true });
    expect(r.memoryTier).toBe(1);
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(countLines(mem)).toBeLessThanOrEqual(180);
    expect(mem).toContain("190 memory notes total");
    expect(mem).toContain("Read INDEX.md before non-trivial work.");
  });

  it("determinism: rendering the same fixture twice produces byte-identical output", async () => {
    const dir = await vault();
    await generateKb(dir, 130);
    await index({ dir, quiet: true });
    const first = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    await index({ dir, quiet: true });
    const second = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(second).toBe(first);
  });

  it("tier selection with empty metrics file", async () => {
    const dir = await vault();
    await generateKb(dir, 130);
    await index({ dir, quiet: true });
    const first = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");

    await mkdir(join(dir, "mage", ".mage", "metrics"), { recursive: true });
    await writeFile(
      join(dir, "mage", ".mage", "metrics", "promote.json"),
      JSON.stringify({ v: 4, sessions: {}, notes: {} }),
    );
    await index({ dir, quiet: true });
    const second = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(second).toBe(first);
  });

  it("INDEX.md is unaffected by tiering", async () => {
    const dir = await vault();
    await generateKb(dir, 130);
    await index({ dir, quiet: true });
    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(mem).not.toBe(idx);
    expect(idx).toContain("Note 0");
    expect(idx).toContain("_(stale-suspect)_");
  });
});

describe("mage index — recall surface filtering & metadata genre overrides (ADR-0041 Wave B)", () => {
  it("filters INDEX to memory-genre lines only and appends governance line (N=1)", async () => {
    const dir = await vault();
    await note(dir, "gotcha.md", "---\ntype: gotcha\n---\n# Gotcha Note\n");
    await note(dir, "proc.md", "---\ntype: procedure\n---\n# Procedure Note\n");
    await note(
      dir,
      "adr-accepted.md",
      "---\ntype: decision\nstatus: accepted\n---\n# Accepted Decision\n",
    );
    await note(
      dir,
      "adr-proposed.md",
      "---\ntype: decision\nstatus: proposed\n---\n# Proposed Decision\n",
    );
    await note(dir, "plan1.md", "---\ntype: plan\n---\n# Work Plan\n");
    await note(dir, "spec1.md", "---\ntype: spec\n---\n# System Spec\n");

    const r = await index({ dir });
    expect(r.noteCount).toBe(2);

    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("[Gotcha Note]");
    expect(idx).toContain("[Procedure Note]");
    expect(idx).not.toContain("[Accepted Decision]");
    expect(idx).not.toContain("[Proposed Decision]");
    expect(idx).not.toContain("[Work Plan]");
    expect(idx).not.toContain("[System Spec]");

    expect(idx).toContain(
      "> 1 accepted decision governs this repo — read `decisions/` before architectural or scope changes.",
    );

    const mem = await readFile(join(dir, "mage", "MEMORY.md"), "utf8");
    expect(mem).toContain(
      "> 1 accepted decision governs this repo — read `decisions/` before architectural or scope changes.",
    );
  });

  it("omits the governance line when N=0 accepted decisions exist", async () => {
    const dir = await vault();
    await note(dir, "gotcha.md", "---\ntype: gotcha\n---\n# Gotcha Note\n");
    await note(
      dir,
      "adr-proposed.md",
      "---\ntype: decision\nstatus: proposed\n---\n# Proposed Decision\n",
    );

    await index({ dir });
    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).not.toContain("govern this repo");
  });

  it("respects metadata.json genres overrides and validates them", async () => {
    const dir = await vault();
    const meta = {
      schema: "mage.v2",
      mode: "in-repo",
      project: "t",
      hub_path: null,
      hub_repo: null,
      hub_refs: [],
      linked_at: "2026-07-27T00:00:00Z",
      genres: {
        runbook: "memory",
        gotcha: "doc", // built-in attempt, ignored
        foo: "shiny", // invented genre, ignored
      },
    };
    await writeFile(
      join(dir, "mage", "metadata.json"),
      JSON.stringify(meta, null, 2),
    );

    await note(dir, "runbook.md", "---\ntype: runbook\n---\n# Runbook Note\n");
    await note(dir, "gotcha.md", "---\ntype: gotcha\n---\n# Gotcha Note\n");
    await note(dir, "foo.md", "---\ntype: foo\n---\n# Foo Note\n");

    const r = await index({ dir });
    expect(r.noteCount).toBe(2); // runbook (mapped to memory) + gotcha (built-in memory, remap ignored)

    const idx = await readFile(join(dir, "mage", "INDEX.md"), "utf8");
    expect(idx).toContain("[Runbook Note]");
    expect(idx).toContain("[Gotcha Note]");
    expect(idx).not.toContain("[Foo Note]");
  });

  // The governance line counts BOTH terminal "in force" spellings. `active` is the
  // spelling several external KBs use; counting only `accepted` under-reported them.
  it("governance line counts status accepted AND active, and excludes superseded/proposed", async () => {
    const dir = await vault();
    await note(dir, "gotcha.md", "---\ntype: gotcha\n---\n# Gotcha Note\n");
    await note(
      dir,
      "adr-accepted.md",
      "---\ntype: decision\nstatus: accepted\n---\n# Accepted Decision\n",
    );
    await note(
      dir,
      "adr-active.md",
      "---\ntype: decision\nstatus: active\n---\n# Active Decision\n",
    );

    await index({ dir });
    expect(await readIndex(join(dir, "mage"))).toContain(
      "> 2 accepted decisions govern this repo — read `decisions/` before architectural or scope changes.",
    );
  });

  it("governance line excludes superseded and proposed decisions", async () => {
    const dir = await vault();
    await note(dir, "gotcha.md", "---\ntype: gotcha\n---\n# Gotcha Note\n");
    await note(
      dir,
      "adr-superseded.md",
      "---\ntype: decision\nstatus: superseded\n---\n# Superseded Decision\n",
    );
    await note(
      dir,
      "adr-proposed.md",
      "---\ntype: decision\nstatus: proposed\n---\n# Proposed Decision\n",
    );

    await index({ dir });
    expect(await readIndex(join(dir, "mage"))).not.toContain("govern this repo");
  });

  // `mage skills` generates a skill per ALL-notes wing and points it at
  // `_index.<wing>.md`. Deriving the per-wing FILE set from memory wings alone
  // deleted that target for a document-only wing, leaving the skill dangling.
  it("keeps a per-wing index file for a document-only wing, with zero note lines", async () => {
    const dir = await vault();
    // Five memory wings force hierarchical mode (FLAT_MAX_WINGS = 4).
    for (const w of ["a", "b", "c", "d", "e"]) {
      await note(
        dir,
        `${w}.md`,
        `---\ntype: gotcha\ntags: [${w}/room]\n---\n# Memory ${w}\n`,
      );
    }
    await note(
      dir,
      "plan.md",
      "---\ntype: plan\ntags: [paperwork/room]\n---\n# Doc Only Plan\n",
    );

    const r = await index({ dir });
    expect(r.hierarchical).toBe(true);
    expect(r.wings).toEqual(["a", "b", "c", "d", "e"]); // recall surface: memory wings
    expect(r.written).toContain("_index.paperwork.md"); // file surface: all wings

    const wingIdx = await readFile(
      join(dir, "mage", "_index.paperwork.md"),
      "utf8",
    );
    expect(wingIdx).toContain("# paperwork");
    expect(wingIdx).toContain("> 0 notes. Part of the [index](INDEX.md).");
    expect(wingIdx).not.toContain("[Doc Only Plan]");
    expect(wingIdx).not.toMatch(/^- `/m); // zero note lines

    // A memory wing still lists its notes.
    expect(await readFile(join(dir, "mage", "_index.a.md"), "utf8")).toContain(
      "[Memory a]",
    );
    // The root recall surface does not advertise the document-only wing.
    expect(await readIndex(join(dir, "mage"))).not.toContain("**paperwork**");
  });
});
