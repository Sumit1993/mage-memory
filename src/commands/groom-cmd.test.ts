import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitModule from "../git.js";
import { run } from "../shell.js";
import { exists, stagingPath } from "../paths.js";
import { parseNote } from "../note.js";
import { initRepoWithIdentity, tmpDir, withKb } from "../../test/fixtures/kb.js";
import { GROOM_LADDER_TEXT } from "../adapters/claude-code/memory-hook.js";
import { groomCmd } from "./groom-cmd.js";
import { stageCmd } from "./stage-cmd.js";

async function makeKb(): Promise<string> {
  const { dir } = await withKb();
  return dir;
}

const stagingFile = (dir: string, slug: string) => join(dir, "mage", ".staging", `${slug}.md`);
const noteFile = (dir: string, slug: string) => join(dir, "mage", "notes", `${slug}.md`);

/** Stage N distinct drafts; returns their slugs in stage order. */
async function stageDistinct(dir: string, n: number): Promise<string[]> {
  const seeds = [
    { title: "Alpha redaction rule", tags: "mage/redact", body: "alpha lesson about scrubbing" },
    { title: "Beta release dance", tags: "mage/release", body: "beta lesson about the cut" },
    { title: "Gamma index walk", tags: "mage/index", body: "gamma lesson about scanning" },
    { title: "Delta hook wiring", tags: "mage/connect", body: "delta lesson about hooks" },
    { title: "Epsilon dream applier", tags: "mage/dream", body: "epsilon lesson about applying" },
    { title: "Zeta telemetry stream", tags: "mage/telemetry", body: "zeta lesson about logs" },
    { title: "Eta benchmark cycle", tags: "mage/bench", body: "eta lesson about speed" },
  ];
  const slugs: string[] = [];
  for (const s of seeds.slice(0, n)) {
    const r = await stageCmd({ dir, ...s });
    expect(r.staged).toBe(true);
    slugs.push(r.slug!);
  }
  return slugs;
}

const ADMITTED_FM = "rung: note\ntrigger: when it matters\npointer: '[src](a.md)'\n";

async function writeAt(dir: string, rel: string, text: string): Promise<void> {
  const p = join(dir, "mage", rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, text);
}

/** Capture what a run prints to console.log. */
async function captureLog<T>(run: () => Promise<T>): Promise<{ value: T; out: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  try {
    return { value: await run(), out: lines.join("\n") };
  } finally {
    spy.mockRestore();
  }
}

