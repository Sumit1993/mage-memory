// LIVE integration test (BILLED): drives a real headless `claude -p` session to prove
// the ADR-0032 capture loop end-to-end against the actual Claude Code memory reflex —
// the one path the deterministic suite can't cover. Each test SKIPS itself unless
// `MAGE_LIVE=1` AND the `claude` CLI is present, so this file is safe to keep in the
// default integration run.
//
// Run it:  MAGE_LIVE=1 npm run test:integration
//
// Caveats (Claude Code v2.1.x; revisit per version):
//   - `autoMemoryDirectory` is undocumented + binary-confirmed — pin the CC version.
//   - Hooks + the relocation activate only after workspace trust; the harness passes
//     `--dangerously-skip-permissions` to bypass the interactive prompt headlessly.
//   - Whether the model writes a memory at all depends on its reflex; the prompts below
//     ask explicitly. A run where CC writes nothing is a no-op (asserted as a skip-ish
//     soft check), not a false failure.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initKb, requireLive, runClaude, runMage, wireCommandeer } from "./lib/harness.js";

const RESERVED = new Set(["INDEX.md", "MEMORY.md", "IDENTITY.md", "AGENTS.md", "CLAUDE.md", "Dashboard.md"]);

/** The capture-inbox files CC wrote at the docs-root top (flat .md, not a generated index). */
async function inboxCaptures(root: string): Promise<string[]> {
  const names = await readdir(root).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(".md") && !RESERVED.has(n) && !n.startsWith("_index."));
}

describe("live: Claude Code capture redirect (BILLED, MAGE_LIVE only)", () => {
  it("Gate-0 scrubs a native-memory write in-flight — the raw secret never reaches disk", async (ctx) => {
    if (!(await requireLive(ctx))) return;

    const { dir, root } = await initKb();
    await wireCommandeer(dir, root);

    const email = "oncall.billing@acme-example.com";
    const prompt =
      "Use your memory to save this for future sessions, as a single memory note: " +
      `the billing on-call contact email is ${email} and the deploy runbook lives at docs/deploy.md. ` +
      "Persist it now.";
    const run = await runClaude(prompt, { cwd: dir, timeoutMs: 180_000 });
    expect(run.code, `claude exited non-zero: ${run.stderr}`).toBe(0);

    const captures = await inboxCaptures(root);
    // If CC declined to write a memory this run, treat as an environment skip (not a fail).
    if (captures.length === 0) {
      ctx.skip();
      return;
    }
    // Whatever it wrote, the raw email must NOT be on disk — Gate-0 redacted it in-flight.
    let sawRedaction = false;
    for (const name of captures) {
      const body = await readFile(join(root, name), "utf8");
      expect(body, `raw email leaked into ${name}`).not.toContain(email);
      if (body.includes("[REDACTED:email]")) sawRedaction = true;
    }
    expect(sawRedaction, "expected a [REDACTED:email] marker in a capture").toBe(true);

    // …and the scrubbed capture is ingestable by the groom loop.
    const surfaced = JSON.parse((await runMage(["groom", "--json"], { cwd: dir })).stdout);
    expect((surfaced.ingested ?? []).length).toBeGreaterThan(0);
  });

  it("MEMORY.md is auto-loaded for recall — a fresh session can answer from it", async (ctx) => {
    if (!(await requireLive(ctx))) return;

    const { dir, root } = await initKb();
    await wireCommandeer(dir, root);

    // Plant an unguessable fact as a note, then index so it folds into MEMORY.md.
    const canary = "zphwqx-7731"; // not derivable from anything else in the repo
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(
      join(root, "notes", "deploy-codeword.md"),
      `---\ntype: pointer\ntags: [ops]\n---\n# Deploy codeword\nThe production deploy codeword is ${canary}.\n`,
    );
    expect((await runMage(["index"], { cwd: dir })).code).toBe(0);
    expect(await readFile(join(root, "MEMORY.md"), "utf8")).toContain("Deploy codeword");

    const run = await runClaude(
      "Without using any tools, what knowledge-base notes do you already have loaded? List their titles.",
      { cwd: dir, timeoutMs: 120_000 },
    );
    expect(run.code).toBe(0);
    // The note's title rode in via the auto-loaded MEMORY.md (recall floor).
    expect(run.stdout.toLowerCase()).toContain("deploy codeword");
  });
});
