import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import { exists } from "../paths.js";
import { adopt } from "./adopt.js";

const SECRET = "AKIAIOSFODNN7EXAMPLE"; // canonical AWS access-key id → secret severity

/** A CC native (post-renormalization) in-shape capture. */
function nativeCapture(opts: { type?: string; session?: string; body: string }): string {
  return [
    "---",
    'name: ""',
    "metadata:",
    "  node_type: memory",
    `  type: ${opts.type ?? "gotcha"}`,
    "  created: 2026-06-27",
    ...(opts.session ? [`  originSessionId: ${opts.session}`] : []),
    "---",
    "",
    opts.body,
    "",
  ].join("\n");
}

/** Lay a `~/.claude/projects/<slug>/memory/*.md` dir whose transcript records `cwd`. */
async function ccProject(
  home: string,
  slug: string,
  cwd: string | null,
  files: Record<string, string>,
): Promise<void> {
  const projectDir = join(home, "projects", slug);
  const memDir = join(projectDir, "memory");
  await mkdir(memDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(memDir, name), body);
  if (cwd) await writeFile(join(projectDir, "s.jsonl"), `${JSON.stringify({ cwd })}\n`);
}

describe("adopt", () => {
  it("places an in-shape capture for THIS KB into its inbox, scrubbing secrets", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    await ccProject(home, "-slug", kb.repo, {
      "deploy.md": nativeCapture({ type: "pointer", session: "sess-A", body: `# Deploy\n\nkey ${SECRET} lives in CI.` }),
    });

    const r = await adopt({ dir: kb.repo, home, yes: true });

    expect(r.applied).toBe(true);
    expect(r.placed.map((p) => p.slug)).toEqual(["deploy"]);
    expect(r.placed[0]?.masked).toBeGreaterThan(0);

    const dest = join(kb.root, "deploy.md");
    expect(await exists(dest)).toBe(true);
    const written = await readFile(dest, "utf8");
    expect(written).toContain("[REDACTED");
    expect(written).not.toContain(SECRET);
    // Copy, never move — CC's original is untouched.
    expect(await exists(join(home, "projects", "-slug", "memory", "deploy.md"))).toBe(true);
  });

  it("reports memories that belong to a DIFFERENT KB as elsewhere (per-KB default)", async () => {
    const kb = await withKb();
    const other = await withKb();
    const home = await tmpDir("cc-home");
    await ccProject(home, "-other", other.repo, { "x.md": nativeCapture({ session: "s", body: "# X\n\nlesson." }) });

    const r = await adopt({ dir: kb.repo, home, yes: true });

    expect(r.placed).toHaveLength(0);
    expect(r.elsewhere).toHaveLength(1);
    expect(r.elsewhere[0]?.kbRoot).toBe(other.root);
    expect(await exists(join(kb.root, "x.md"))).toBe(false);
  });

  it("--all sweeps every KB: places a foreign memory into ITS OWN root", async () => {
    const kb = await withKb();
    const other = await withKb();
    const home = await tmpDir("cc-home");
    await ccProject(home, "-other", other.repo, { "x.md": nativeCapture({ session: "s", body: "# X\n\nlesson." }) });

    const r = await adopt({ dir: kb.repo, home, yes: true, all: true });

    expect(r.placed.map((p) => p.targetRoot)).toEqual([other.root]);
    expect(await exists(join(other.root, "x.md"))).toBe(true);
  });

  it("surfaces unclaimed memories (unknown cwd / origin has no KB) — never dropped", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    const noKb = await tmpDir("no-kb");
    await ccProject(home, "-nocwd", null, { "a.md": nativeCapture({ body: "# A\n\nx." }) });
    await ccProject(home, "-nokb", noKb, { "b.md": nativeCapture({ body: "# B\n\ny." }) });

    const r = await adopt({ dir: kb.repo, home, yes: true });

    expect(r.placed).toHaveLength(0);
    const reasons = r.unclaimed.map((u) => u.reason).sort();
    expect(reasons).toEqual(["origin-has-no-kb", "unknown-cwd"]);
  });

  it("reports an out-of-shape memory to distill — never copies it verbatim", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    await ccProject(home, "-slug", kb.repo, { "freeform.md": "# Meeting notes\n\nraw prose, no frontmatter.\n" });

    const r = await adopt({ dir: kb.repo, home, yes: true });

    expect(r.placed).toHaveLength(0);
    expect(r.distill.map((d) => d.slug)).toEqual(["freeform"]);
    expect(await exists(join(kb.root, "freeform.md"))).toBe(false);
  });

  it("dry-run computes the plan but writes nothing", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    await ccProject(home, "-slug", kb.repo, { "d.md": nativeCapture({ session: "s", body: "# D\n\nx." }) });

    const r = await adopt({ dir: kb.repo, home, dryRun: true });

    expect(r.applied).toBe(false);
    expect(r.placed).toHaveLength(1);
    expect(await exists(join(kb.root, "d.md"))).toBe(false);
  });

  it("is idempotent: a second run skips a capture already in the inbox", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    await ccProject(home, "-slug", kb.repo, { "d.md": nativeCapture({ session: "s", body: "# D\n\nx." }) });

    const first = await adopt({ dir: kb.repo, home, yes: true });
    expect(first.placed).toHaveLength(1);
    // The placed-but-ungroomed inbox file is seen by the cc-session identity guard,
    // so a re-run skips it (and does NOT create a `d-2.md` duplicate).
    const second = await adopt({ dir: kb.repo, home, yes: true });
    expect(second.placed).toHaveLength(0);
    expect(second.skipped.map((s) => s.reason)).toContain("already adopted (cc-session)");
    expect(await exists(join(kb.root, "d-2.md"))).toBe(false);
  });

  it("de-collides distinct memories that share a basename — never overwrites (data-safety)", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    // Two CC dirs (the duplicate-slug case) both resolve to THIS KB, each holding a
    // DISTINCT memory that happens to be named `note.md`. Both must survive.
    await ccProject(home, "-org", kb.repo, {
      "note.md": nativeCapture({ session: "s1", body: "# Note one\n\nthe FIRST distinct lesson." }),
    });
    await ccProject(home, "-org-sub", kb.repo, {
      "note.md": nativeCapture({ session: "s2", body: "# Note two\n\nthe SECOND distinct lesson." }),
    });

    const r = await adopt({ dir: kb.repo, home, yes: true });

    expect(r.placed).toHaveLength(2);
    expect(r.placed.map((p) => p.slug).sort()).toEqual(["note", "note-2"]);
    // Both bodies are on disk — neither overwrote the other.
    const a = await readFile(join(kb.root, "note.md"), "utf8");
    const b = await readFile(join(kb.root, "note-2.md"), "utf8");
    expect(`${a}${b}`).toContain("FIRST distinct lesson");
    expect(`${a}${b}`).toContain("SECOND distinct lesson");
  });

  it("is idempotent against an already-accepted note (cc-session identity, not session-id alone)", async () => {
    const kb = await withKb();
    const home = await tmpDir("cc-home");
    // A committed note carries cc-session:sess-A under slug `kept`.
    await mkdir(join(kb.root, "notes"), { recursive: true });
    await writeFile(
      join(kb.root, "notes", "kept.md"),
      "---\ntype: gotcha\ntags: [w/r]\nsources: [cc-session:sess-A]\nlast_reviewed: 2026-06-27\n---\n# Kept\n",
    );
    // Same session writes a DISTINCT sibling `fresh` — must still adopt (no sibling-drop).
    await ccProject(home, "-slug", kb.repo, {
      "kept.md": nativeCapture({ session: "sess-A", body: "# Kept\n\nalready accepted." }),
      "fresh.md": nativeCapture({ session: "sess-A", body: "# Fresh\n\na distinct sibling lesson." }),
    });

    const r = await adopt({ dir: kb.repo, home, yes: true });

    expect(r.placed.map((p) => p.slug)).toEqual(["fresh"]);
    expect(r.skipped.some((s) => s.slug === "kept" && s.reason.includes("already adopted"))).toBe(true);
  });
});