describe("mage groom — the walk", () => {
  it("lists notes without a rung first, then by created ascending, missing last", async () => {
    const dir = await makeKb();
    await writeAt(dir, "notes/c-admitted-late.md", `---\ntype: gotcha\ncreated: '2026-05-01'\n${ADMITTED_FM}---\n# C late\n`);
    await writeAt(dir, "notes/b-bare-new.md", "---\ntype: gotcha\ncreated: '2026-04-01'\n---\n# B new\n");
    await writeAt(dir, "notes/a-bare-old.md", "---\ntype: gotcha\ncreated: '2026-01-01'\n---\n# A old\n");
    await writeAt(dir, "notes/d-bare-undated.md", "---\ntype: gotcha\n---\n# D undated\n");
    await writeAt(dir, "notes/e-admitted-early.md", `---\ntype: gotcha\ncreated: '2026-02-01'\n${ADMITTED_FM}---\n# E early\n`);
    const r = await groomCmd({ dir });
    expect(r.notes?.map((n) => n.relPath)).toEqual([
      "notes/a-bare-old.md",
      "notes/b-bare-new.md",
      "notes/d-bare-undated.md",
      "notes/e-admitted-early.md",
      "notes/c-admitted-late.md",
    ]);
    expect(r).toMatchObject({ shown: 5, total: 5, staged: 0 });
  });

  it("prints the exact human shape, ending with the ladder", async () => {
    const dir = await makeKb();
    await writeAt(dir, "notes/bare.md", "---\ntype: gotcha\ncreated: '2026-01-01'\n---\n# Bare note\n");
    await writeAt(
      dir,
      "notes/good.md",
      "---\ntype: gotcha\ncreated: '2026-02-01'\nrung: rule\ntrigger:\n  when: the moment\n  match: ['Bash(x *)']\npointer: '[s](a.md)'\n---\n# Good note\n",
    );
    const { out } = await captureLog(() => groomCmd({ dir }));
    expect(out.startsWith(
      [
        "mage groom: 2 of 2 notes to judge (notes without a rung come first).",
        '  1. notes/bare.md  "Bare note"  rung: -  trigger: -  pointer: -',
        '  2. notes/good.md  "Good note"  rung: rule  trigger: the moment  pointer: [s](a.md)',
        "For each note: climb (build the rung below, then delete the note), delete (stale, or a copy of a source),",
        "or keep (add rung, trigger and pointer). mage never commits: land the whole diff as one pull request.",
        "",
      ].join("\n"),
    )).toBe(true);
    expect(out.endsWith(GROOM_LADDER_TEXT)).toBe(true);
    expect(out).not.toContain("more: mage groom --all");
  });

  it("lists held writes first, tagged, from notes/.held, outside the index (#282)", async () => {
    const dir = await makeKb();
    await writeAt(dir, "notes/bare.md", "---\ntype: gotcha\ncreated: '2026-01-01'\n---\n# Bare note\n");
    await writeAt(dir, "notes/.held/sess-1-lesson.md", "# Held lesson\n\nA lesson the ladder denied once.\n");
    const { value, out } = await captureLog(() => groomCmd({ dir }));
    expect(value.notes?.map((n) => [n.relPath, n.held])).toEqual([
      ["notes/.held/sess-1-lesson.md", true],
      ["notes/bare.md", undefined],
    ]);
    expect(value.notes?.[0]).toMatchObject({ title: "Held lesson", rung: null });
    expect(out).toContain('  1. [held] notes/.held/sess-1-lesson.md  "Held lesson"');
    expect(out).toContain("[held] notes are writes the ladder denied once");
  });

  it("caps at --limit with a pointer to --all, and --all lifts the cap", async () => {
    const dir = await makeKb();
    for (let i = 0; i < 4; i++) {
      await writeAt(dir, `notes/n${i}.md`, `---\ntype: gotcha\ncreated: '2026-01-0${i + 1}'\n---\n# N${i}\n`);
    }
    const limited = await captureLog(() => groomCmd({ dir, limit: 3 }));
    expect(limited.value).toMatchObject({ shown: 3, total: 4 });
    expect(limited.out).toContain("mage groom: 3 of 4 notes to judge");
    expect(limited.out).toContain("  1 more: mage groom --all");

    const all = await groomCmd({ dir, limit: 1, all: true });
    expect(all).toMatchObject({ shown: 4, total: 4 });
  });

  it("shows ten by default", async () => {
    const dir = await makeKb();
    for (let i = 0; i < 12; i++) {
      await writeAt(dir, `notes/n${String(i).padStart(2, "0")}.md`, "---\ntype: gotcha\n---\n# N\n");
    }
    expect(await groomCmd({ dir })).toMatchObject({ shown: 10, total: 12 });
  });

  it("rejects a --limit that is not a positive integer", async () => {
    const dir = await makeKb();
    for (const limit of [0, -2, 1.5, Number.NaN]) {
      await expect(groomCmd({ dir, limit })).rejects.toThrow("mage groom: --limit takes a positive integer");
    }
  });

  it("walks a flat native-memory capture at the root and does not move it", async () => {
    const dir = await makeKb();
    const capture =
      "---\nname: user-correction\ndescription: No em dashes.\nmetadata:\n  node_type: memory\n  type: feedback\n---\nNo em dashes.\n";
    await writeAt(dir, "feedback_dashes.md", capture);
    const r = await groomCmd({ dir });
    expect(r.notes?.map((n) => n.relPath)).toEqual(["feedback_dashes.md"]);
    expect(r.notes?.[0]).toMatchObject({ rung: null, trigger: null, pointer: null });
    expect(r.notes?.[0]?.problems).toContain("rung is required");
    expect(await readFile(join(dir, "mage", "feedback_dashes.md"), "utf8")).toBe(capture);
    expect(await exists(stagingPath(join(dir, "mage")))).toBe(false);
  });

  it("never lists a decision", async () => {
    const dir = await makeKb();
    await writeAt(dir, "decisions/0001-x.md", "---\ntype: decision\nstatus: accepted\n---\n# 0001 X\n");
    await writeAt(dir, "notes/n.md", "---\ntype: gotcha\n---\n# N\n");
    const r = await groomCmd({ dir });
    expect(r.notes?.map((n) => n.relPath)).toEqual(["notes/n.md"]);
  });

  it("mentions 0.0.17 staged drafts and leaves them where they are", async () => {
    const dir = await makeKb();
    await stageDistinct(dir, 2);
    const { value, out } = await captureLog(() => groomCmd({ dir }));
    expect(value.staged).toBe(2);
    expect(out).toContain(
      "2 staged draft(s) from 0.0.17 wait in .mage/staging/: mage groom --accept|--reject <slugs|all>",
    );
  });

  it("--json prints one parseable line with the documented shape", async () => {
    const dir = await makeKb();
    await writeAt(dir, "notes/n.md", "---\ntype: gotcha\n---\n# N\n");
    const out: string[] = [];
    const log: string[] = [];
    const w = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((m: unknown) => (out.push(String(m)), true) as never);
    const l = vi.spyOn(console, "log").mockImplementation((m?: unknown) => void log.push(String(m)));
    try {
      await groomCmd({ dir, json: true });
    } finally {
      w.mockRestore();
      l.mockRestore();
    }
    expect(log).toHaveLength(0);
    const text = out.join("");
    expect(text.trim().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed)).toEqual(["notes", "shown", "total", "staged"]);
    expect(parsed.notes[0]).toMatchObject({
      relPath: "notes/n.md",
      title: "N",
      rung: null,
      trigger: null,
      pointer: null,
    });
    expect(parsed.notes[0].problems).toContain("rung is required");
  });

  it("reports an empty knowledge base", async () => {
    const dir = await makeKb();
    const { value, out } = await captureLog(() => groomCmd({ dir }));
    expect(value).toMatchObject({ notes: [], shown: 0, total: 0, staged: 0 });
    expect(out).toContain("mage groom: 0 of 0 notes to judge");
  });
});

