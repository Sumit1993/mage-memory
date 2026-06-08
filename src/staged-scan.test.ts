import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./shell.js";
import { scanStaged } from "./staged-scan.js";

// A realistic Anthropic key shape (`sk-ant-<kind>-<body>`) — the dedicated
// "anthropic-key" detector flags it as severity "secret", so it BLOCKS. The
// value is fabricated; the shape is what matters for the detector to fire.
const SECRET = "sk-ant-api03-" + "AbCdEf0123456789AbCdEf0123456789AbCdEf";
// Plain prose: no key=value, no high-entropy blob, no email — stays clean.
const CLEAN = "just some ordinary notes about the weather today\n";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A temp dir cleaned up after each test. */
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "mage-staged-"));
  made.push(d);
  return d;
}

/** Init a git repo with a committer identity so `git add` works deterministically. */
async function initRepo(dir: string): Promise<void> {
  await run("git", ["-C", dir, "init", "--quiet"], { throwOnError: true });
  await run("git", ["-C", dir, "config", "user.email", "test@example.com"], {
    throwOnError: true,
  });
  await run("git", ["-C", dir, "config", "user.name", "Test"], { throwOnError: true });
}

/**
 * A git repo that is ALSO a mage in-repo KB: Gate-2 is SCOPED to the docs root
 * (`mage/`), so the staged secret must live under it to be in scope. Without a KB,
 * scanStaged is a no-op gate (see the dedicated test).
 */
async function initMageRepo(dir: string): Promise<void> {
  await initRepo(dir);
  await mkdir(join(dir, "mage"), { recursive: true });
  await writeFile(
    join(dir, "mage", "metadata.json"),
    JSON.stringify({ schema: "mage.v1", mode: "in-repo", project: "t" }),
  );
}

/** Write `content` to repo-relative `name` (creating parents) and stage it. */
async function addFile(dir: string, name: string, content: string): Promise<void> {
  const abs = join(dir, name);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await run("git", ["-C", dir, "add", name], { throwOnError: true });
}

describe("scanStaged — blocks on a staged secret UNDER the docs root, file-attributed, never raw", () => {
  it("flags a planted secret in a mage/ note as blocked and attributes it to its file", async () => {
    const dir = await tmp();
    await initMageRepo(dir);
    await addFile(dir, "mage/notes/leak.md", `ANTHROPIC_API_KEY=${SECRET}\n`);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(true);
    expect(scannedFiles).toBe(1);
    const secret = findings.find((f) => f.severity === "secret");
    expect(secret).toBeDefined();
    // The finding is attributed to the staged file it came from.
    expect(secret?.file).toBe("mage/notes/leak.md");
    // SECURITY: the raw secret value must NEVER appear in any finding field.
    for (const f of findings) {
      expect(f.preview).not.toContain(SECRET);
      expect(JSON.stringify(f)).not.toContain(SECRET);
    }
  });

  it("scans a non-ASCII-named staged file under mage/ (the -z / quotePath bypass regression)", async () => {
    // With git's default core.quotePath, `git diff --name-only` C-quotes this
    // name to `"mage/notes/caf\303\251.md"`, which `git show :<quoted>` rejects — the
    // file would be silently SKIPPED and its secret committed. `-z` emits the raw path.
    const dir = await tmp();
    await initMageRepo(dir);
    await addFile(dir, "mage/notes/café.md", `ANTHROPIC_API_KEY=${SECRET}\n`);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(true);
    expect(scannedFiles).toBe(1); // the non-ASCII file was scanned, not skipped.
    const secret = findings.find((f) => f.severity === "secret");
    expect(secret?.file).toBe("mage/notes/café.md");
  });

  it("attributes findings across multiple staged files under mage/", async () => {
    const dir = await tmp();
    await initMageRepo(dir);
    await addFile(dir, "mage/notes/a.md", `API_KEY=${SECRET}\n`);
    await addFile(dir, "mage/notes/clean.md", CLEAN);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(true);
    expect(scannedFiles).toBe(2);
    expect(findings.every((f) => f.file === "mage/notes/a.md")).toBe(true);
  });
});

describe("scanStaged — SCOPE: only the knowledge base is gated, never app source", () => {
  it("does NOT scan a staged secret OUTSIDE the docs root (e.g. src/ test fixtures)", async () => {
    const dir = await tmp();
    await initMageRepo(dir);
    // A secret-shaped fixture in application source — exactly mage's own redaction
    // tests. Gate-2 protects `mage/`, not `src/`, so this must NOT block.
    await addFile(dir, "src/redact.test.ts", `const fixture = "${SECRET}";\n`);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(0); // src/ is out of scope — not scanned at all.
    expect(findings).toHaveLength(0);
  });

  it("scans only the mage/ file when both a mage/ note and a src/ file are staged", async () => {
    const dir = await tmp();
    await initMageRepo(dir);
    await addFile(dir, "src/leak.test.ts", `const fixture = "${SECRET}";\n`); // out of scope
    await addFile(dir, "mage/notes/clean.md", CLEAN); // in scope, clean

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false); // the in-scope file is clean; the src/ secret is ignored.
    expect(scannedFiles).toBe(1); // only mage/notes/clean.md was scanned.
  });

  it("scans the WHOLE hub (the hub IS the KB → docs root = repo root)", async () => {
    // A standalone hub: top-level metadata.json + projects/ registry → resolveDocsRoot
    // returns kind=hub with root=repo, so the scope prefix is "" (everything). A hub is
    // a pure notes vault (ADR-0011), so "scan all staged" == "scan the whole KB".
    const dir = await tmp();
    await initRepo(dir);
    await writeFile(
      join(dir, "metadata.json"),
      JSON.stringify({ schema: "mage.v1", name: "h", created_at: "2026-06-08", projects: [] }),
    );
    await addFile(dir, "projects/p/notes/leak.md", `API_KEY=${SECRET}\n`);

    const { blocked, findings } = await scanStaged(dir);

    expect(blocked).toBe(true); // a secret in a hub-owned project note is caught.
    expect(findings.some((f) => f.file === "projects/p/notes/leak.md")).toBe(true);
  });
});

describe("scanStaged — clean / empty / no-KB do not block", () => {
  it("returns blocked=false with a clean staged file under mage/", async () => {
    const dir = await tmp();
    await initMageRepo(dir);
    await addFile(dir, "mage/notes/notes.md", CLEAN);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(1);
    expect(findings.filter((f) => f.severity === "secret")).toHaveLength(0);
  });

  it("returns blocked=false with nothing staged", async () => {
    const dir = await tmp();
    await initMageRepo(dir);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(0);
    expect(findings).toHaveLength(0);
  });

  it("is a no-op gate in a git repo with NO mage KB (nothing tracked-and-shared to protect)", async () => {
    const dir = await tmp();
    await initRepo(dir); // a git repo, but NOT a mage KB.
    await addFile(dir, "leak.env", `API_KEY=${SECRET}\n`);

    const result = await scanStaged(dir);

    expect(result).toEqual({ findings: [], blocked: false, scannedFiles: 0 });
  });
});

describe("scanStaged — fail-open on a non-git dir (never throws)", () => {
  it("returns the safe empty result for a plain (non-repo) dir", async () => {
    const dir = await tmp(); // git init NOT run → not a repo.

    const result = await scanStaged(dir);

    expect(result).toEqual({ findings: [], blocked: false, scannedFiles: 0 });
  });
});
