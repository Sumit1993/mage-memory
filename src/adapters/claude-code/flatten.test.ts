import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { withKb } from "../../../test/fixtures/kb.js";
import { run } from "../../shell.js";
import { flattenCcNote, flattenStagedNotes, flattenWorktreeNotes, isCcShaped } from "./flatten.js";
import { parseNote } from "../../note.js";

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A fresh CC capture: nested metadata, name/description, an Obsidian wikilink. */
const CC_FRESH = [
  "---",
  "name: wsl-rancher-gotcha",
  "description: Rancher needs the moby engine.",
  "metadata:",
  "  node_type: memory",
  "  type: reference",
  "  originSessionId: abc-123",
  "---",
  "See [[other note]] for context.",
  "",
].join("\n");

/** A groomed mage note CC later RE-restamped: real mage fields + a CC metadata wrapper. */
const GROOMED_RESTAMPED = [
  "---",
  "type: gotcha",
  "tags: [mage/build]",
  'created: "2026-06-01"',
  "status: active",
  "provenance:",
  "  repo: mage-memory",
  "  work: some-work",
  "name: typecheck-gotcha",
  "metadata:",
  "  node_type: memory",
  "  originSessionId: sess-9",
  "---",
  "# Typecheck gotcha",
  "",
  "Body content here.",
  "",
].join("\n");

/** A hand-authored mage note — no CC metadata; an intentional Obsidian wikilink. */
const PLAIN = ["---", "type: gotcha", "tags: [mage/build]", "---", "# A note", "", "With [[an obsidian link]] kept.", ""].join(
  "\n",
);

async function initRepo(dir: string): Promise<void> {
  await run("git", ["-C", dir, "init", "--quiet"], { throwOnError: true });
  await run("git", ["-C", dir, "config", "user.email", "test@example.com"], { throwOnError: true });
  await run("git", ["-C", dir, "config", "user.name", "Test"], { throwOnError: true });
}

async function addFile(dir: string, name: string, content: string): Promise<void> {
  const abs = join(dir, name);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await run("git", ["-C", dir, "add", name], { throwOnError: true });
}

/** The staged (index) blob of a repo-relative file. */
async function stagedBlob(dir: string, name: string): Promise<string> {
  const r = await run("git", ["-C", dir, "show", `:${name}`]);
  return r.stdout;
}

// ─── flattenCcNote (the pure keystone) ─────────────────────────────────────────