describe("mage groom — accept", () => {
  it("promotes a named draft to notes/, re-indexes, and clears it from staging", async () => {
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1);
    const r = await groomCmd({ dir, accept: slug });
    expect(r.accepted).toEqual([`notes/${slug}.md`]);
    expect(await exists(noteFile(dir, slug!))).toBe(true);
    expect(await exists(stagingFile(dir, slug!))).toBe(false);
    // re-index ran → INDEX.md exists and lists the promoted note.
    expect(await readFile(join(dir, "mage", "INDEX.md"), "utf8")).toContain("Alpha redaction rule");
  });

  it("accepts the whole batch with 'all'", async () => {
    const dir = await makeKb();
    const slugs = await stageDistinct(dir, 2);
    const r = await groomCmd({ dir, accept: "all" });
    expect(r.accepted).toHaveLength(2);
    for (const s of slugs) expect(await exists(noteFile(dir, s))).toBe(true);
  });
});

describe("mage groom — reject", () => {
  it("discards a draft, records its key, and never re-drafts it", async () => {
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1);
    const r = await groomCmd({ dir, reject: slug });
    expect(r.rejected).toEqual([slug]);
    expect(await exists(stagingFile(dir, slug!))).toBe(false);

    // Re-staging the same lesson is now suppressed by the reject ledger.
    const again = await stageCmd({ dir, title: "Alpha redaction rule", tags: "mage/redact", body: "alpha lesson about scrubbing" });
    expect(again.staged).toBe(false);
    expect(again.reason).toBe("rejected");
  });
});

describe("mage groom — accept --json", () => {
  it("--accept all --json emits a clean single JSON line (no index logging leak)", async () => {
    // F6: index()'s 'Indexed N note(s)...' success/detail must not corrupt the --json
    // stdout contract. acceptBatch passes quiet:true to index() in json mode.
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1);

    const logs: string[] = [];
    const out: string[] = [];
    const clog = vi.spyOn(console, "log").mockImplementation((m?: unknown) => void logs.push(String(m)));
    const swrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((m: unknown) => (out.push(String(m)), true) as never);
    try {
      await groomCmd({ dir, accept: "all", json: true });
    } finally {
      clog.mockRestore();
      swrite.mockRestore();
    }
    expect(logs).toHaveLength(0); // nothing leaked to console.log (index/accept human lines)
    const parsed = JSON.parse(out.join("").trim());
    expect(parsed.accepted).toContain(`notes/${slug}.md`);
  });
});

