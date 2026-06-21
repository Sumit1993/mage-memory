import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import { init } from "./init.js";
import { dream } from "./dream-cmd.js";
import { readNote } from "../note.js";
import { readRejected } from "../grooming/proposals.js";
import { SKILL_PREFIX } from "../skills-shared.js";

// ─── stdin stubbing (house pattern; mirrors observe.test.ts / redact.test.ts) ────

const realStdin = process.stdin;
function withStdin(fake: Readable): void {
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
}
function restoreStdin(): void {
  Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
}

afterEach(() => {
  restoreStdin();
});

/** A fresh in-repo mage KB in a tmp dir; returns the code-repo root. */
async function mkKb(): Promise<string> {
  const repo = await tmpDir("mage-dream-cmd-");
  await init({ mode: "in-repo", yes: true, codeRepo: repo });
  return repo;
}

/** Feed `raw` on stdin and run `dream(opts)`; resolves after the command settles. */
async function run(raw: string, opts: { dir: string; apply?: boolean; reject?: boolean }) {
  const fake = new PassThrough();
  withStdin(fake);
  const p = dream(opts);
  fake.write(raw);
  fake.end();
  return p;
}

// ─── malformed stdin → fail-closed throws (--apply seam) ─────────────────────────

describe("dream --apply — fail-closed on a malformed proposal", () => {
  it("empty stdin → throws", async () => {
    const repo = await mkKb();
    await expect(run("", { dir: repo, apply: true })).rejects.toThrow(/no proposal/);
  });

  it("non-JSON stdin → throws", async () => {
    const repo = await mkKb();
    await expect(run("not json at all {", { dir: repo, apply: true })).rejects.toThrow(/not valid JSON/);
  });

  it("a non-object (array/primitive) → throws", async () => {
    const repo = await mkKb();
    await expect(run("[1,2,3]", { dir: repo, apply: true })).rejects.toThrow(/must be a JSON object/);
  });

  it("an object missing `action` → throws", async () => {
    const repo = await mkKb();
    await expect(
      run(JSON.stringify({ target: "notes/x.md" }), { dir: repo, apply: true }),
    ).rejects.toThrow(/is not a valid action/);
  });

  it("an unknown `action` → throws", async () => {
    const repo = await mkKb();
    await expect(
      run(JSON.stringify({ action: "obliterate", target: "notes/x.md" }), { dir: repo, apply: true }),
    ).rejects.toThrow(/is not a valid action/);
  });

  it("a proposal missing `target` → throws", async () => {
    const repo = await mkKb();
    await expect(
      run(JSON.stringify({ action: "graduate" }), { dir: repo, apply: true }),
    ).rejects.toThrow(/target must be a string/);
  });
});

// ─── a valid proposal flows through applyProposal (--apply seam) ──────────────────

describe("dream --apply — a valid proposal runs the single writer", () => {
  it("a valid graduate proposal → applyProposal writes the skill + points the note", async () => {
    const repo = await mkKb();
    const docsRoot = join(repo, "mage");
    const relPath = "notes/stripe.md";
    await mkdir(join(docsRoot, "notes"), { recursive: true });
    await writeFile(
      join(docsRoot, relPath),
      [
        "---",
        "type: playbook",
        "tags: [pay/webhooks]",
        "keywords: [stripe, webhook, retry]",
        "---",
        "# Stripe webhook retries",
        "",
        "1. Verify the signature.",
      ].join("\n"),
      "utf8",
    );

    await expect(
      run(JSON.stringify({ action: "graduate", target: relPath }), { dir: repo, apply: true }),
    ).resolves.toBeDefined();

    // applyProposal ran: the note now carries the graduated_skill pointer.
    const graduated = await readNote(join(docsRoot, relPath));
    expect(graduated.frontmatter.graduated_skill).toBe(`${SKILL_PREFIX}stripe-webhook-retries`);
  });

  it("a valid demote of a missing skill → applyProposal refuses (no throw, rendered refusal)", async () => {
    const repo = await mkKb();
    // No SKILL.md on disk — the planner throws, the applier refuses cleanly.
    await expect(
      run(JSON.stringify({ action: "demote", target: `${SKILL_PREFIX}ghost` }), {
        dir: repo,
        apply: true,
      }),
    ).resolves.toBeDefined();
  });
});

// ─── --reject appends + dedups (--reject seam) ───────────────────────────────────

describe("dream --reject — appends to the back-off buffer, deduped", () => {
  it("a valid proposal is appended; a second identical reject dedups (length stays 1)", async () => {
    const repo = await mkKb();
    const docsRoot = join(repo, "mage");
    const proposal = JSON.stringify({ action: "graduate", target: "notes/x.md" });

    await run(proposal, { dir: repo, reject: true });
    let rejected = await readRejected(docsRoot);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.action).toBe("graduate");
    expect(rejected[0]?.target).toBe("notes/x.md");

    // A second identical reject is suppressed by isRejected (action+target match).
    await run(proposal, { dir: repo, reject: true });
    rejected = await readRejected(docsRoot);
    expect(rejected).toHaveLength(1);
  });

  it("--reject still fail-closes on a malformed proposal", async () => {
    const repo = await mkKb();
    await expect(run("", { dir: repo, reject: true })).rejects.toThrow(/no proposal/);
  });
});
