import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir, withKb } from "../test/fixtures/kb.js";
import { run } from "./shell.js";
import { scanStaged } from "./staged-scan.js";

// A realistic Anthropic key shape (`sk-ant-<kind>-<body>`) — the dedicated
// "anthropic-key" detector flags it as severity "secret", so it BLOCKS. The
// value is fabricated; the shape is what matters for the detector to fire.
const SECRET = "sk-ant-api03-" + "AbCdEf0123456789AbCdEf0123456789AbCdEf";
// Plain prose: no key=value, no high-entropy blob, no email — stays clean.
const CLEAN = "just some ordinary notes about the weather today\n";

/** Init a git repo with a committer identity so `git add` works deterministically. */
async function initRepo(dir: string): Promise<void> {
  await run("git", ["-C", dir, "init", "--quiet"], { throwOnError: true });
  await run("git", ["-C", dir, "config", "user.email", "test@example.com"], {
    throwOnError: true,
  });
  await run("git", ["-C", dir, "config", "user.name", "Test"], { throwOnError: true });
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
    const { dir } = await withKb();
    await initRepo(dir);
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
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/notes/café.md", `ANTHROPIC_API_KEY=${SECRET}\n`);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(true);
    expect(scannedFiles).toBe(1); // the non-ASCII file was scanned, not skipped.
    const secret = findings.find((f) => f.severity === "secret");
    expect(secret?.file).toBe("mage/notes/café.md");
  });

  it("attributes findings across multiple staged files under mage/", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
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
    const { dir } = await withKb();
    await initRepo(dir);
    // A secret-shaped fixture in application source — exactly mage's own redaction
    // tests. Gate-2 protects `mage/`, not `src/`, so this must NOT block.
    await addFile(dir, "src/redact.test.ts", `const fixture = "${SECRET}";\n`);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(0); // src/ is out of scope — not scanned at all.
    expect(findings).toHaveLength(0);
  });

  it("scans only the mage/ file when both a mage/ note and a src/ file are staged", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
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
    const { dir } = await withKb({ kind: "hub" });
    await initRepo(dir);
    await addFile(dir, "projects/p/notes/leak.md", `API_KEY=${SECRET}\n`);

    const { blocked, findings } = await scanStaged(dir);

    expect(blocked).toBe(true); // a secret in a hub-owned project note is caught.
    expect(findings.some((f) => f.file === "projects/p/notes/leak.md")).toBe(true);
  });
});

describe("scanStaged — clean / empty / no-KB do not block", () => {
  it("returns blocked=false with a clean staged file under mage/", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/notes/notes.md", CLEAN);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(1);
    expect(findings.filter((f) => f.severity === "secret")).toHaveLength(0);
  });

  it("returns blocked=false with nothing staged", async () => {
    const { dir } = await withKb();
    await initRepo(dir);

    const { findings, blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(0);
    expect(findings).toHaveLength(0);
  });

  it("is a no-op gate in a git repo with NO mage KB (nothing tracked-and-shared to protect)", async () => {
    const dir = await tmpDir();
    await initRepo(dir); // a git repo, but NOT a mage KB.
    await addFile(dir, "leak.env", `API_KEY=${SECRET}\n`);

    const result = await scanStaged(dir);

    expect(result).toEqual({ findings: [], blocked: false, scannedFiles: 0 });
  });
});

describe("scanStaged — fail-open on a non-git dir (never throws)", () => {
  it("returns the safe empty result for a plain (non-repo) dir", async () => {
    const dir = await tmpDir(); // git init NOT run → not a repo.

    const result = await scanStaged(dir);

    expect(result).toEqual({ findings: [], blocked: false, scannedFiles: 0 });
  });
});