describe("flattenCcNote", () => {
  it("flattens a fresh CC capture's frontmatter to mage's flat schema, body verbatim", () => {
    const { text, changed } = flattenCcNote(CC_FRESH);
    expect(changed).toBe(true);
    // CC-only frontmatter keys gone.
    expect(text).not.toContain("node_type");
    expect(text).not.toMatch(/^metadata:/m);
    expect(text).not.toMatch(/^name:/m);
    expect(text).not.toMatch(/^description:/m);
    // metadata.type "reference" → mage "pointer"; session → a cc-session source.
    expect(text).toContain("type: pointer");
    expect(text).toContain("cc-session:abc-123");
    // Body is preserved VERBATIM — the wikilink is NOT rewritten (Obsidian-native, ADR-0008),
    // and flatten does not synthesize an H1 or fold the description (that is the ingest path's job).
    expect(text).toContain("See [[other note]] for context.");
    expect(text).not.toContain("[other note](other-note.md)");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = flattenCcNote(CC_FRESH);
    const twice = flattenCcNote(once.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
    expect(isCcShaped(parseNote(once.text).frontmatter)).toBe(false);
  });

  it("preserves a groomed note's mage fields when CC re-restamps it", () => {
    const { text, changed } = flattenCcNote(GROOMED_RESTAMPED);
    expect(changed).toBe(true);
    // Existing mage type wins — NOT remapped from metadata.
    expect(text).toContain("type: gotcha");
    expect(text).toContain("mage/build");
    expect(text).toContain("created:");
    expect(text).toContain("status: active");
    expect(text).toContain("provenance:");
    expect(text).toContain("cc-session:sess-9");
    // CC cruft dropped; the authored body (and its H1) preserved.
    expect(text).not.toContain("node_type");
    expect(text).not.toMatch(/^name:/m);
    expect(text).toContain("# Typecheck gotcha");
    expect(text).toContain("Body content here.");
  });

  it("RECOVERS every mage field CC buried under metadata (the live aggressive-restamp shape)", () => {
    // CC's observed restamp nests the WHOLE authored frontmatter under metadata and
    // blanks name. flatten must recover tags/last_reviewed/status/sources/keywords —
    // not just type/created — or the durable note silently loses them.
    const fullyRestamped = [
      "---",
      'name: ""',
      "metadata:",
      "  node_type: memory",
      "  type: reference",
      "  tags:",
      "    - mage/roadmap",
      '  created: "2026-06-01"',
      '  last_reviewed: "2026-06-02"',
      "  status: active",
      "  sources:",
      "    - file:~/x.md",
      "  keywords:",
      "    - alpha",
      "    - beta",
      "  originSessionId: sess-xyz",
      "---",
      "# Real title",
      "",
      "Body with a [[wikilink]].",
      "",
    ].join("\n");
    const { text, changed } = flattenCcNote(fullyRestamped);
    expect(changed).toBe(true);
    const fm = parseNote(text).frontmatter;
    expect(fm.type).toBe("pointer"); // metadata.type reference → mage pointer
    expect(fm.tags).toEqual(["mage/roadmap"]); // recovered, not dropped
    expect(fm.created).toBe("2026-06-01");
    expect(fm.last_reviewed).toBe("2026-06-02");
    expect(fm.status).toBe("active");
    expect(fm.sources).toEqual(["file:~/x.md", "cc-session:sess-xyz"]);
    expect(fm.keywords).toEqual(["alpha", "beta"]);
    expect(text).not.toContain("node_type");
    expect(text).not.toMatch(/^name:/m);
    expect(text).toContain("Body with a [[wikilink]]."); // body untouched
  });

  it("leaves a hand-authored mage note (and its Obsidian wikilinks) untouched", () => {
    const { text, changed } = flattenCcNote(PLAIN);
    expect(changed).toBe(false);
    expect(text).toBe(PLAIN);
    expect(text).toContain("[[an obsidian link]]"); // an authored wikilink is NOT rewritten
  });

  it("preserves intentional [[wikilinks]] when CC restamps an AUTHORED note (the ADR Gate's KILL guard)", () => {
    // CC restamps authored notes with metadata.node_type:memory; flatten must strip the
    // wrapper WITHOUT mangling the deliberate cross-folder wikilinks in the body.
    const authoredRestamped = [
      "---",
      "type: decision",
      "tags: [mage/decisions]",
      "metadata:",
      "  node_type: memory",
      "---",
      "# 0035 — notes are memories",
      "",
      "See the charter [[mage-is-durable-memory]] and a `[[wikilink]]` example in prose.",
      "",
    ].join("\n");
    const { text, changed } = flattenCcNote(authoredRestamped);
    expect(changed).toBe(true);
    expect(text).not.toContain("node_type");
    expect(text).toContain("type: decision");
    // The body — including BOTH wikilinks — is byte-for-byte intact.
    expect(text).toContain("See the charter [[mage-is-durable-memory]] and a `[[wikilink]]` example in prose.");
  });

  it("keeps a created date even when YAML parsed it as an unquoted Date object", () => {
    const unquotedDate = [
      "---",
      "name: x",
      "created: 2026-06-01", // unquoted → YAML 1.1 parses a Date, not a string
      "metadata:",
      "  node_type: memory",
      "---",
      "body",
      "",
    ].join("\n");
    const { text } = flattenCcNote(unquotedDate);
    expect(text).toContain("created:");
    expect(text).toContain("2026-06-01");
  });

  it("fails open on malformed frontmatter (returns the input unchanged)", () => {
    const broken = `---\nname: "unterminated\nmetadata: [oops\n---\nbody\n`;
    const { text, changed } = flattenCcNote(broken);
    expect(changed).toBe(false);
    expect(text).toBe(broken);
  });
});

// ─── flattenStagedNotes (the commit-time gate) ─────────────────────────────────

describe("flattenStagedNotes", () => {
  it("flattens a staged CC-shaped note under the docs root and re-stages it", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/wsl-rancher-gotcha.md", CC_FRESH);

    const res = await flattenStagedNotes(dir);

    expect(res.flattened).toContain("mage/wsl-rancher-gotcha.md");
    // The STAGED blob (what a commit writes) is now neutral.
    const blob = await stagedBlob(dir, "mage/wsl-rancher-gotcha.md");
    expect(blob).not.toContain("node_type");
    expect(blob).toContain("type: pointer");
    // The worktree was flattened too — clean status, no phantom-modified note.
    const onDisk = await readFile(join(dir, "mage/wsl-rancher-gotcha.md"), "utf8");
    expect(onDisk).toBe(blob);
  });

  it("leaves a hand-authored mage note untouched (no-op for normal commits)", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/notes/plain.md", PLAIN);

    const res = await flattenStagedNotes(dir);

    expect(res.flattened).toHaveLength(0);
    expect(await stagedBlob(dir, "mage/notes/plain.md")).toBe(PLAIN);
  });

  it("flattens a partially-staged CC note in the INDEX ONLY — neutral commit, worktree edits intact", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/half.md", CC_FRESH);
    // An unstaged worktree edit on top of the staged version → partially staged.
    await writeFile(join(dir, "mage/half.md"), `${CC_FRESH}\nextra unstaged line\n`);

    const res = await flattenStagedNotes(dir);

    // The guarantee holds even for a dirty file: the staged (durable) blob is neutral...
    expect(res.flattened).toContain("mage/half.md");
    const blob = await stagedBlob(dir, "mage/half.md");
    expect(blob).not.toContain("node_type");
    expect(blob).toContain("type: pointer");
    // ...while the unstaged worktree edit is left completely intact (not clobbered).
    const onDisk = await readFile(join(dir, "mage/half.md"), "utf8");
    expect(onDisk).toContain("extra unstaged line");
    expect(onDisk).toContain("node_type: memory"); // worktree untouched
  });

  it("round-trips a large multibyte note via the index path without corruption (run() chunk fix)", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    // A body large enough to arrive in multiple pipe reads, full of 3-byte chars whose
    // boundaries will straddle chunk edges if decoded per-chunk → U+FFFD corruption.
    const bigBody = "日本語のメモ ".repeat(20000); // ~300KB of multibyte content
    const note = `---\nname: big\nmetadata:\n  node_type: memory\n---\n${bigBody}\n`;
    await addFile(dir, "mage/big.md", note);
    // Make it dirty so flatten reads the staged blob via `git show` (the run() path).
    await writeFile(join(dir, "mage/big.md"), `${note}\nunstaged\n`);

    const res = await flattenStagedNotes(dir);

    expect(res.flattened).toContain("mage/big.md");
    const blob = await stagedBlob(dir, "mage/big.md");
    expect(blob).not.toContain("�"); // no replacement chars from a split multibyte read
    expect(blob).toContain(bigBody.trim()); // the multibyte body survived intact
  });

  it("fails open on a non-repo path", async () => {
    const { dir } = await withKb(); // a KB but NOT a git repo
    const res = await flattenStagedNotes(dir);
    expect(res).toEqual({ flattened: [] });
  });
});

