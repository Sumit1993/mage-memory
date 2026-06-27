import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNote } from "../../note.js";
import { exists, stagingPath } from "../../paths.js";
import { withKb } from "../../../test/fixtures/kb.js";
import { ingestCaptureInbox, isCaptureInboxNote, mapInboxNote } from "./inbox.js";

// The live 2026-06-27 spike's on-disk shape: CC renormalized the frontmatter
// (blanked `name`, moved the mage type/created under `metadata`), but the
// Gate-0-scrubbed-and-shaped body survived.
function gate0Capture(opts: { type?: string; session?: string; body: string } = { body: "" }): string {
  const meta = [
    "  node_type: memory",
    `  type: ${opts.type ?? "note"}`,
    "  created: 2026-06-27",
    ...(opts.session ? [`  originSessionId: ${opts.session}`] : []),
  ].join("\n");
  return `---\nname: ""\nmetadata:\n${meta}\n---\n\n${opts.body}\n`;
}

describe("isCaptureInboxNote", () => {
  it("matches CC's metadata.node_type: memory discriminator", () => {
    expect(isCaptureInboxNote({ metadata: { node_type: "memory" } } as never)).toBe(true);
  });
  it("rejects a hand-authored mage note (no node_type)", () => {
    expect(isCaptureInboxNote({ type: "gotcha", tags: ["mage"] } as never)).toBe(false);
    expect(isCaptureInboxNote({ metadata: { node_type: "other" } } as never)).toBe(false);
    expect(isCaptureInboxNote({} as never)).toBe(false);
  });
});