describe("mage groom — guards", () => {
  it("refuses --accept and --reject together", async () => {
    const dir = await makeKb();
    await expect(groomCmd({ dir, accept: "a", reject: "b" })).rejects.toThrow(/one of/);
  });
  it("errors on an unknown slug", async () => {
    const dir = await makeKb();
    await stageDistinct(dir, 1);
    await expect(groomCmd({ dir, accept: "nope" })).rejects.toThrow(/no staged draft/);
  });
  it("refuses --propose without --accept", async () => {
    const dir = await makeKb();
    await expect(groomCmd({ dir, propose: true })).rejects.toThrow(/--propose requires --accept/);
  });
  it("refuses --propose with --reject", async () => {
    const dir = await makeKb();
    await expect(groomCmd({ dir, reject: "all", propose: true })).rejects.toThrow(
      /--propose cannot be used with --reject/,
    );
  });
});

describe("mage groom --accept … --propose (ADR-0057)", () => {
  // Step 4 checks for `gh` before it cuts the branch; a runner without it would stop every test there.
  let ghSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ghSpy = vi.spyOn(gitModule, "hasGh").mockResolvedValue(true);
  });
  afterEach(() => ghSpy.mockRestore());

  it("refuses when grooming.proposals is not enabled", async () => {
    const { dir, repo } = await withKb({ kind: "repo" });
    // A real git repo: getRepoRoot must succeed here so the run reaches judgeProposal's
    // proposals-off check instead of failing closed on an undeterminable repo root first.
    await initRepoWithIdentity(repo);
    await stageDistinct(dir, 1);
    await expect(groomCmd({ dir, accept: "all", propose: true })).rejects.toThrow(
      /proposals are off for this knowledge base/,
    );
  });

  it("refuses when noteCount exceeds PROPOSAL_NOTE_CAP (5 notes)", async () => {
    const { dir, repo } = await withKb({ kind: "repo", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await stageDistinct(dir, 6);
    await expect(groomCmd({ dir, accept: "all", propose: true })).rejects.toThrow(
      /cannot propose 6 notes in one pull request; limit is 5/,
    );
  });

  it("refuses closed when getRepoRoot cannot determine the repo (git failure), never falls back to kbRepo", async () => {
    // Old behaviour: `getRepoRoot(kbRepo) ?? kbRepo` collapsed to kbRepo on failure, so
    // judgeProposal's `repoRoot !== kbRepo` check compared kbRepo to itself and could
    // never fire — a git failure here silently cleared the gate instead of blocking it.
    const { dir, repo } = await withKb({ kind: "repo", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);

    const [slug] = await stageDistinct(dir, 1);
    const rootSpy = vi.spyOn(gitModule, "getRepoRoot").mockResolvedValue(null);
    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      await expect(groomCmd({ dir, accept: slug, propose: true })).rejects.toThrow(
        /could not determine the git repository root/,
      );
      expect(pushSpy).not.toHaveBeenCalled();
      expect(prSpy).not.toHaveBeenCalled();
    } finally {
      rootSpy.mockRestore();
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("normalises repoRoot and kbRepo when they differ only in form (symlink and trailing slash)", async () => {
    const { dir, repo } = await withKb({ kind: "repo", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "add", "."]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"]);

    const externalDir = await tmpDir();
    const link = join(externalDir, "repo-symlink");
    await symlink(repo, link);

    const [slug] = await stageDistinct(dir, 1);
    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    // getRepoRoot returns a symlinked path with a trailing slash — differs only in form
    const rootSpy = vi.spyOn(gitModule, "getRepoRoot").mockResolvedValue(`${link}/`);

    try {
      const res = await groomCmd({ dir, accept: slug, propose: true });
      expect(res.accepted).toEqual([`notes/${slug}.md`]);
      expect(res.proposalPr).toBe("https://x/pull/1");
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
      rootSpy.mockRestore();
    }
  });

  it("treats the whole hub repo as inside the KB (a hub IS the knowledge base)", async () => {
    // Measured in a real external-mode CI run: the hub's own metadata.json read as
    // "outside the knowledge base" and refused the run before anything could happen.
    const { dir, repo, root } = await withKb({ kind: "external", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);
    expect(root).not.toBe(repo); // hub-owned project docs live under projects/<name>/

    const [slug] = await stageDistinct(dir, 1);
    // dirty hub-ROOT file, exactly the shape that blocked CI
    await writeFile(join(repo, "metadata.json"), await readFile(join(repo, "metadata.json"), "utf8"));
    await writeFile(join(repo, "INDEX.md"), "# regenerated\n");

    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      const res = await groomCmd({ dir, accept: slug, propose: true });
      expect(res.accepted).toEqual([`notes/${slug}.md`]);
      expect(res.proposalBranch).toBe(`mage/proposal/${slug}`);
      expect(res.proposalPr).toBe("https://x/pull/1");
      expect(prSpy).toHaveBeenCalledOnce();
      expect(pushSpy).toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("for a hub-owned KB, does not sweep a pre-staged unrelated hub file into the proposal commit", async () => {
    // The widened hub dirty-path boundary (above) deliberately lets an unrelated staged
    // file pass judgeProposal's gate. Old `gitCommit(kbRepo, msg)` took no pathspec, so
    // it committed the WHOLE index — including that file — into the pushed proposal PR.
    const { dir, repo } = await withKb({ kind: "external", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);

    const [slug] = await stageDistinct(dir, 1);
    // A file elsewhere in the hub the user already `git add`-ed before running --propose.
    await writeFile(join(repo, "unrelated-elsewhere.md"), "someone else's staged edit\n");
    await run("git", ["-C", repo, "add", "unrelated-elsewhere.md"]);

    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      await groomCmd({ dir, accept: slug, propose: true });
      // HEAD~1 is the propose commit (gitAdd([root]) + gitCommit); HEAD is the follow-up
      // provenance-stamp commit. Neither is scoped to include the unrelated file.
      const proposeCommit = await run("git", ["-C", repo, "show", "--name-only", "--pretty=format:", "HEAD~1"]);
      const provenanceCommit = await run("git", ["-C", repo, "show", "--name-only", "--pretty=format:", "HEAD"]);
      expect(proposeCommit.stdout).not.toContain("unrelated-elsewhere.md");
      expect(provenanceCommit.stdout).not.toContain("unrelated-elsewhere.md");
      // Still staged, untouched by the proposal's scoped commits.
      const status = await run("git", ["-C", repo, "status", "--porcelain"]);
      expect(status.stdout).toContain("unrelated-elsewhere.md");
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("for a hub-root KB, commits only what the run wrote, not the rest of the hub", async () => {
    // At a hub root the KB root IS the repo, so staging `[root]` would take every dirty or
    // pre-staged file in the hub into the proposal PR.
    const { dir, repo } = await withKb({ kind: "hub", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);

    const [slug] = await stageDistinct(dir, 1);
    await writeFile(join(repo, "pre-staged.md"), "someone else's staged edit\n");
    await run("git", ["-C", repo, "add", "pre-staged.md"]);
    await writeFile(join(repo, "dirty-unstaged.md"), "work in progress\n");

    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      await groomCmd({ dir, accept: slug, propose: true });
      const proposeCommit = await run("git", ["-C", repo, "show", "--name-only", "--pretty=format:", "HEAD~1"]);
      expect(proposeCommit.stdout).toContain(`notes/${slug}.md`);
      expect(proposeCommit.stdout).not.toContain("pre-staged.md");
      expect(proposeCommit.stdout).not.toContain("dirty-unstaged.md");
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("the draft pre-scan honours the metadata.redact allowlist, as the commit-time scan does", async () => {
    const { dir, repo } = await withKb({ kind: "repo", grooming: { proposals: true } });
    const metaFile = join(dir, "mage", "metadata.json");
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    meta.redact = { allow: ["AKIAIOSFODNN7EXAMPLE"] };
    await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);
    const sDir = stagingPath(join(dir, "mage"));
    await mkdir(sDir, { recursive: true });
    await writeFile(
      join(sDir, "allowed-example.md"),
      "---\ntype: gotcha\ntags: [mage/secret]\n---\n# Allowed example key\n\nthe AWS docs example key: AKIAIOSFODNN7EXAMPLE\n",
    );

    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      await groomCmd({ dir, accept: "all", propose: true });
      expect(prSpy).toHaveBeenCalledOnce();
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("refuses when dirty paths exist outside the knowledge base", async () => {
    const { dir, repo } = await withKb({ kind: "repo", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    // Baseline commit
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "add", "."]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"]);
    // Create dirty file outside KB
    await writeFile(join(dir, "outside.txt"), "dirty outside kb\n");
    await stageDistinct(dir, 1);
    await expect(groomCmd({ dir, accept: "all", propose: true })).rejects.toThrow(
      /dirty paths outside knowledge base/,
    );
  });

  it("refuses when candidate draft contains live secrets (Gate-2)", async () => {
    const { dir, repo } = await withKb({ kind: "repo", grooming: { proposals: true } });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "add", "."]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"]);
    // Write draft directly into staging containing a live secret (bypassing Gate-1 scrub)
    const sDir = stagingPath(join(dir, "mage"));
    await mkdir(sDir, { recursive: true });
    await writeFile(
      join(sDir, "leaked-secret.md"),
      "---\ntype: gotcha\ntags: [mage/secret]\n---\n# Leaked secret note\n\nleaked aws key: AKIAIOSFODNN7EXAMPLE\n",
    );
    await expect(groomCmd({ dir, accept: "all", propose: true })).rejects.toThrow(
      /Gate-2 redaction scan blocked/,
    );
  });

  it("does not sweep an unrelated dirty file inside the KB into the proposal commit (root !== kbRepo)", async () => {
    const { dir, repo, root } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);
    expect(root).not.toBe(repo);

    const [slug] = await stageDistinct(dir, 1);
    // An UNRELATED dirty file under the KB root. Since gitAdd stages only proposal-changed
    // concrete paths, this file is not swept into the proposal commit.
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "unrelated.md"), "aws key: AKIAIOSFODNN7EXAMPLE\n");

    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      await groomCmd({ dir, accept: slug, propose: true });
      const proposeCommit = await run("git", ["-C", repo, "show", "--name-only", "--pretty=format:", "HEAD~1"]);
      expect(proposeCommit.stdout).toContain(`notes/${slug}.md`);
      expect(proposeCommit.stdout).not.toContain("unrelated.md");
      const status = await run("git", ["-C", repo, "status", "--porcelain"]);
      expect(status.stdout).toContain("unrelated.md");
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("keeps the proposal branch when the push fails AFTER the commit — the note lives only there", async () => {
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);
    const before = (await run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();

    const [slug] = await stageDistinct(dir, 1);
    const pushSpy = vi.spyOn(gitModule, "gitPush").mockRejectedValue(new Error("no remote"));
    try {
      // The draft is already consumed by promoteBatch, so the commit on the proposal
      // branch is the ONLY copy of the note. Deleting it would be data loss.
      await expect(groomCmd({ dir, accept: slug, propose: true })).rejects.toThrow(/only copy/i);
      const after = (await run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
      expect(after).toBe(before);
      const branches = (await run("git", ["-C", repo, "branch", "--list", "mage/proposal/*"])).stdout;
      expect(branches).toContain("mage/proposal/");
    } finally {
      pushSpy.mockRestore();
    }
  });

  it("from a detached HEAD, does not claim a phantom commit (the CI default)", async () => {
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);
    // What actions/checkout leaves you on.
    const sha = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    await run("git", ["-C", repo, "checkout", sha]);

    const [slug] = await stageDistinct(dir, 1);
    const commitSpy = vi.spyOn(gitModule, "gitCommit").mockRejectedValue(new Error("commit refused"));
    try {
      const err = await groomCmd({ dir, accept: slug, propose: true }).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      // nothing was committed, so it must NOT say the notes are committed on a branch
      expect(err).not.toMatch(/notes are committed on/i);
      expect(err).toMatch(/uncommitted in your working tree/i);
      const branches = (await run("git", ["-C", repo, "branch", "--list", "mage/proposal/*"])).stdout.trim();
      expect(branches).toBe("");
    } finally {
      commitSpy.mockRestore();
    }
  });

  it("when the push landed and only the PR failed, says so and gives the gh command", async () => {
    // The live run hit exactly this: push succeeded, gh pr create failed, and the old
    // message still told the user to push. No test could catch it — they all mock push.
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);

    const [slug] = await stageDistinct(dir, 1);
    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi
      .spyOn(gitModule, "createPullRequest")
      .mockRejectedValue(new Error("no known GitHub host"));
    try {
      const err = await groomCmd({ dir, accept: slug, propose: true }).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(err).toMatch(/already pushed/i);
      expect(err).toMatch(/gh pr create --head mage\/proposal\//);
      expect(err).not.toMatch(/has NOT been pushed/i);
    } finally {
      pushSpy.mockRestore();
      prSpy.mockRestore();
    }
  });

  it("never claims a commit that was not made, even when checkout-back fails", async () => {
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);

    const [slug] = await stageDistinct(dir, 1);
    // fail before the commit, and make the return to the original branch fail too
    const addSpy = vi.spyOn(gitModule, "gitAdd").mockRejectedValue(new Error("add refused"));
    const backSpy = vi.spyOn(gitModule, "gitCheckoutBranch").mockResolvedValue(false);
    try {
      const err = await groomCmd({ dir, accept: slug, propose: true }).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(err).toMatch(/add refused/);
      expect(err).toMatch(/Nothing was committed/i);
      expect(err).not.toMatch(/notes are committed on/i);
    } finally {
      addSpy.mockRestore();
      backSpy.mockRestore();
    }
  });

  it("deletes the proposal branch when the run failed BEFORE any commit", async () => {
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);
    const before = (await run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();

    const [slug] = await stageDistinct(dir, 1);
    const commitSpy = vi.spyOn(gitModule, "gitCommit").mockRejectedValue(new Error("commit refused"));
    try {
      // the branch goes, but the note is already on disk with its draft consumed —
      // the error has to say so or the user cannot find it
      // One call only: a second would hit "no staged draft", which is precisely the
      // dead end this message exists to prevent.
      const err = await groomCmd({ dir, accept: slug, propose: true }).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(err).toMatch(/commit refused/);
      expect(err).toMatch(/uncommitted in your working tree/i);
      expect(err).toMatch(/notes\//);
      const after = (await run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
      expect(after).toBe(before);
      const branches = (await run("git", ["-C", repo, "branch", "--list", "mage/proposal/*"])).stdout.trim();
      expect(branches).toBe("");
    } finally {
      commitSpy.mockRestore();
    }
  });

  it("creates branch, commits, pushes, opens PR, and stamps review", async () => {
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "add", "."]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"]);

    // Spy on gitPush and createPullRequest
    const prUrl = "https://github.com/acme/repo/pull/42";
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue(prUrl);
    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();

    try {
      const [slug] = await stageDistinct(dir, 1);
      const res = await groomCmd({ dir, accept: slug, propose: true });

      expect(res.accepted).toEqual([`notes/${slug}.md`]);
      expect(res.proposalBranch).toBe(`mage/proposal/${slug}`);
      expect(res.proposalPr).toBe(prUrl);

      // Verify PR was created
      expect(prSpy).toHaveBeenCalledOnce();
      expect(pushSpy).toHaveBeenCalledTimes(2); // Initial commit push + review follow-up push

      // Check note content on disk
      const noteContent = await readFile(noteFile(dir, slug!), "utf8");
      const parsed = parseNote(noteContent);

      expect(parsed.frontmatter.provenance).toBeDefined();
      expect(parsed.frontmatter.provenance?.channel).toBe("pipeline");
      expect(parsed.frontmatter.provenance?.review).toBe(prUrl);
      // Ensure no autonomy mark is stamped on pipeline notes (even though KB had overseer)
      expect(parsed.frontmatter.provenance?.autonomy).toBeUndefined();

      // Check git log has 2 commits on proposal branch
      const log = await run("git", ["-C", repo, "log", "--oneline", "-n", "3"]);
      expect(log.stdout).toContain(`feat(memory): propose note ${slug}`);
      expect(log.stdout).toContain(`chore(provenance): record review ${prUrl}`);
    } finally {
      prSpy.mockRestore();
      pushSpy.mockRestore();
    }
  });

  it("handles follow-up review stamp failure gracefully without failing the run", async () => {
    const { dir, repo } = await withKb({
      kind: "repo",
      grooming: { proposals: true },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "add", "."]);
    await run("git", ["-C", repo, "-c", "user.email=t@e.com", "-c", "user.name=t", "commit", "-m", "init"]);

    const prUrl = "https://github.com/acme/repo/pull/99";
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue(prUrl);
    // Second gitPush fails
    let pushCount = 0;
    const pushSpy = vi.spyOn(gitModule, "gitPush").mockImplementation(async () => {
      pushCount++;
      if (pushCount === 2) throw new Error("network disconnect during follow-up push");
    });

    try {
      const [slug] = await stageDistinct(dir, 1);
      const res = await groomCmd({ dir, accept: slug, propose: true });

      // Run succeeds despite review push failure
      expect(res.accepted).toEqual([`notes/${slug}.md`]);
      expect(res.proposalPr).toBe(prUrl);
    } finally {
      prSpy.mockRestore();
      pushSpy.mockRestore();
    }
  });
});
