import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { run } from "../shell.js";
import { redactCmd } from "./redact.js";

// A real GitHub PAT shape (ghp_ + 36 chars) — matches the "github-token" detector,
// which has severity "secret" and therefore BLOCKS. The value is fabricated.
const SECRET = "ghp_0123456789abcdefghijklmnopqrstuvwx";
// Plain prose with no key=value pair, no high-entropy blob, no email — stays clean.
const CLEAN = "just some ordinary notes about the weather today\n";

const realStdin = process.stdin;

/**
 * Replace `process.stdin` with `fake` for the duration of one call, then restore
 * the real stdin. `configurable: true` lets the next test redefine it again.
 */
function withStdin(fake: Readable): void {
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
}

function restoreStdin(): void {
  Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
}

afterEach(() => {
  restoreStdin();
  vi.restoreAllMocks();
});

/** A temp dir whose lifetime is the test run (auto-cleaned). */
async function mkTmp(): Promise<string> {
  return tmpDir("mage-redact-");
}

describe("redactCmd — stdin path (target undefined or '-')", () => {
  it("blocks on secret-bearing stdin and reports the secret finding", async () => {
    const fake = new PassThrough();
    withStdin(fake);
    const p = redactCmd(undefined, { quiet: true });
    fake.write(`token here: ${SECRET}\n`);
    fake.end();
    const { findings, blocked } = await p;
    expect(blocked).toBe(true);
    expect(findings.some((f) => f.severity === "secret")).toBe(true);
    // The raw secret must NEVER appear in a finding preview (it is masked).
    expect(findings.every((f) => !f.preview.includes(SECRET))).toBe(true);
  });

  it("does not block on clean stdin (no secrets)", async () => {
    const fake = new PassThrough();
    withStdin(fake);
    const p = redactCmd("-", { quiet: true });
    fake.write(CLEAN);
    fake.end();
    const { findings, blocked } = await p;
    expect(blocked).toBe(false);
    expect(findings.filter((f) => f.severity === "secret")).toHaveLength(0);
  });

  it("resolves '' on an empty/closed stream and does not block", async () => {
    const fake = new PassThrough();
    withStdin(fake);
    const p = redactCmd(undefined, { quiet: true });
    fake.end(); // no data — closes immediately
    const { findings, blocked } = await p;
    expect(blocked).toBe(false);
    expect(findings).toHaveLength(0);
  });

  it("rejects (throws toError) when stdin emits an 'error'", async () => {
    const fake = new PassThrough();
    withStdin(fake);
    const p = redactCmd(undefined, { quiet: true });
    fake.emit("error", new Error("pipe broke"));
    await expect(p).rejects.toThrow("pipe broke");
  });
});

describe("redactCmd — file path", () => {
  it("blocks on a secret-bearing file", async () => {
    const dir = await mkTmp();
    const file = join(dir, "leak.env");
    await writeFile(file, `GITHUB_TOKEN=${SECRET}\n`);
    const { findings, blocked } = await redactCmd(file, { quiet: true });
    expect(blocked).toBe(true);
    expect(findings.some((f) => f.severity === "secret")).toBe(true);
  });

  it("--strip writes redacted text to stdout with no raw secret", async () => {
    const dir = await mkTmp();
    const file = join(dir, "leak.env");
    await writeFile(file, `api_key=${SECRET}\n`);
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      });
    const { blocked } = await redactCmd(file, { strip: true, quiet: true });
    spy.mockRestore();
    const out = written.join("");
    expect(blocked).toBe(true);
    expect(out).not.toContain(SECRET);
    expect(out).toContain("[REDACTED:");
  });

  it("raises a friendly 'Cannot read ...' error for a missing file", async () => {
    const dir = await mkTmp();
    const missing = join(dir, "nope.txt");
    await expect(redactCmd(missing, { quiet: true })).rejects.toThrow(
      new RegExp(`Cannot read '${missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`),
    );
  });
});

