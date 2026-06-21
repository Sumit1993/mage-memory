import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { stageCmd } from "./stage-cmd.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A minimal in-repo KB: <dir>/mage/{metadata.json}. */
async function makeKb(): Promise<string> {
  const { dir } = await withKb();
  return dir;
}

const staged = (dir: string, slug: string) => join(dir, "mage", ".mage", "staging", `${slug}.md`);

describe("mage stage", () => {
  it("writes a redacted draft to .staging/ with a gotcha type + H1", async () => {
    const dir = await makeKb();
    const r = await stageCmd({
      dir,
      title: "Bump touches many files",
      tags: "mage/release",
      body: "the release bump misses the badge",
    });
    expect(r.staged).toBe(true);
    expect(r.slug).toBe("bump-touches-many-files");

    const text = await readFile(staged(dir, "bump-touches-many-files"), "utf8");
    expect(text).toContain("type: gotcha");
    expect(text).toContain("tags:");
    expect(text).toContain("# Bump touches many files");
    expect(text).toContain("the release bump misses the badge");
  });

  it("SCRUBS a secret in the body but never blocks", async () => {
    const dir = await makeKb();
    const r = await stageCmd({
      dir,
      title: "Do not paste keys",
      body: "I accidentally used AKIAIOSFODNN7EXAMPLE here",
    });
    expect(r.staged).toBe(true);
    expect(r.redactions).toBeGreaterThanOrEqual(1);
    const text = await readFile(staged(dir, "do-not-paste-keys"), "utf8");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).toContain("[REDACTED:");
  });

  it("SCRUBS a secret in the title (which seeds the slug + H1) but never blocks", async () => {
    const dir = await makeKb();
    const r = await stageCmd({ dir, title: "Key AKIAIOSFODNN7EXAMPLE leak", body: "a clean body" });
    expect(r.staged).toBe(true);
    expect(r.redactions).toBeGreaterThanOrEqual(1);
    const text = await readFile(staged(dir, r.slug!), "utf8");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).toContain("[REDACTED:");
    expect(r.slug).not.toContain("akiaiosfodnn7example"); // the slug is from the redacted title
  });

  it("SCRUBS a secret fat-fingered into --tags / --wing (frontmatter values)", async () => {
    const dir = await makeKb();
    const r = await stageCmd({
      dir,
      title: "Tag leak",
      tags: "mage/AKIAIOSFODNN7EXAMPLE",
      body: "a clean body",
    });
    expect(r.staged).toBe(true);
    const text = await readFile(staged(dir, r.slug!), "utf8");
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("warns (soft) when the draft exceeds the lesson-note cap but still stages it", async () => {
    const dir = await makeKb();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const r = await stageCmd({ dir, title: "Long lesson", tags: "mage/x", body: "x".repeat(1500) });
      expect(r.staged).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("1200"));
    } finally {
      warn.mockRestore();
    }
  });

  it("skips a lesson already covered by a committed note", async () => {
    const dir = await makeKb();
    await mkdir(join(dir, "mage", "notes"), { recursive: true });
    await writeFile(
      join(dir, "mage", "notes", "existing.md"),
      "---\ntype: gotcha\ntags: [mage/release]\nkeywords: [release, badge]\n---\n# Release badge\n",
    );
    const r = await stageCmd({ dir, title: "Release badge bump", tags: "mage/release", body: "the badge again" });
    expect(r.staged).toBe(false);
    expect(r.reason).toBe("covered");
    expect(r.by).toBe("notes/existing.md");
  });

  it("skips an identical draft already staged (anti-flood)", async () => {
    const dir = await makeKb();
    const first = await stageCmd({ dir, title: "Connect ensure ignores", tags: "mage/setup", body: "connect must gitignore sinks" });
    expect(first.staged).toBe(true);
    const second = await stageCmd({ dir, title: "Connect ensure ignores", tags: "mage/setup", body: "connect must gitignore sinks" });
    expect(second.staged).toBe(false);
    expect(second.reason).toBe("duplicate");
  });

  it("requires a title and a non-empty body", async () => {
    const dir = await makeKb();
    await expect(stageCmd({ dir, body: "x" })).rejects.toThrow(/title/);
    await expect(stageCmd({ dir, title: "X", body: "   " })).rejects.toThrow(/body/);
  });

  it("errors with a friendly message when there is no KB", async () => {
    const empty = await tmpDir("mage-nokb-");
    await expect(stageCmd({ dir: empty, title: "X", body: "y" })).rejects.toThrow(/No mage knowledge base/);
  });
});
