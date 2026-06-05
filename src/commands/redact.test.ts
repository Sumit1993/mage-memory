import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** A temp dir whose lifetime is the test run (vitest tears the OS tmp down). */
async function mkTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mage-redact-"));
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