describe("redactCmd — report (non-quiet) prints findings without leaking secrets", () => {
  // console output is silenced so test logs stay clean, but we assert the report
  // ran and that no raw secret ever reached the log.
  it("prints secret + PII detail and a blocking error, masked", async () => {
    const dir = await mkTmp();
    const file = join(dir, "leak.md");
    await writeFile(file, `api_key=${SECRET}\ncontact me at jane.doe@example.com\n`);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => void logs.push(String(m)));
    const { blocked } = await redactCmd(file, {});
    expect(blocked).toBe(true);
    const printed = logs.join("\n");
    expect(printed).not.toContain(SECRET);
    expect(printed).toMatch(/secret/i);
    expect(printed).toMatch(/PII/);
  });

  it("prints the clean success line when nothing is found", async () => {
    const dir = await mkTmp();
    const file = join(dir, "clean.md");
    await writeFile(file, CLEAN);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => void logs.push(String(m)));
    const { blocked, findings } = await redactCmd(file, {});
    expect(blocked).toBe(false);
    expect(findings).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/No secrets or PII detected/);
  });
});

// ─── --staged (Gate-2 pre-commit scan) ───────────────────────────────────────
//
// `--staged` scans the git index of process.cwd(), SCOPED to the mage docs root
// (Gate-2 protects the KB, not app source). We point cwd at a throwaway mage repo
// via a spy (no real chdir, so tests stay isolated) and assert the gate blocks a
// planted secret in a mage/ note with FILE-attributed, masked output, passes a
// clean note, and fails open on a non-git dir.

/** A throwaway git repo that is ALSO a mage in-repo KB (Gate-2 is docs-root scoped). */
async function mkStagedRepo(): Promise<string> {
  const { dir: d } = await withKb({ prefix: "mage-redact-staged-" });
  await run("git", ["-C", d, "init", "--quiet"], { throwOnError: true });
  await run("git", ["-C", d, "config", "user.email", "test@example.com"], {
    throwOnError: true,
  });
  await run("git", ["-C", d, "config", "user.name", "Test"], { throwOnError: true });
  return d;
}

async function stageFile(dir: string, name: string, content: string): Promise<void> {
  const abs = join(dir, name);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await run("git", ["-C", dir, "add", name], { throwOnError: true });
}

describe("redactCmd — --staged scans the git index of cwd", () => {
  it("blocks on a planted staged secret, file-attributed and masked", async () => {
    const dir = await mkStagedRepo();
    await stageFile(dir, "mage/notes/leak.md", `GITHUB_TOKEN=${SECRET}\n`);
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const { findings, blocked } = await redactCmd(undefined, { staged: true, quiet: true });

    expect(blocked).toBe(true);
    const secret = findings.find((f) => f.severity === "secret");
    expect(secret).toBeDefined();
    // Findings carry the owning file and never the raw secret.
    expect((secret as { file?: string }).file).toBe("mage/notes/leak.md");
    expect(findings.every((f) => !f.preview.includes(SECRET))).toBe(true);
  });

  it("does not block when the staged file is clean", async () => {
    const dir = await mkStagedRepo();
    await stageFile(dir, "mage/notes/notes.md", CLEAN);
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const { findings, blocked } = await redactCmd(undefined, { staged: true, quiet: true });

    expect(blocked).toBe(false);
    expect(findings.filter((f) => f.severity === "secret")).toHaveLength(0);
  });

  it("fails open (no throw, not blocked) for a non-git dir", async () => {
    const dir = await mkTmp(); // never git-init'd → not a repo.
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const { findings, blocked } = await redactCmd(undefined, { staged: true, quiet: true });

    expect(blocked).toBe(false);
    expect(findings).toHaveLength(0);
  });

  it("the non-quiet staged report prints file:line detail without the raw secret", async () => {
    const dir = await mkStagedRepo();
    await stageFile(dir, "mage/notes/leak.md", `api_key=${SECRET}\ncontact jane.doe@example.com\n`);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => void logs.push(String(m)));

    const { blocked } = await redactCmd(undefined, { staged: true });

    expect(blocked).toBe(true);
    const printed = logs.join("\n");
    expect(printed).not.toContain(SECRET);
    expect(printed).toContain("mage/notes/leak.md:line");
  });
});
