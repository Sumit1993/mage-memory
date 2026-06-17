import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScannedNote } from "../scan.js";
import {
  type DraftSig,
  addStagedRejects,
  composeDraft,
  dedupDraft,
  discardDraft,
  draftKey,
  draftSig,
  existingNoteSlugs,
  promoteDraft,
  readStagedDrafts,
  readStagedRejects,
  slugify,
  stagedSlugs,
  uniqueSlug,
  writeDraft,
} from "./staging.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mage-stg-"));
  made.push(dir);
  return dir;
}

/** A minimal ScannedNote for dedup tests. */
function note(partial: Partial<ScannedNote> & { wing: string; keywords: string[] }): ScannedNote {
  return {
    relPath: partial.relPath ?? "notes/x.md",
    wings: partial.wings ?? [{ wing: partial.wing, room: "" }],
    wing: partial.wing,
    room: "",
    title: partial.title ?? "X",
    type: partial.type ?? "gotcha",
    keywords: partial.keywords,
    status: partial.status,
    lastReviewed: partial.lastReviewed,
  };
}

// ─── slug + key ────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("kebabs a title and bounds it", () => {
    expect(slugify("Connect doesn't ensure ignores!")).toBe("connect-doesn-t-ensure-ignores");
  });
  it("never yields empty or a traversal token", () => {
    expect(slugify("")).toBe("lesson");
    expect(slugify("...")).toBe("lesson");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a/b\\c")).toBe("a-b-c");
  });
});

describe("uniqueSlug", () => {
  it("returns base when free, else suffixes -2, -3", () => {
    expect(uniqueSlug("x", new Set())).toBe("x");
    expect(uniqueSlug("x", new Set(["x"]))).toBe("x-2");
    expect(uniqueSlug("x", new Set(["x", "x-2"]))).toBe("x-3");
  });
});

describe("draftSig / draftKey", () => {
  it("derives wing from the first tag and a stable, order-independent key", () => {
    const fm = { type: "gotcha", tags: ["mage/release"] };
    const sig = draftSig(fm, "# Bump touches many files\n\nthe release bump misses the badge", "bump");
    expect(sig.wing).toBe("mage");
    expect(sig.keywords.length).toBeGreaterThan(0);
    // same content → identical key regardless of keyword insertion order.
    const a = draftKey(sig);
    const b = draftKey({ wing: "MAGE", keywords: [...sig.keywords].reverse() });
    expect(a).toBe(b);
  });
  it("cross-cutting (untagged) draft has an empty wing", () => {
    expect(draftSig({ type: "gotcha" }, "# A lesson\n\nbody here", "a").wing).toBe("");
  });
});

// ─── compose ─────────────────────────────────────────────────────────────────

describe("composeDraft", () => {
  it("defaults type to gotcha, merges --wing into tags, ensures an H1", () => {
    const { frontmatter, body } = composeDraft({
      title: "Do not commit secrets",
      wing: "security",
      body: "always scrub before staging",
      created: "2026-06-15",
    });
    expect(frontmatter.type).toBe("gotcha");
    expect(frontmatter.tags).toEqual(["security"]);
    expect(frontmatter.created).toBe("2026-06-15");
    expect(body.startsWith("# Do not commit secrets\n")).toBe(true);
    expect(body.endsWith("\n")).toBe(true);
  });
  it("keeps an existing H1 and does not double it; --wing not duplicated when tag homes there", () => {
    const { frontmatter, body } = composeDraft({
      title: "ignored",
      tags: ["mage/release"],
      wing: "mage",
      body: "# Real Title\n\nbody",
    });
    expect(frontmatter.tags).toEqual(["mage/release"]); // wing already present → not prepended
    expect(body.startsWith("# Real Title")).toBe(true);
    expect(body).not.toContain("# ignored");
  });
});

// ─── stage write + read round-trip ─────────────────────────────────────────────

describe("writeDraft / readStagedDrafts", () => {
  it("round-trips a draft and is fail-open on a missing dir", async () => {
    const root = await tmp();
    const staging = join(root, ".staging");
    expect(await readStagedDrafts(staging)).toEqual([]); // missing dir → []

    const { frontmatter, body } = composeDraft({ title: "A Lesson", tags: ["mage/x"], body: "body text", created: "2026-06-15" });
    await writeDraft(staging, "a-lesson", frontmatter, body);

    const drafts = await readStagedDrafts(staging);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.slug).toBe("a-lesson");
    expect(drafts[0]?.title).toBe("A Lesson");
    expect(drafts[0]?.frontmatter.type).toBe("gotcha");
    expect(await stagedSlugs(staging)).toEqual(new Set(["a-lesson"]));
  });
});

