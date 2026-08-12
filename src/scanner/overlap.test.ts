import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withKb } from "../../test/fixtures/kb.js";
import { detectMergeCandidates } from "./overlap.js";
import { readNote } from "../note.js";

/** Write a note at `notes/<rel>` under the KB root. */
async function note(root: string, rel: string, content: string): Promise<void> {
  const p = join(root, "notes", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, content);
}

describe("overlap — Signal A (structural: mutual links + shared room)", () => {
  it("detects two notes that link each other AND share a wing/room tag", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    await note(root, "a.md", [
      "---",
      "type: gotcha",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Note A",
      "",
      "See [B](b.md) for the flip side.",
      "",
    ].join("\n"));
    await note(root, "b.md", [
      "---",
      "type: gotcha",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Note B",
      "",
      "See [A](a.md) for the flip side.",
      "",
    ].join("\n"));

    const notes = await readAllNotes(root, ["notes/a.md", "notes/b.md"]);
    const result = detectMergeCandidates(notes);
    expect(result.signalA.length).toBe(1);
    expect(result.signalA[0]!.noteA).toBe("notes/a.md");
    expect(result.signalA[0]!.noteB).toBe("notes/b.md");
  });

  it("does NOT detect two notes linking each other in DIFFERENT rooms", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    await note(root, "a.md", [
      "---",
      "type: gotcha",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Note A",
      "",
      "See [B](b.md).",
    ].join("\n"));
    await note(root, "b.md", [
      "---",
      "type: gotcha",
      "tags: [eng/deploy]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Note B",
      "",
      "See [A](a.md).",
    ].join("\n"));

    const notes = await readAllNotes(root, ["notes/a.md", "notes/b.md"]);
    const result = detectMergeCandidates(notes);
    expect(result.signalA).toEqual([]);
  });

  it("does NOT detect a one-way link (A→B but B does not link A)", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    await note(root, "a.md", [
      "---",
      "type: gotcha",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Note A",
      "",
      "See [B](b.md).",
    ].join("\n"));
    await note(root, "b.md", [
      "---",
      "type: gotcha",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Note B",
      "",
      "Standalone note, no links.",
    ].join("\n"));

    const notes = await readAllNotes(root, ["notes/a.md", "notes/b.md"]);
    const result = detectMergeCandidates(notes);
    expect(result.signalA).toEqual([]);
  });
});

describe("overlap — Signal B (lexical: TF-IDF cosine over bodies)", () => {
  it("scores two notes on the same subject above threshold", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    // Two notes that both discuss database connection pooling in detail
    await note(root, "pooling-gotcha.md", [
      "---",
      "type: gotcha",
      "tags: [eng/db]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Database Connection Pooling Gotcha",
      "",
      "When configuring the database connection pool, make sure the maximum pool size",
      "matches the number of concurrent database queries your application needs.",
      "A misconfigured connection pool leads to connection exhaustion under load.",
      "The pool manager recycles idle connections after a timeout period.",
      "Always set a connection timeout to avoid hanging queries in the pool.",
      "Monitor the pool usage metrics to detect connection pool saturation early.",
    ].join("\n"));
    await note(root, "pooling-procedure.md", [
      "---",
      "type: procedure",
      "tags: [eng/db]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Setting Up Database Connection Pooling",
      "",
      "Configure the database connection pool with these parameters:",
      "Set the maximum pool size based on expected concurrent database queries.",
      "Adjust the connection timeout to match your database latency profile.",
      "The pool manager should recycle connections that have been idle too long.",
      "Enable connection pool metrics collection for monitoring pool saturation.",
      "If the pool runs out of connections, new queries will queue or fail.",
    ].join("\n"));

    const notes = await readAllNotes(root, ["notes/pooling-gotcha.md", "notes/pooling-procedure.md"]);
    const result = detectMergeCandidates(notes);
    expect(result.signalB.length).toBeGreaterThan(0);
  });

  it("does NOT score two unrelated notes as similar", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    await note(root, "network.md", [
      "---",
      "type: gotcha",
      "tags: [eng/network]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Network Firewall Rules",
      "",
      "Firewall rules must allow ingress traffic on port 443 for HTTPS.",
      "Configure egress rules to whitelist outbound API endpoints.",
      "Security groups are stateful so return traffic is automatically allowed.",
      "Network ACLs are stateless and require explicit inbound and outbound rules.",
    ].join("\n"));
    await note(root, "css.md", [
      "---",
      "type: procedure",
      "tags: [eng/frontend]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# CSS Grid Layout Patterns",
      "",
      "Use CSS grid for two-dimensional layouts with rows and columns.",
      "The grid template defines the track sizes and line names.",
      "Flexbox is better for one-dimensional layouts along a single axis.",
      "Media queries adjust the grid columns at different breakpoints.",
    ].join("\n"));

    const notes = await readAllNotes(root, ["notes/network.md", "notes/css.md"]);
    const result = detectMergeCandidates(notes);
    expect(result.signalB).toEqual([]);
  });

  it("does NOT surface a pair whose only overlap is high-frequency mechanical tokens", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    // Both notes share mechanical tokens like "mage", "note", "run", "command"
    // but have completely different actual content
    const mechanical = (topic: string, body: string) => [
      "---",
      "type: gotcha",
      "tags: [eng/cli]",
      'last_reviewed: "2026-06-01"',
      "---",
      `# ${topic}`,
      "",
      body,
    ].join("\n");

    // Seed 6 more notes so mechanical tokens have high document frequency
    for (let i = 0; i < 6; i++) {
      await note(root, `filler-${i}.md`, mechanical(
        `Filler Note ${i}`,
        `This note describes how to run the mage command for step ${i}.\n` +
        `The command handles note creation and note indexing procedures.\n` +
        `Run mage index after editing any note file in the knowledge base.\n` +
        `Each note should have a type field and tags for proper classification.\n`,
      ));
    }
    await note(root, "deploy.md", mechanical(
      "Deploy Pipeline Setup",
      "This note describes how to run the mage command for deployment.\n" +
      "The command handles note creation and note indexing after deploy.\n" +
      "Run mage index after adding a note about the deploy pipeline.\n" +
      "Each note file must declare its type for proper classification.\n",
    ));
    await note(root, "monitoring.md", mechanical(
      "Monitoring Alerting Configuration",
      "This note describes how to run the mage command for monitoring.\n" +
      "The command handles note creation and note indexing for alerts.\n" +
      "Run mage index after editing any note about monitoring setup.\n" +
      "Each note should include a type field for classification purposes.\n",
    ));

    const paths = [
      ...Array.from({ length: 6 }, (_, i) => `notes/filler-${i}.md`),
      "notes/deploy.md",
      "notes/monitoring.md",
    ];
    const notes = await readAllNotes(root, paths);
    const result = detectMergeCandidates(notes);
    // The deploy and monitoring notes should NOT surface — their overlap is
    // mechanical tokens (mage, command, note, run, index) which IDF downweights.
    const hasPair = result.signalB.some(
      (p) =>
        (p.noteA.includes("deploy") && p.noteB.includes("monitoring")) ||
        (p.noteA.includes("monitoring") && p.noteB.includes("deploy")),
    );
    expect(hasPair).toBe(false);
  });
});

