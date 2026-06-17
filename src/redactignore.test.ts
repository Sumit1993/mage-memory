import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  globToRegExp,
  matchesRedactGlob,
  parseRedactIgnore,
  readRedactIgnore,
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

describe("parseRedactIgnore", () => {
  it("splits globs from literal: allows and ignores comments + blanks", () => {
    const { globs, literals } = parseRedactIgnore(
      ["# a comment", "", "  notes/generated/**  ", "literal:AKIAFAKE123", "*.fixture.md", "   "].join(
        "\n",
      ),
    );
    expect(globs).toHaveLength(2); // the two glob lines
    expect(literals).toEqual(new Set(["AKIAFAKE123"]));
  });

  it("trims a literal value and drops an empty one", () => {
    const { literals } = parseRedactIgnore(["literal:  sk-ant-foo  ", "literal:"].join("\n"));
    expect(literals).toEqual(new Set(["sk-ant-foo"]));
  });

  it("tolerates CRLF line endings", () => {
    const { globs, literals } = parseRedactIgnore("notes/x.md\r\nliteral:abc\r\n");
    expect(globs).toHaveLength(1);
    expect(literals).toEqual(new Set(["abc"]));
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
    // Documents the danger: a lone ** in .redactignore disables the gate for every
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
});

describe("matchesRedactGlob", () => {
  it("is true iff any compiled glob matches", () => {
    const ignore = parseRedactIgnore(["notes/generated/**", "literal:x"].join("\n"));
    expect(matchesRedactGlob("notes/generated/dump.md", ignore)).toBe(true);
    expect(matchesRedactGlob("notes/real.md", ignore)).toBe(false);
  });
});

describe("readRedactIgnore — fail-open", () => {
  it("returns an empty allowlist when the file is absent", async () => {
    const dir = await tmp();
    const ignore = await readRedactIgnore(dir);
    expect(ignore.globs).toEqual([]);
    expect(ignore.literals).toEqual(new Set());
  });

  it("returns a FRESH empty each time (mutating one result never poisons the next)", async () => {
    const dir = await tmp(); // no .redactignore → fail-open path
    const first = await readRedactIgnore(dir);
    first.literals.add("leaked");
    first.globs.push(/x/);
    const second = await readRedactIgnore(dir);
    expect(second.literals).toEqual(new Set()); // not polluted by `first`
    expect(second.globs).toEqual([]);
  });

  it("reads and parses a present file", async () => {
    const dir = await tmp();
    await writeFile(join(dir, ".redactignore"), "notes/x.md\nliteral:secret-foo\n");
    const ignore = await readRedactIgnore(dir);
    expect(ignore.globs).toHaveLength(1);
    expect(ignore.literals).toEqual(new Set(["secret-foo"]));
    expect(matchesRedactGlob("notes/x.md", ignore)).toBe(true);
  });
});