// ─── dedup ─────────────────────────────────────────────────────────────────────

describe("dedupDraft", () => {
  const sig: DraftSig = { wing: "mage", keywords: ["release", "badge"] };
  const key = draftKey(sig);

  it("stages a fresh draft", () => {
    expect(dedupDraft(sig, key, [], [], new Set())).toEqual({ staged: true });
  });
  it("skips when a committed note covers it (>= half the draft keywords, floor 2)", () => {
    // sig has 2 keywords → need 2 shared. A note sharing both [release, badge] covers it…
    const covers = [note({ wing: "mage", keywords: ["release", "badge", "version"] })];
    expect(dedupDraft(sig, key, covers, [], new Set())).toMatchObject({ staged: false, reason: "covered" });
    // …but a single shared common token does NOT (the single-wing over-suppression fix).
    const weak = [note({ wing: "mage", keywords: ["release", "version"] })];
    expect(dedupDraft(sig, key, weak, [], new Set())).toEqual({ staged: true });
  });
  it("skips a previously-rejected key", () => {
    expect(dedupDraft(sig, key, [], [], new Set([key]))).toEqual({ staged: false, reason: "rejected" });
  });
  it("skips a duplicate already in the staged batch", () => {
    const staged = [
      { slug: "dup", path: "/x", title: "t", frontmatter: {}, body: "", sig, key },
    ];
    expect(dedupDraft(sig, key, [], staged, new Set())).toMatchObject({ staged: false, reason: "duplicate", by: "dup" });
  });

  it("a keyword-less draft is never 'covered' (degenerate → always stages)", () => {
    const bare: DraftSig = { wing: "mage", keywords: [] };
    const notes = [note({ wing: "mage", keywords: ["anything", "here"] })];
    expect(dedupDraft(bare, draftKey(bare), notes, [], new Set())).toEqual({ staged: true });
  });
});

// ─── reject ledger ───────────────────────────────────────────────────────────

describe("reject ledger", () => {
  it("reads fail-open and persists deduped, sorted keys", async () => {
    const root = await tmp();
    expect(await readStagedRejects(root)).toEqual(new Set()); // no file → empty

    await addStagedRejects(root, ["b::y", "a::x"]);
    await addStagedRejects(root, ["a::x"]); // dup is a no-op
    expect(await readStagedRejects(root)).toEqual(new Set(["a::x", "b::y"]));

    const raw = JSON.parse(await readFile(join(root, ".metrics", "staged-rejects.json"), "utf8"));
    expect(raw).toEqual({ v: 1, keys: ["a::x", "b::y"] });
  });
  it("tolerates a corrupt ledger", async () => {
    const root = await tmp();
    await mkdir(join(root, ".metrics"), { recursive: true });
    await writeFile(join(root, ".metrics", "staged-rejects.json"), "{ not json");
    expect(await readStagedRejects(root)).toEqual(new Set());
  });
});

// ─── promote / discard ─────────────────────────────────────────────────────────

describe("promoteDraft / discardDraft", () => {
  it("moves a draft into notes/, de-colliding the slug", async () => {
    const root = await tmp();
    const staging = join(root, ".staging");
    const { frontmatter, body } = composeDraft({ title: "Lesson", tags: ["mage/x"], body: "b" });
    await writeDraft(staging, "lesson", frontmatter, body);
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "lesson.md"), "# pre-existing\n");

    const drafts = await readStagedDrafts(staging);
    const taken = await existingNoteSlugs(root);
    const rel = await promoteDraft(root, drafts[0]!, taken);
    expect(rel).toBe("notes/lesson-2.md"); // de-collided
    expect(await readFile(join(root, "notes", "lesson-2.md"), "utf8")).toContain("# Lesson");
    expect(await readStagedDrafts(staging)).toEqual([]); // moved out of staging
  });
  it("discardDraft removes the file (idempotent)", async () => {
    const root = await tmp();
    const staging = join(root, ".staging");
    const { frontmatter, body } = composeDraft({ title: "X", body: "b" });
    await writeDraft(staging, "x", frontmatter, body);
    const [d] = await readStagedDrafts(staging);
    await discardDraft(d!);
    await discardDraft(d!); // no throw on a second call
    expect(await readStagedDrafts(staging)).toEqual([]);
  });
});