describe("flattenWorktreeNotes (the Stop sweep)", () => {
  it("flattens a tracked note CC restamped in the worktree + a new untracked capture", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    // A note committed flat, then CC restamps the worktree copy (cc-shape).
    await addFile(dir, "mage/tracked.md", PLAIN);
    await run("git", ["-C", dir, "commit", "-q", "-m", "init"], { throwOnError: true });
    await writeFile(join(dir, "mage/tracked.md"), CC_FRESH);
    // A brand-new untracked capture.
    await writeFile(join(dir, "mage/untracked.md"), CC_FRESH);

    const res = await flattenWorktreeNotes(dir);

    expect(res.flattened.sort()).toEqual(["mage/tracked.md", "mage/untracked.md"]);
    // Worktree files are now neutral (no staging — Stop is not commit time).
    expect(await readFile(join(dir, "mage/tracked.md"), "utf8")).not.toContain("node_type");
    expect(await readFile(join(dir, "mage/untracked.md"), "utf8")).toContain("type: pointer");
  });

  it("leaves a clean tracked non-cc note untouched", async () => {
    const { dir } = await withKb();
    await initRepo(dir);
    await addFile(dir, "mage/plain.md", PLAIN);
    await run("git", ["-C", dir, "commit", "-q", "-m", "init"], { throwOnError: true });

    const res = await flattenWorktreeNotes(dir);
    expect(res.flattened).toHaveLength(0);
  });

  it("fails open on a non-repo path", async () => {
    const { dir } = await withKb();
    expect(await flattenWorktreeNotes(dir)).toEqual({ flattened: [] });
  });
});