describe("scanStaged — 0.0.12 false-positive fixes (generated artifacts + metadata.redact)", () => {
  it("does NOT scan mage's own generated artifacts, even if they carry a secret-shaped string", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    // Generated index/scaffolding + host-adapter skill files: skipped wholesale —
    // their content is mage-authored and their path strings trip the detector.
    await addFile(dir, "mage/INDEX.md", `API_KEY=${SECRET}\n`);
    await addFile(dir, "mage/_index.mage.md", `API_KEY=${SECRET}\n`);
    await addFile(dir, "mage/.claude/skills/groom/SKILL.md", `API_KEY=${SECRET}\n`);

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(0); // all three are generated artifacts → skipped
  });

  it("still scans an AUTHORED note alongside skipped generated artifacts", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/INDEX.md", `API_KEY=${SECRET}\n`); // generated → skipped
    await addFile(dir, "mage/notes/leak.md", `API_KEY=${SECRET}\n`); // authored → scanned + blocks

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(true);
    expect(scannedFiles).toBe(1);
  });

  it("skips a file matched by a metadata.redact.ignore glob but scans the rest", async () => {
    const dir = await tmpDir();
    await initRepo(dir);
    await mkdir(join(dir, "mage"), { recursive: true });
    // Write metadata with a redact.ignore glob covering the generated dump path.
    await writeFile(
      join(dir, "mage", "metadata.json"),
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "t",
        redact: { ignore: ["notes/generated/**"] },
      }),
    );
    await addFile(dir, "mage/notes/generated/dump.md", `API_KEY=${SECRET}\n`); // allowlisted path
    await addFile(dir, "mage/notes/real.md", CLEAN); // scanned, clean

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false); // the secret-bearing path is allowlisted
    expect(scannedFiles).toBe(1); // only notes/real.md (dump.md is glob-ignored)
  });

  it("a metadata.redact.allow literal suppresses an in-note false positive", async () => {
    const dir = await tmpDir();
    await initRepo(dir);
    await mkdir(join(dir, "mage"), { recursive: true });
    // Write metadata with the secret-shaped string in the allow list.
    await writeFile(
      join(dir, "mage", "metadata.json"),
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "t",
        redact: { allow: [SECRET] },
      }),
    );
    await addFile(dir, "mage/notes/doc.md", `the example token ${SECRET} is illustrative\n`);

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(scannedFiles).toBe(1); // doc.md IS scanned…
    expect(blocked).toBe(false); // …but the allowlisted literal is not a finding
  });

  it("DOES scan a user-authored subdir file that merely shares a reserved basename (no bypass)", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    // mage generates INDEX.md only at the docs ROOT. A file named INDEX.md inside a
    // subdir is author content — a secret there MUST still block (Gate-2 bypass guard).
    await addFile(dir, "mage/notes/INDEX.md", `API_KEY=${SECRET}\n`);

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(true);
    expect(scannedFiles).toBe(1); // scanned, NOT skipped as a generated artifact
  });

  it("still skips a per-wing _index.*.md at any depth (genuinely generated anywhere)", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/notes/_index.mage.md", `API_KEY=${SECRET}\n`); // generated per-wing

    const { blocked, scannedFiles } = await scanStaged(dir);

    expect(blocked).toBe(false);
    expect(scannedFiles).toBe(0); // _index.*.md is a generated artifact at any depth
  });

  it("metadata.json staged with a secret-shaped allow literal neither leaks nor self-blocks Gate-2", async () => {
    // Regression pin for the .mage/ state fold (ADR-0025): metadata.json is no longer
    // skipped by the old `.redactignore` self-skip. It IS in scope and IS scanned.
    // A `redact.allow` literal stored there is secret-shaped (same Anthropic key form
    // as SECRET) — this test pins that it is suppressed (blocked=false) and that BOTH
    // files are counted as scanned (scannedFiles===2).
    const dir = await tmpDir();
    await initRepo(dir);
    await mkdir(join(dir, "mage"), { recursive: true });
    // Stage metadata.json (via addFile → git add) with the allow literal in it.
    // SECRET is the same sk-ant-... shaped value used throughout this file.
    await addFile(
      dir,
      "mage/metadata.json",
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "t",
        redact: { allow: [SECRET] },
      }),
    );
    // Stage a note containing the SAME secret-shaped token — allowlisted, so it is
    // suppressed and must NOT block.
    await addFile(dir, "mage/notes/doc.md", `example token ${SECRET} is illustrative\n`);

    const { blocked, scannedFiles } = await scanStaged(dir);

    // Both files are in scope and are scanned (metadata.json is not a generated artifact).
    expect(scannedFiles).toBe(2);
    // The allow literal in metadata.json is suppressed by scanSecrets(); the note's
    // token is also suppressed because it matches the allow list read from disk.
    expect(blocked).toBe(false);
  });
});
