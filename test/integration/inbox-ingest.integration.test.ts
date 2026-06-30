// DETERMINISTIC integration test (no external tools, no billing): the full ADR-0032
// capture-inbox loop over the BUILT CLI and a real KB — recall -> groom ingest ->
// covered-archive -> backstop scrub -> accept -> notes/ (provenance + cc-session) ->
// idempotent re-run. This is the durable, repo-versioned form of the throwaway
// scratchpad soak script.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assertBuilt, initKb, runMage } from "./lib/harness.js";

/** A Gate-0-shaped capture (CC-renormalized frontmatter; already scrubbed/shaped body). */
function gate0Capture(opts: { type?: string; session?: string; body: string }): string {
  const meta = [
    "  node_type: memory",
    `  type: ${opts.type ?? "note"}`,
    "  created: 2026-06-27",
    ...(opts.session ? [`  originSessionId: ${opts.session}`] : []),
  ].join("\n");
  return `---\nname: ""\nmetadata:\n${meta}\n---\n\n${opts.body}\n`;
}

describe("integration: capture-inbox ingest loop (deterministic)", () => {
  beforeAll(() => assertBuilt());

  it("recall -> ingest -> covered-archive -> scrub -> accept -> notes/ -> idempotent", async () => {
    const { dir, root } = await initKb();

    // A committed note that will COVER one capture (covered-arm → archive, not promote).
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(
      join(root, "notes", "redis-ttl.md"),
      "---\ntype: gotcha\nkeywords: [redis, cache, ttl, expiry]\n---\n# Redis cache TTL\nSet a TTL on every key.\n",
    );

    // Plant inbox captures at the docs-root top.
    await writeFile(
      join(root, "db-pool-exhaustion.md"),
      gate0Capture({ type: "gotcha", session: "sess-1", body: "# DB pool exhaustion under load\n\nbumping the pool from 10 to 50 cleared the 500s." }),
    );
    await writeFile(
      join(root, "oncall-contact.md"),
      gate0Capture({ type: "pointer", session: "sess-2", body: "# Oncall contact\n\nBilling on-call: oncall@acme-example.com (escalate after 15m)." }),
    );
    await writeFile(
      join(root, "redis-cache-ttl.md"),
      gate0Capture({ session: "sess-3", body: "# Redis cache ttl\n\nremember to set redis cache ttl on keys." }),
    );
    await writeFile(
      join(root, "hand-authored.md"),
      "---\ntype: gotcha\ntags: [mage]\n---\n# My own root note\nauthored by hand, not a capture.\n",
    );

    // Recall: index emits MEMORY.md listing the captures.
    expect((await runMage(["index"], { cwd: dir })).code).toBe(0);
    const memory = await readFile(join(root, "MEMORY.md"), "utf8");
    expect(memory).toMatch(/DB pool exhaustion/i);

    // Groom: ingest the inbox + surface.
    const surfaced = JSON.parse((await runMage(["groom", "--json"], { cwd: dir })).stdout);
    expect(surfaced.ingested).toEqual(expect.arrayContaining(["db-pool-exhaustion", "oncall-contact"]));
    expect(surfaced.ingestCovered).toBe(1); // redis capture covered → archived, not staged
    expect(existsSync(join(root, "db-pool-exhaustion.md"))).toBe(false); // moved out of the inbox
    expect(existsSync(join(root, "redis-cache-ttl.md"))).toBe(false); // covered → archived
    expect(existsSync(join(root, "hand-authored.md"))).toBe(true); // not a capture → untouched
    // covered capture is recoverable, never destroyed:
    expect(existsSync(join(root, ".mage", "staging", ".covered", "redis-cache-ttl.md"))).toBe(true);
    // PII scrubbed at the backstop in the staged draft:
    const stagedOncall = await readFile(join(root, ".mage", "staging", "oncall-contact.md"), "utf8");
    expect(stagedOncall).toContain("[REDACTED:email]");
    expect(stagedOncall).not.toContain("oncall@acme-example.com");

    // Accept all: promote to notes/ with a provenance stamp.
    const accepted = JSON.parse((await runMage(["groom", "--accept", "all", "--json"], { cwd: dir })).stdout);
    expect(accepted.accepted).toEqual(expect.arrayContaining(["notes/db-pool-exhaustion.md", "notes/oncall-contact.md"]));
    const note = await readFile(join(root, "notes", "db-pool-exhaustion.md"), "utf8");
    expect(note).toContain("# DB pool exhaustion under load");
    expect(note).toContain("provenance");
    expect(note).toContain("cc-session:sess-1");
    expect(existsSync(join(root, "notes", "redis-cache-ttl.md"))).toBe(false); // covered → never promoted

    // Recall reflects the promotions.
    expect(await readFile(join(root, "MEMORY.md"), "utf8")).toMatch(/Oncall contact/i);

    // Idempotent: nothing left in the inbox to ingest.
    const rerun = JSON.parse((await runMage(["groom", "--json"], { cwd: dir })).stdout);
    expect(rerun.ingested).toBeUndefined();
    expect(rerun.pending).toBe(0);
  });

  it("--accept --json emits a clean single JSON line (no human-log leak on stdout)", async () => {
    const { dir, root } = await initKb();
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "x-capture.md"), gate0Capture({ body: "# X capture\n\na distinct body." }));
    await runMage(["groom"], { cwd: dir }); // ingest
    const { stdout } = await runMage(["groom", "--accept", "all", "--json"], { cwd: dir });
    // Exactly one parseable JSON line — index()'s "Indexed …" lines must not leak in.
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").accepted).toContain("notes/x-capture.md");
  });
});
