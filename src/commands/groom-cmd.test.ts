import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exists, stagingPath } from "../paths.js";
import { parseNote } from "../note.js";
import { withKb } from "../../test/fixtures/kb.js";
import { groomCmd } from "./groom-cmd.js";
import { stageCmd } from "./stage-cmd.js";

async function makeKb(): Promise<string> {
  const { dir } = await withKb();
  return dir;
}

const stagingFile = (dir: string, slug: string) => join(dir, "mage", ".staging", `${slug}.md`);
const stagingFile2 = (dir: string, slug: string) => join(stagingPath(join(dir, "mage")), `${slug}.md`);
const noteFile = (dir: string, slug: string) => join(dir, "mage", "notes", `${slug}.md`);

/** Stage N distinct drafts; returns their slugs in stage order. */
async function stageDistinct(dir: string, n: number): Promise<string[]> {
  const seeds = [
    { title: "Alpha redaction rule", tags: "mage/redact", body: "alpha lesson about scrubbing" },
    { title: "Beta release dance", tags: "mage/release", body: "beta lesson about the cut" },
    { title: "Gamma index walk", tags: "mage/index", body: "gamma lesson about scanning" },
    { title: "Delta hook wiring", tags: "mage/connect", body: "delta lesson about hooks" },
    { title: "Epsilon dream applier", tags: "mage/dream", body: "epsilon lesson about applying" },
  ];
  const slugs: string[] = [];
  for (const s of seeds.slice(0, n)) {
    const r = await stageCmd({ dir, ...s });
    expect(r.staged).toBe(true);
    slugs.push(r.slug!);
  }
  return slugs;
}

describe("mage groom — surface", () => {
  it("lists the pending batch and caps it at the budget (no silent truncation)", async () => {
    const dir = await makeKb();
    await stageDistinct(dir, 4);
    const r = await groomCmd({ dir });
    expect(r.pending).toBe(4);
    expect(r.drafts).toHaveLength(3); // stagingBudget = 3
    expect(r.drafts?.every((d) => d.type === "gotcha")).toBe(true);
  });

  it("reports an empty batch", async () => {
    const dir = await makeKb();
    const r = await groomCmd({ dir });
    expect(r).toEqual({ drafts: [], pending: 0 });
  });

  it("drops a staged draft that a committed note now covers (stale → not surfaced)", async () => {
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1); // "Alpha redaction rule" → wing mage
    expect((await groomCmd({ dir })).pending).toBe(1);

    // A note covering the lesson lands in notes/ (e.g. another session committed it).
    // The draft's keywords derive from its title + tags → [alpha, redaction, rule,
    // mage, redact]; the note must share >= 3 of them to clear the lesson bar.
    await mkdir(join(dir, "mage", "notes"), { recursive: true });
    await writeFile(
      join(dir, "mage", "notes", "covers.md"),
      "---\ntype: gotcha\ntags: [mage/redact]\nkeywords: [alpha, redaction, rule, mage]\n---\n# Alpha redaction\n",
    );
    const r = await groomCmd({ dir });
    expect(r.pending).toBe(0); // the now-covered draft is filtered from the surface
    expect(r.drafts).toHaveLength(0);
    expect(slug).toBe("alpha-redaction-rule");
  });
});

describe("mage groom — accept", () => {
  it("promotes a named draft to notes/, re-indexes, and clears it from staging", async () => {
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1);
    const r = await groomCmd({ dir, accept: slug });
    expect(r.accepted).toEqual([`notes/${slug}.md`]);
    expect(await exists(noteFile(dir, slug!))).toBe(true);
    expect(await exists(stagingFile(dir, slug!))).toBe(false);
    // re-index ran → INDEX.md exists and lists the promoted note.
    expect(await readFile(join(dir, "mage", "INDEX.md"), "utf8")).toContain("Alpha redaction rule");
  });

  it("accepts the whole batch with 'all'", async () => {
    const dir = await makeKb();
    const slugs = await stageDistinct(dir, 2);
    const r = await groomCmd({ dir, accept: "all" });
    expect(r.accepted).toHaveLength(2);
    for (const s of slugs) expect(await exists(noteFile(dir, s))).toBe(true);
  });
});