describe("overlap — genre filter", () => {
  it("excludes non-memory genres (plan, doc, decision) from both signals", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    // Two plan notes that link each other in the same room — should be excluded
    await note(root, "plan-a.md", [
      "---",
      "type: plan",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Plan A",
      "",
      "See [Plan B](plan-b.md) for the second phase.",
    ].join("\n"));
    await note(root, "plan-b.md", [
      "---",
      "type: plan",
      "tags: [eng/api]",
      'last_reviewed: "2026-06-01"',
      "---",
      "# Plan B",
      "",
      "See [Plan A](plan-a.md) for the first phase.",
    ].join("\n"));

    const notes = await readAllNotes(root, ["notes/plan-a.md", "notes/plan-b.md"]);
    const result = detectMergeCandidates(notes);
    expect(result.signalA).toEqual([]);
    expect(result.signalB).toEqual([]);
  });
});

describe("overlap — Signal B cap", () => {
  it("caps output at 5 pairs even when more qualify", async () => {
    const kb = await withKb({ kind: "repo" });
    const root = kb.root;
    // Create 12 notes that are pairwise similar — all about the same narrow topic
    const baseBody = (variant: string) => [
      `Database connection pooling ${variant} requires careful configuration.`,
      `The pool size determines maximum concurrent database connections for ${variant}.`,
      `Idle connection timeout recycles stale database connections in the ${variant} pool.`,
      `Connection pool saturation causes query failures in the ${variant} deployment.`,
      `Monitor pool metrics to detect database connection exhaustion in ${variant}.`,
      `The ${variant} service needs proper pool sizing for database reliability.`,
    ].join("\n");

    for (let i = 0; i < 12; i++) {
      await note(root, `pool-${i}.md`, [
        "---",
        "type: gotcha",
        "tags: [eng/db]",
        'last_reviewed: "2026-06-01"',
        "---",
        `# Pool Config ${i}`,
        "",
        baseBody(`variant-${i}`),
      ].join("\n"));
    }

    const paths = Array.from({ length: 12 }, (_, i) => `notes/pool-${i}.md`);
    const notes = await readAllNotes(root, paths);
    const result = detectMergeCandidates(notes);
    expect(result.signalB.length).toBeLessThanOrEqual(5);
  });
});

// ─── helper: read notes for the overlap detector ───────────────────────────

interface NoteEntry {
  relPath: string;
  type: string;
  tags: string[];
  body: string;
}

async function readAllNotes(root: string, relPaths: string[]): Promise<NoteEntry[]> {
  const entries: NoteEntry[] = [];
  for (const rel of relPaths) {
    const n = await readNote(join(root, rel));
    const tags = (n.frontmatter.tags ?? [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.replace(/^#/, "").trim());
    entries.push({
      relPath: rel,
      type: typeof n.frontmatter.type === "string" ? n.frontmatter.type : "note",
      tags,
      body: n.body,
    });
  }
  return entries;
}
