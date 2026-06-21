import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { triggerHash } from "./events.js";
import {
  isMageSkill,
  isUsableKeyword,
  KEYWORD_STOPLIST,
  normalizeSkillName,
  snapshotSkillMatch,
} from "./skill-match.js";

/** Write a generated wing SKILL.md (name + description only — no tags/keywords). */
async function putWingSkill(repo: string, name: string, description: string): Promise<void> {
  const dir = join(repo, ".claude", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

/**
 * Write a generated graduated (`mage-skill-*`) SKILL.md. Unlike a wing skill, its wing
 * lives in the frontmatter `wing:` (graduate.ts writes it there) — the name is the slug.
 */
async function putGraduatedSkill(
  repo: string,
  name: string,
  wing: string,
  description: string,
): Promise<void> {
  const dir = join(repo, ".claude", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nwing: ${wing}\n---\n\n# ${name}\n`,
  );
}

/** Seed a real wing note so keyword derivation has a non-boilerplate source. */
async function putWingNote(repo: string, wing: string): Promise<void> {
  const dir = join(repo, "mage", "notes");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "webhooks.md"),
    `---\ntype: gotcha\ntags: [${wing}/payments]\nkeywords: [webhook, idempotency, retry, stripe]\n---\n# Stripe webhooks\n`,
  );
}

/**
 * Seed a wing note whose frontmatter `keywords:` mix real domain terms with the
 * unusable tokens isUsableKeyword must drop — pure numerics ("0017", "2026"),
 * sub-3-char ("ad", "id"), and ADR/frontmatter boilerplate ("adr", "decision",
 * "status"). deriveKeywords passes frontmatter keywords through verbatim, so
 * these reach wingKeywords un-filtered; the fix is wingKeywords' own filter.
 */
async function putNoisyWingNote(
  repo: string,
  wing: string,
  keywords: readonly string[],
  slug = "noisy",
): Promise<void> {
  const dir = join(repo, "mage", "notes");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${slug}.md`),
    `---\ntype: gotcha\ntags: [${wing}/payments]\nkeywords: [${keywords.join(", ")}]\n---\n# Noisy note\n`,
  );
}

describe("isMageSkill / normalizeSkillName (recognition incl. mage: namespace)", () => {
  it("recognizes generated wing + graduated skill prefixes", () => {
    expect(isMageSkill("mage-wing-mage")).toBe(true);
    expect(isMageSkill("mage-skill-x")).toBe(true);
  });

  it("recognizes mage's own plugin skills under the mage: namespace", () => {
    expect(isMageSkill("mage:learn")).toBe(true);
    expect(isMageSkill("mage:guide")).toBe(true);
  });

  it("classifies a foreign skill as not mage", () => {
    expect(isMageSkill("continuous-learning-v2")).toBe(false);
    expect(isMageSkill("some-other-skill")).toBe(false);
  });

  it("strips the mage: namespace prefix when normalizing the skill id", () => {
    expect(normalizeSkillName("mage:learn")).toBe("learn");
    expect(normalizeSkillName("mage-wing-mage")).toBe("mage-wing-mage");
  });
});

describe("snapshotSkillMatch — wing/keywords sourced correctly (ADR-0016 §1)", () => {
  it("derives wing from the skill NAME (not frontmatter) and keywords from the wing's NOTES", async () => {
    const { dir: repo } = await withKb();
    await putWingNote(repo, "mage");
    await putWingSkill(repo, "mage-wing-mage", "Knowledge for the mage wing. Load when working on mage.");

    const snap = await snapshotSkillMatch(repo, "mage-wing-mage");
    expect(snap).not.toBeNull();
    // wing comes from the skill name, never the (empty) tags frontmatter.
    expect(snap?.match.wing).toBe("mage");
    // keywords come from the real wing notes — NOT boilerplate scaffold words.
    expect(snap?.match.keywords).toContain("webhook");
    expect(snap?.match.keywords).not.toContain("playbooks");
    // paths reserved empty in 0.0.5.
    expect(snap?.match.paths).toEqual([]);
    // trigger_hash is a stable hash of the description.
    expect(snap?.trigger_hash).toBe(
      triggerHash("Knowledge for the mage wing. Load when working on mage."),
    );
  });

  it("returns null when the SKILL.md is missing (caller records skill-only)", async () => {
    const repo = await tmpDir();
    expect(await snapshotSkillMatch(repo, "mage-wing-ghost")).toBeNull();
  });

  it("sanitizes a malicious skill name so it cannot escape the skills dir", async () => {
    const repo = await tmpDir();
    // A traversal in the name must not resolve to a file outside skills/.
    expect(await snapshotSkillMatch(repo, "mage-wing-../../../etc")).toBeNull();
  });

  it("still derives a wing for a wing skill even when the wing has no notes (empty keywords, non-empty wing)", async () => {
    const { dir: repo } = await withKb();
    await putWingSkill(repo, "mage-wing-lonely", "A wing with no notes yet.");
    const snap = await snapshotSkillMatch(repo, "mage-wing-lonely");
    expect(snap?.match.wing).toBe("lonely");
    expect(snap?.match.keywords).toEqual([]);
  });
});