describe("mage groom — reject", () => {
  it("discards a draft, records its key, and never re-drafts it", async () => {
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1);
    const r = await groomCmd({ dir, reject: slug });
    expect(r.rejected).toEqual([slug]);
    expect(await exists(stagingFile(dir, slug!))).toBe(false);

    // Re-staging the same lesson is now suppressed by the reject ledger.
    const again = await stageCmd({ dir, title: "Alpha redaction rule", tags: "mage/redact", body: "alpha lesson about scrubbing" });
    expect(again.staged).toBe(false);
    expect(again.reason).toBe("rejected");
  });
});

describe("mage groom — inbox ingest (ADR-0032)", () => {
  // A Gate-0 capture sitting flat at the docs-root top (CC-renormalized frontmatter,
  // already-scrubbed-and-shaped body).
  function gate0Capture(body: string, session = "sess-x"): string {
    return `---\nname: ""\nmetadata:\n  node_type: memory\n  type: note\n  created: 2026-06-27\n  originSessionId: ${session}\n---\n\n${body}\n`;
  }

  it("ingests an inbox capture into staging and surfaces it", async () => {
    const dir = await makeKb();
    const root = join(dir, "mage");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "ssh-timeout-fix.md"), gate0Capture("# SSH timeout fix\n\nbump ServerAliveInterval to 30."));

    const r = await groomCmd({ dir });
    expect(r.ingested).toEqual(["ssh-timeout-fix"]);
    expect(r.pending).toBe(1);
    expect(r.drafts?.[0]?.slug).toBe("ssh-timeout-fix");
    // Moved: gone from the root inbox, now a staged draft.
    expect(await exists(join(root, "ssh-timeout-fix.md"))).toBe(false);
    expect(await exists(stagingFile2(dir, "ssh-timeout-fix"))).toBe(true);
  });

  it("promotes an ingested capture to notes/ on --accept all (provenance stamped)", async () => {
    const dir = await makeKb();
    const root = join(dir, "mage");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "ssh-timeout-fix.md"), gate0Capture("# SSH timeout fix\n\nbump ServerAliveInterval to 30."));

    await groomCmd({ dir }); // ingest + surface
    const r = await groomCmd({ dir, accept: "all" });
    expect(r.accepted).toEqual(["notes/ssh-timeout-fix.md"]);
    const note = await readFile(noteFile(dir, "ssh-timeout-fix"), "utf8");
    expect(note).toContain("# SSH timeout fix");
    expect(note).toContain("cc-session:sess-x"); // session pointer survives to the note
    const { frontmatter } = parseNote(note);
    expect(frontmatter.provenance).toBeDefined(); // stamped at the promote chokepoint (ADR-0031)
  });

  it("--accept all --json emits a clean single JSON line (no index logging leak)", async () => {
    // F6: index()'s 'Indexed N note(s)...' success/detail must not corrupt the --json
    // stdout contract. acceptBatch passes quiet:true to index() in json mode.
    const dir = await makeKb();
    const root = join(dir, "mage");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "x-capture.md"), gate0Capture("# X capture\n\na distinct body."));
    await groomCmd({ dir }); // ingest x-capture into staging

    const logs: string[] = [];
    const out: string[] = [];
    const clog = vi.spyOn(console, "log").mockImplementation((m?: unknown) => void logs.push(String(m)));
    const swrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((m: unknown) => (out.push(String(m)), true) as never);
    try {
      await groomCmd({ dir, accept: "all", json: true });
    } finally {
      clog.mockRestore();
      swrite.mockRestore();
    }
    expect(logs).toHaveLength(0); // nothing leaked to console.log (index/accept human lines)
    const parsed = JSON.parse(out.join("").trim());
    expect(parsed.accepted).toContain("notes/x-capture.md");
  });
});

describe("mage groom — guards", () => {
  it("refuses --accept and --reject together", async () => {
    const dir = await makeKb();
    await expect(groomCmd({ dir, accept: "a", reject: "b" })).rejects.toThrow(/one of/);
  });
  it("errors on an unknown slug", async () => {
    const dir = await makeKb();
    await stageDistinct(dir, 1);
    await expect(groomCmd({ dir, accept: "nope" })).rejects.toThrow(/no staged draft/);
  });
});
