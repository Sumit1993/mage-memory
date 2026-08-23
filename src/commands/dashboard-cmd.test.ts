import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { dashboard } from "./dashboard-cmd.js";
import { init } from "./init.js";
import { codeRepoDocsRoot } from "../paths.js";
import { tmpDir } from "../../test/fixtures/kb.js";

/** A code repo in external mode whose hub is not on this machine (#158). */
async function unreachableExternalRepo(prefix: string): Promise<string> {
  const code = await tmpDir(prefix);
  const missing = join(await tmpDir(`${prefix}hub-`), "not-cloned");
  await mkdir(join(code, "mage"), { recursive: true });
  await writeFile(
    join(code, "mage", "metadata.json"),
    JSON.stringify({
      schema: "mage.v2",
      mode: "external",
      project: "engine",
      hub_path: missing,
      hub_repo: null,
      hub_refs: [],
      linked_at: "",
    }),
  );
  return code;
}

/** A fresh in-repo mage KB in a tmp dir; returns the code-repo root. */
async function mkKb(): Promise<string> {
  const repo = await tmpDir("mage-dashboard-cmd-");
  await init({ mode: "in-repo", yes: true, codeRepo: repo });
  // Plant one real note so the snapshot is non-trivial.
  const docs = codeRepoDocsRoot(repo);
  await writeFile(
    join(docs, "notes", "a.md"),
    "---\ntype: insight\ntags: [w/r]\n---\n# A note\n\nbody\n",
  ).catch(async () => {
    // notes/ may not exist on a bare init — fall back to the docs root.
    await writeFile(join(docs, "a.md"), "---\ntype: insight\ntags: [w/r]\n---\n# A note\n\nbody\n");
  });
  return repo;
}

describe("dashboard command — knowledge tier (always)", () => {
  it("writes Dashboard.md + Knowledge.base, and does NOT write the html without --html", async () => {
    const repo = await mkKb();
    const docs = codeRepoDocsRoot(repo);

    const result = await dashboard({ cwd: repo });

    expect(result.written.map((p) => p.replace(`${docs}/`, ""))).toEqual([
      "Dashboard.md",
      "Knowledge.base",
    ]);
    // Both files are real on disk.
    await expect(readFile(join(docs, "Dashboard.md"), "utf8")).resolves.toContain("dashboard");
    await expect(readFile(join(docs, "Knowledge.base"), "utf8")).resolves.toContain("views:");
    // No cockpit FILE is written without --html.
    await expect(readFile(join(docs, "dashboard.html"), "utf8")).rejects.toThrow();
    // But the cockpit IS already gitignored safe-by-default (FIX 6 / ADR-0020 §6):
    // `mage init` establishes the ignore so the file can never be committed even if
    // a later `--html` (or an editor) writes it. Defense in depth.
    const gi = await readFile(join(repo, ".gitignore"), "utf8").catch(() => "");
    expect(gi).toContain("mage/dashboard.html");
  });
});

describe("dashboard command — cockpit tier (--html)", () => {
  it("also writes dashboard.html and gitignores it at the code-repo root", async () => {
    const repo = await mkKb();
    const docs = codeRepoDocsRoot(repo);

    const result = await dashboard({ cwd: repo, html: true });

    expect(result.written.map((p) => p.replace(`${docs}/`, ""))).toEqual([
      "Dashboard.md",
      "Knowledge.base",
      "dashboard.html",
    ]);
    // The cockpit is a real, self-contained HTML document.
    const html = await readFile(join(docs, "dashboard.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    // The cockpit is gitignored at the CODE-REPO root with the mage/ prefix.
    const gi = await readFile(join(repo, ".gitignore"), "utf8");
    expect(gi).toContain("mage/dashboard.html");
  });
});

describe("dashboard command — no KB", () => {
  it("prints a friendly error and returns no paths (never throws)", async () => {
    const empty = await tmpDir("mage-dashboard-nokb-");
    const result = await dashboard({ cwd: empty });
    expect(result.written).toEqual([]);
  });
});

describe("dashboard — an unreachable external hub is not a missing KB (#158)", () => {
  it("names `mage connect`, never `mage init` (which would mint a SECOND KB)", async () => {
    const err = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const code = await unreachableExternalRepo("mage-dashboard-external-");
      const r = await dashboard({ cwd: code });
      expect(r.written).toEqual([]);
      const said = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(said).toMatch(/external mode/);
      expect(said).toMatch(/mage connect/);
      expect(said).toMatch(/Do NOT run `mage init`/);
    } finally {
      err.mockRestore();
    }
  });
});