describe("snapshotSkillMatch — graduated mage-skill-* gap (ADR-0016 §3, 0.0.8)", () => {
  it("reads the wing from a graduated skill's frontmatter and aggregates the wing's keywords", async () => {
    const { dir: repo } = await withKb();
    // The wing's notes live under `bar`; the graduated skill is named by its slug, with
    // `wing: bar` in frontmatter (the field graduate.ts writes).
    await putWingNote(repo, "bar");
    await putGraduatedSkill(repo, "mage-skill-foo", "bar", "Foo procedure. Load when foo-ing.");

    const snap = await snapshotSkillMatch(repo, "mage-skill-foo");
    expect(snap).not.toBeNull();
    // wing comes from the SKILL.md frontmatter, NOT the name (the name is the slug).
    expect(snap?.match.wing).toBe("bar");
    // keywords are aggregated from the wing's real notes, exactly like a wing skill.
    expect(snap?.match.keywords).toContain("webhook");
    expect(snap?.match.paths).toEqual([]);
    expect(snap?.trigger_hash).toBe(triggerHash("Foo procedure. Load when foo-ing."));
  });

  it("returns null for a graduated skill whose frontmatter has no wing (no notes mapping)", async () => {
    const { dir: repo } = await withKb();
    const dir = join(repo, ".claude", "skills", "mage-skill-nowing");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: mage-skill-nowing\ndescription: no wing field\n---\n\n# x\n",
    );
    expect(await snapshotSkillMatch(repo, "mage-skill-nowing")).toBeNull();
  });

  it("returns null for a graduated skill whose SKILL.md is missing", async () => {
    const repo = await tmpDir();
    expect(await snapshotSkillMatch(repo, "mage-skill-ghost")).toBeNull();
  });
});

describe("isUsableKeyword (ADR-0017 §8 keyword fix)", () => {
  it("rejects pure-numeric tokens (ADR numbers, years)", () => {
    expect(isUsableKeyword("0017")).toBe(false);
    expect(isUsableKeyword("2026")).toBe(false);
    expect(isUsableKeyword("42")).toBe(false);
  });

  it("rejects sub-3-char tokens", () => {
    expect(isUsableKeyword("ad")).toBe(false);
    expect(isUsableKeyword("id")).toBe(false);
    expect(isUsableKeyword("a")).toBe(false);
    expect(isUsableKeyword("")).toBe(false);
  });

  it("rejects ADR/frontmatter boilerplate in the stoplist", () => {
    expect(isUsableKeyword("adr")).toBe(false);
    expect(isUsableKeyword("decision")).toBe(false);
    expect(isUsableKeyword("decisions")).toBe(false);
    expect(isUsableKeyword("status")).toBe(false);
    expect(isUsableKeyword("consequences")).toBe(false);
    expect(isUsableKeyword("provenance")).toBe(false);
    expect(isUsableKeyword("note")).toBe(false);
    expect(isUsableKeyword("tags")).toBe(false);
  });

  it("keeps real domain terms", () => {
    expect(isUsableKeyword("redaction")).toBe(true);
    expect(isUsableKeyword("observe")).toBe(true);
    expect(isUsableKeyword("rollup")).toBe(true);
    expect(isUsableKeyword("webhook")).toBe(true);
    // A 3-char domain term survives the length floor (floor is < 3).
    expect(isUsableKeyword("api")).toBe(true);
  });

  it("exposes the stoplist as a Set the predicate consults", () => {
    expect(KEYWORD_STOPLIST.has("adr")).toBe(true);
    expect(KEYWORD_STOPLIST.has("redaction")).toBe(false);
  });
});

describe("wingKeywords filtering (via snapshotSkillMatch)", () => {
  it("drops numerics + boilerplate from a wing's notes, keeps real domain terms", async () => {
    const { dir: repo } = await withKb();
    await putNoisyWingNote(repo, "mage", [
      "0017",
      "2026",
      "ad",
      "id",
      "adr",
      "decision",
      "status",
      "provenance",
      "redaction",
      "observe",
      "rollup",
    ]);
    await putWingSkill(repo, "mage-wing-mage", "Knowledge for the mage wing.");

    const snap = await snapshotSkillMatch(repo, "mage-wing-mage");
    expect(snap).not.toBeNull();
    const kws = snap?.match.keywords ?? [];
    // Real domain terms survive.
    expect(kws).toContain("redaction");
    expect(kws).toContain("observe");
    expect(kws).toContain("rollup");
    // Pure numerics dropped.
    expect(kws).not.toContain("0017");
    expect(kws).not.toContain("2026");
    // Sub-3-char dropped.
    expect(kws).not.toContain("ad");
    expect(kws).not.toContain("id");
    // ADR/frontmatter boilerplate dropped.
    expect(kws).not.toContain("adr");
    expect(kws).not.toContain("decision");
    expect(kws).not.toContain("status");
    expect(kws).not.toContain("provenance");
  });

  it("honors the MAX_KEYWORDS cap after filtering (only usable terms count toward the cap)", async () => {
    const { dir: repo } = await withKb();
    // Spread > MAX_KEYWORDS (12) usable terms across several notes so the wing's
    // aggregate exceeds the cap (deriveKeywords already caps each NOTE at 12, so
    // a single note can't exercise wingKeywords' own MAX_KEYWORDS cap). Each note
    // also carries junk that the filter must drop BEFORE the cap counts a slot.
    const makeUsable = (prefix: string, n: number): string[] =>
      Array.from({ length: n }, (_, i) => `${prefix}term${i}x`);
    await putNoisyWingNote(
      repo,
      "mage",
      ["0017", "adr", "status", ...makeUsable("a", 8)],
      "noisy-a",
    );
    await putNoisyWingNote(
      repo,
      "mage",
      ["2026", "decision", "id", ...makeUsable("b", 8)],
      "noisy-b",
    );
    await putWingSkill(repo, "mage-wing-mage", "Knowledge for the mage wing.");

    const snap = await snapshotSkillMatch(repo, "mage-wing-mage");
    const kws = snap?.match.keywords ?? [];
    // 16 usable terms aggregate across two notes; the wingKeywords cap clamps to 12.
    expect(kws.length).toBe(12);
    // Every surviving keyword is usable (no junk slipped in or consumed a slot).
    for (const k of kws) {
      expect(isUsableKeyword(k)).toBe(true);
    }
  });
});
