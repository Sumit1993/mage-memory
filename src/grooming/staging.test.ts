import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_DIR, METRICS_DIR, STAGING_DIR } from "../paths.js";
import { describe, expect, it } from "vitest";
import type { ScannedNote } from "../scan.js";
import { parseNote } from "../note.js";
import { tmpDir } from "../../test/fixtures/kb.js";
import {
  type DraftSig,
  addStagedRejects,
  composeDraft,
  dedupDraft,
  discardDraft,
  draftKey,
  draftSig,
  promoteBatch,
  readStagedDrafts,
  readStagedRejects,
  slugify,
  stageDraft,
  stagedSlugs,
  uniqueSlug,
} from "./staging.js";

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

describe("stageDraft / readStagedDrafts", () => {
  it("round-trips a draft and is fail-open on a missing dir", async () => {
    const root = await tmpDir();
    const staging = join(root, STATE_DIR, STAGING_DIR);
    expect(await readStagedDrafts(staging)).toEqual([]); // missing dir → []

    const { frontmatter, body } = composeDraft({ title: "A Lesson", tags: ["mage/x"], body: "body text", created: "2026-06-15" });
    const { slug } = await stageDraft(staging, "a-lesson", frontmatter, body, new Set());
    expect(slug).toBe("a-lesson");

    const drafts = await readStagedDrafts(staging);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.slug).toBe("a-lesson");
    expect(drafts[0]?.title).toBe("A Lesson");
    expect(drafts[0]?.frontmatter.type).toBe("gotcha");
    expect(await stagedSlugs(staging)).toEqual(new Set(["a-lesson"]));
  });

  it("de-collides slugBase against the taken set before writing", async () => {
    const root = await tmpDir();
    const staging = join(root, STATE_DIR, STAGING_DIR);
    const { frontmatter, body } = composeDraft({ title: "Dup", body: "b" });
    const { slug } = await stageDraft(staging, "dup", frontmatter, body, new Set(["dup"]));
    expect(slug).toBe("dup-2");
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
    const root = await tmpDir();
    expect(await readStagedRejects(root)).toEqual(new Set()); // no file → empty

    await addStagedRejects(root, ["b::y", "a::x"]);
    await addStagedRejects(root, ["a::x"]); // dup is a no-op
    expect(await readStagedRejects(root)).toEqual(new Set(["a::x", "b::y"]));

    const raw = JSON.parse(await readFile(join(root, STATE_DIR, METRICS_DIR, "staged-rejects.json"), "utf8"));
    expect(raw).toEqual({ v: 1, keys: ["a::x", "b::y"] });
  });
  it("tolerates a corrupt ledger", async () => {
    const root = await tmpDir();
    await mkdir(join(root, STATE_DIR, METRICS_DIR), { recursive: true });
    await writeFile(join(root, STATE_DIR, METRICS_DIR, "staged-rejects.json"), "{ not json");
    expect(await readStagedRejects(root)).toEqual(new Set());
  });
});

// ─── promote / discard ─────────────────────────────────────────────────────────

describe("promoteBatch / discardDraft", () => {
  it("moves a draft into notes/, de-colliding the slug against committed notes", async () => {
    const root = await tmpDir();
    const staging = join(root, STATE_DIR, STAGING_DIR);
    const { frontmatter, body } = composeDraft({ title: "Lesson", tags: ["mage/x"], body: "b" });
    await stageDraft(staging, "lesson", frontmatter, body, new Set());
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "lesson.md"), "# pre-existing\n");

    const drafts = await readStagedDrafts(staging);
    const accepted = await promoteBatch(root, drafts);
    expect(accepted).toEqual(["notes/lesson-2.md"]); // de-collided vs the committed note
    expect(await readFile(join(root, "notes", "lesson-2.md"), "utf8")).toContain("# Lesson");
    expect(await readStagedDrafts(staging)).toEqual([]); // moved out of staging
  });
  it("stamps provenance and writes (not renames) when given a stamp (ADR-0031)", async () => {
    const root = await tmpDir();
    const staging = join(root, STATE_DIR, STAGING_DIR);
    const { frontmatter, body } = composeDraft({ title: "Stamped", tags: ["mage/x"], body: "b" });
    await stageDraft(staging, "stamped", frontmatter, body, new Set());

    const drafts = await readStagedDrafts(staging);
    const accepted = await promoteBatch(root, drafts, {
      autonomy: "overseer",
      repo: "mage-memory",
      commit: "abc1234",
    });
    expect(accepted).toEqual(["notes/stamped.md"]);

    const note = parseNote(await readFile(join(root, "notes", "stamped.md"), "utf8"));
    expect(note.frontmatter.provenance).toEqual({ repo: "mage-memory", commit: "abc1234", autonomy: "overseer" });
    expect(note.body).toContain("# Stamped"); // body preserved
    expect(await readStagedDrafts(staging)).toEqual([]); // staging file removed
  });
  it("de-collides two accepted drafts in one batch onto distinct slugs", async () => {
    const root = await tmpDir();
    const staging = join(root, STATE_DIR, STAGING_DIR);
    // Two drafts whose staging slugs differ but would both want `notes/lesson.md`
    // is impossible (staging slugs are unique); instead prove the batch seeds + grows
    // `taken` so a second draft colliding with a committed note still de-collides.
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "a.md"), "# pre\n");
    const d1 = composeDraft({ title: "A", body: "b" });
    const d2 = composeDraft({ title: "A two", body: "b" });
    await stageDraft(staging, "a", d1.frontmatter, d1.body, new Set());
    await stageDraft(staging, "a-2", d2.frontmatter, d2.body, new Set(["a"]));

    const accepted = await promoteBatch(root, await readStagedDrafts(staging));
    expect(new Set(accepted)).toEqual(new Set(["notes/a-2.md", "notes/a-3.md"]));
  });
  it("discardDraft removes the file (idempotent)", async () => {
    const root = await tmpDir();
    const staging = join(root, STATE_DIR, STAGING_DIR);
    const { frontmatter, body } = composeDraft({ title: "X", body: "b" });
    await stageDraft(staging, "x", frontmatter, body, new Set());
    const [d] = await readStagedDrafts(staging);
    await discardDraft(d!);
    await discardDraft(d!); // no throw on a second call
    expect(await readStagedDrafts(staging)).toEqual([]);
  });
});
