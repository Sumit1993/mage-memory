import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  globToRegExp,
  matchesRedactGlob,
  parseRedactIgnoreFile,
  readRedactIgnoreFile,
  redactIgnoreFromMetadata,
} from "./redactignore.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mage-rign-"));
  made.push(d);
  return d;
}

describe("parseRedactIgnoreFile", () => {
  it("splits globs into ignore[] from literal: lines into allow[], dropping comments + blanks", () => {
    const { ignore, allow } = parseRedactIgnoreFile(
      ["# a comment", "", "  notes/generated/**  ", "literal:AKIAFAKE123", "*.fixture.md", "   "].join(
        "\n",
      ),
    );
    expect(ignore).toEqual(["notes/generated/**", "*.fixture.md"]);
    expect(allow).toEqual(["AKIAFAKE123"]);
  });

  it("trims a literal value and drops an empty one", () => {
    const { allow } = parseRedactIgnoreFile(["literal:  sk-ant-foo  ", "literal:"].join("\n"));
    expect(allow).toEqual(["sk-ant-foo"]);
  });

  it("tolerates CRLF line endings", () => {
    const { ignore, allow } = parseRedactIgnoreFile("notes/x.md\r\nliteral:abc\r\n");
    expect(ignore).toEqual(["notes/x.md"]);
    expect(allow).toEqual(["abc"]);
  });
});

describe("redactIgnoreFromMetadata", () => {
  it("compiles ignore globs and collects allow literals", () => {
    const { globs, literals } = redactIgnoreFromMetadata({
      ignore: ["  notes/generated/**  ", "", "*.fixture.md"],
      allow: ["  AKIAFAKE123  ", ""],
    });
    expect(globs).toHaveLength(2); // the two non-blank globs
    expect(literals).toEqual(new Set(["AKIAFAKE123"]));
  });

  it("fail-open: absent/empty config compiles to an empty allowlist", () => {
    expect(redactIgnoreFromMetadata()).toEqual({ globs: [], literals: new Set() });
    expect(redactIgnoreFromMetadata({})).toEqual({ globs: [], literals: new Set() });
  });

  it("returns a FRESH empty each time (mutating one result never poisons the next)", () => {
    const first = redactIgnoreFromMetadata();
    first.literals.add("leaked");
    first.globs.push(/x/);
    const second = redactIgnoreFromMetadata();
    expect(second.literals).toEqual(new Set());
    expect(second.globs).toEqual([]);
  });
});

describe("globToRegExp", () => {
  it("matches '*' within a single path segment only", () => {
    const re = globToRegExp("notes/*.md");
    expect(re.test("notes/a.md")).toBe(true);
    expect(re.test("notes/sub/a.md")).toBe(false); // '*' does not cross '/'
  });

  it("matches '**' across path segments", () => {
    const re = globToRegExp("notes/generated/**");
    expect(re.test("notes/generated/a.md")).toBe(true);
    expect(re.test("notes/generated/deep/b.md")).toBe(true);
    expect(re.test("notes/other/a.md")).toBe(false);
  });

  it("compiles a bare '**' to match-all (an intentionally very permissive allowlist)", () => {
    // Documents the danger: a lone ** in the allowlist disables the gate for every
    // file. Kept as a deliberate (rare) escape hatch, not an accident.
    const re = globToRegExp("**");
    expect(re.test("a.md")).toBe(true);
    expect(re.test("deep/nested/a.md")).toBe(true);
  });

  it("treats a trailing '/' as a directory prefix (dir + everything under it)", () => {
    const re = globToRegExp("fixtures/");
    expect(re.test("fixtures")).toBe(true);
    expect(re.test("fixtures/a.md")).toBe(true);
    expect(re.test("fixtures/deep/b.md")).toBe(true);
    expect(re.test("other/fixtures")).toBe(false); // anchored at the start
  });

  it("matches '?' as exactly one non-slash char", () => {
    const re = globToRegExp("v?.md");
    expect(re.test("v1.md")).toBe(true);
    expect(re.test("v12.md")).toBe(false);
  });

  it("escapes regex metacharacters in literal segments (no accidental wildcards)", () => {
    const re = globToRegExp("a.b+c.md");
    expect(re.test("a.b+c.md")).toBe(true);
    expect(re.test("aXbXc.md")).toBe(false); // the '.' is literal, not 'any char'
  });

  it("is anchored — a glob does not match a superstring path", () => {
    const re = globToRegExp("notes/a.md");
    expect(re.test("notes/a.md")).toBe(true);
    expect(re.test("deep/notes/a.md")).toBe(false);
    expect(re.test("notes/a.md.bak")).toBe(false);
  });

  it("stays linear on adversarial wildcard-heavy globs (no catastrophic backtracking)", () => {
    // Latent ReDoS from #26: a naive `*`→`[^/]*` emission lets `('a*'×12)+'!'` =>
    // `a[^/]*a[^/]*…!` backtrack for ~60s against a long non-matching input — and the
    // compile is reachable from the live pre-commit hook (matchesRedactGlob). The
    // adjacency-collapse + atomic-run shape must keep `.test()` in a small budget.
    const long = "a".repeat(40);
    const deep = `notes/${"a/".repeat(40)}nope.md`;
    const budgetMs = 50;

    for (const [glob, input, expected] of [
      ["a*".repeat(12) + "!", long, false],
      ["notes/" + "**/".repeat(8) + "x.md", deep, false],
    ] as const) {
      const re = globToRegExp(glob);
      const start = process.hrtime.bigint();
      const matched = re.test(input);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      expect(matched).toBe(expected);
      expect(elapsedMs).toBeLessThan(budgetMs);
    }

    // Legitimate (real-world) matches/non-matches are unchanged by the hardening:
    // a `*` run followed by a literal suffix, and a `**` run spanning segments.
    expect(globToRegExp("notes/*.md").test("notes/draft.md")).toBe(true);
    expect(globToRegExp("notes/*.md").test("notes/sub/draft.md")).toBe(false);
    expect(globToRegExp("notes/generated/**").test("notes/generated/deep/dump.md")).toBe(true);
    expect(globToRegExp("notes/generated/**").test("notes/real.md")).toBe(false);
  });
});

describe("matchesRedactGlob", () => {
  it("is true iff any compiled glob matches", () => {
    const ignore = redactIgnoreFromMetadata({ ignore: ["notes/generated/**"], allow: ["x"] });
    expect(matchesRedactGlob("notes/generated/dump.md", ignore)).toBe(true);
    expect(matchesRedactGlob("notes/real.md", ignore)).toBe(false);
  });
});

describe("readRedactIgnoreFile — fail-open (mage migrate fold)", () => {
  it("returns null when the legacy file is absent", async () => {
    const dir = await tmp();
    expect(await readRedactIgnoreFile(dir)).toBeNull();
  });

  it("reads and parses a present legacy file into a RedactConfig", async () => {
    const dir = await tmp();
    await writeFile(join(dir, ".redactignore"), "notes/x.md\nliteral:secret-foo\n");
    const config = await readRedactIgnoreFile(dir);
    expect(config).toEqual({ ignore: ["notes/x.md"], allow: ["secret-foo"] });
    // Round-trips through the live compiler.
    const ignore = redactIgnoreFromMetadata(config ?? undefined);
    expect(ignore.literals).toEqual(new Set(["secret-foo"]));
    expect(matchesRedactGlob("notes/x.md", ignore)).toBe(true);
  });
});