describe("mapInboxNote", () => {
  it("maps the post-renormalization shape without double-folding", () => {
    const fm = { name: "", metadata: { node_type: "memory", type: "pointer", created: "2026-06-27", originSessionId: "abc-123" } };
    const body = "# Billing runbook\n\nWhere the deploy runbook lives\n\nDeploy runbook at docs/deploy.md.";
    const { frontmatter, body: out } = mapInboxNote(fm as never, body, "billing-runbook");

    expect(frontmatter.type).toBe("pointer");
    expect(frontmatter.created).toBe("2026-06-27");
    expect(frontmatter.sources).toEqual(["cc-session:abc-123"]);
    // CC junk stripped — no name/metadata/node_type leaks into the mage note.
    expect((frontmatter as Record<string, unknown>).name).toBeUndefined();
    expect((frontmatter as Record<string, unknown>).metadata).toBeUndefined();
    // The single H1 + single description line survive; nothing is folded twice.
    expect(out.match(/# Billing runbook/g)).toHaveLength(1);
    expect(out.match(/Where the deploy runbook lives/g)).toHaveLength(1);
  });

  it("folds a top-level description and rewrites wikilinks for a raw native file", () => {
    const fm = { name: "wsl-gotcha", description: "one-liner summary", metadata: { node_type: "memory", type: "reference", originSessionId: "xyz" } };
    const body = "Body that links [[other note]].";
    const { frontmatter, body: out } = mapInboxNote(fm as never, body, "wsl-gotcha");

    expect(frontmatter.type).toBe("pointer"); // reference → pointer
    expect(out).toContain("# Wsl gotcha"); // H1 from the de-kebab'd name (no body H1)
    expect(out).toContain("one-liner summary"); // description folded in
    expect(out).toContain("[other note](other-note.md)"); // wikilink rewritten
  });

  it("does not re-fold a description already present in the body", () => {
    const fm = { name: "x", description: "already here", metadata: { node_type: "memory" } };
    const body = "# X\n\nalready here\n\nrest of the note.";
    const { body: out } = mapInboxNote(fm as never, body, "x");
    expect(out.match(/already here/g)).toHaveLength(1);
  });
});

describe("ingestCaptureInbox", () => {
  async function writeRoot(root: string, name: string, content: string): Promise<void> {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, name), content);
  }

  it("moves a Gate-0 capture from the root into staging as a clean draft", async () => {
    const { root } = await withKb();
    await writeRoot(root, "deploy-runbook.md", gate0Capture({ type: "pointer", session: "sess-1", body: "# Deploy runbook\n\nWhere it lives\n\nAt docs/deploy.md." }));

    const r = await ingestCaptureInbox(root);
    expect(r.ingested).toHaveLength(1);
    expect(r.ingested[0]?.slug).toBe("deploy-runbook");

    // The root inbox file is GONE (moved), and a staged draft exists.
    expect(await exists(join(root, "deploy-runbook.md"))).toBe(false);
    const stagedPath = join(stagingPath(root), "deploy-runbook.md");
    expect(await exists(stagedPath)).toBe(true);

    // The staged draft is clean mage schema — CC frontmatter stripped.
    const { frontmatter, body } = parseNote(await readFile(stagedPath, "utf8"));
    expect(frontmatter.type).toBe("pointer");
    expect((frontmatter as Record<string, unknown>).metadata).toBeUndefined();
    expect((frontmatter as Record<string, unknown>).name).toBeUndefined();
    expect(frontmatter.sources).toEqual(["cc-session:sess-1"]);
    expect(body).toContain("# Deploy runbook");
  });

  it("leaves generated artifacts and hand-authored root notes untouched", async () => {
    const { root } = await withKb();
    await writeRoot(root, "INDEX.md", "<!-- GENERATED -->\n# Index\n");
    await writeRoot(root, "MEMORY.md", "<!-- GENERATED -->\n# Index\n");
    await writeRoot(root, "hand-authored.md", "---\ntype: gotcha\ntags: [mage]\n---\n# Mine\n");

    const r = await ingestCaptureInbox(root);
    expect(r.ingested).toHaveLength(0);
    expect(await exists(join(root, "INDEX.md"))).toBe(true);
    expect(await exists(join(root, "MEMORY.md"))).toBe(true);
    expect(await exists(join(root, "hand-authored.md"))).toBe(true);
  });

  it("scrubs secrets at the backstop for a raw (never-Gate-0'd) capture", async () => {
    const { root } = await withKb();
    const raw = "---\nname: leak\nmetadata:\n  node_type: memory\n---\n# Leak\n\nOn-call: oncall@acme-example.com\n";
    await writeRoot(root, "leak.md", raw);

    const r = await ingestCaptureInbox(root);
    expect(r.ingested).toHaveLength(1);
    expect(r.ingested[0]?.masked).toBeGreaterThan(0);
    const staged = await readFile(join(stagingPath(root), "leak.md"), "utf8");
    expect(staged).toContain("[REDACTED:email]");
    expect(staged).not.toContain("oncall@acme-example.com");
  });

  it("drops a capture an existing committed note already covers (ADR-0032 §4 covered-arm)", async () => {
    const { root } = await withKb();
    // A committed note that covers the capture's keywords.
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(
      join(root, "notes", "covers.md"),
      "---\ntype: gotcha\nkeywords: [alpha, beta, gamma, delta]\n---\n# Covers it\n",
    );
    await writeRoot(root, "dup.md", gate0Capture({ body: "# Alpha beta\n\nalpha beta gamma delta lesson again." }));

    const r = await ingestCaptureInbox(root);
    expect(r.ingested).toHaveLength(0);
    expect(r.covered).toHaveLength(1);
    expect(r.covered[0]?.by).toBe("notes/covers.md");
    // Out of the active batch: gone from root, NOT staged...
    expect(await exists(join(root, "dup.md"))).toBe(false);
    expect(await exists(join(stagingPath(root), "dup.md"))).toBe(false);
    // ...but ARCHIVED, never destroyed (recoverable, scrubbed).
    expect(await exists(join(stagingPath(root), ".covered", "dup.md"))).toBe(true);
  });

  it("re-ingest is idempotent when a staged capture's root file lingers (no -2 duplicate)", async () => {
    const { root } = await withKb();
    await writeRoot(root, "lingering.md", gate0Capture({ session: "sess-keep", body: "# Lingering\n\na capture whose source file survives." }));
    const first = await ingestCaptureInbox(root);
    expect(first.ingested).toHaveLength(1);

    // Simulate a post-write rm that failed: the source file is back at the root.
    await writeRoot(root, "lingering.md", gate0Capture({ session: "sess-keep", body: "# Lingering\n\na capture whose source file survives." }));
    const second = await ingestCaptureInbox(root);
    // Same cc-session is already staged → skipped, not re-staged as lingering-2.
    expect(second.ingested).toHaveLength(0);
    expect(await exists(join(stagingPath(root), "lingering-2.md"))).toBe(false);
    expect(await exists(join(root, "lingering.md"))).toBe(false); // rm retried successfully
  });

  it("de-collides a slug against an existing staged draft", async () => {
    const { root } = await withKb();
    await mkdir(stagingPath(root), { recursive: true });
    await writeFile(join(stagingPath(root), "topic.md"), "---\ntype: gotcha\n---\n# Topic\n");
    await writeRoot(root, "topic.md", gate0Capture({ body: "# Topic\n\na distinct fresh capture." }));

    const r = await ingestCaptureInbox(root);
    expect(r.ingested).toHaveLength(1);
    expect(r.ingested[0]?.slug).toBe("topic-2"); // de-collided
    expect(await exists(join(stagingPath(root), "topic-2.md"))).toBe(true);
  });

  it("is a clean no-op when the root has no captures", async () => {
    const { root } = await withKb();
    await mkdir(root, { recursive: true });
    const r = await ingestCaptureInbox(root);
    expect(r).toEqual({ ingested: [], covered: [] });
  });

  it("skips an unparseable inbox file without aborting the batch", async () => {
    const { root } = await withKb();
    await writeRoot(root, "bad.md", "---\nnot: [valid: yaml\n---\n# Bad\n");
    await writeRoot(root, "good.md", gate0Capture({ body: "# Good\n\na good distinct capture." }));

    const r = await ingestCaptureInbox(root);
    // The good one still ingests; the bad one is left in place.
    expect(r.ingested.map((i) => i.slug)).toContain("good");
    const remaining = (await readdir(root)).filter((n) => n.endsWith(".md"));
    expect(remaining).toContain("bad.md");
  });
});
