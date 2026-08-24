import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { gitInit } from "../git.js";
import * as gitModule from "../git.js";
import { run } from "../shell.js";
import { exists, stagingPath } from "../paths.js";
import { parseNote } from "../note.js";
import { withKb } from "../../test/fixtures/kb.js";
import { groomCmd } from "./groom-cmd.js";
import { stageCmd } from "./stage-cmd.js";

async function makeKb(): Promise<string> {
  const { dir } = await withKb();
  return dir;
}

const stagingFile = (dir: string, slug: string) => join(dir, "mage", ".staging", `${slug}.md`);
const stagingFile2 = (dir: string, slug: string) => join(stagingPath(join(dir, "mage")), `${slug}.md`);
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

describe("mage groom — surface", () => {
  it("lists the pending batch and caps it at the budget (no silent truncation)", async () => {
    const dir = await makeKb();
    await stageDistinct(dir, 4);
    const r = await groomCmd({ dir });
    expect(r.pending).toBe(4);
    expect(r.drafts).toHaveLength(3); // stagingBudget = 3
    expect(r.drafts?.every((d) => d.type === "gotcha")).toBe(true);
  });

  it("reports an empty batch", async () => {
    const dir = await makeKb();
    const r = await groomCmd({ dir });
    expect(r).toEqual({ drafts: [], pending: 0 });
  });

  it("drops a staged draft that a committed note now covers (stale → not surfaced)", async () => {
    const dir = await makeKb();
    const [slug] = await stageDistinct(dir, 1); // "Alpha redaction rule" → wing mage
    expect((await groomCmd({ dir })).pending).toBe(1);

    // A note covering the lesson lands in notes/ (e.g. another session committed it).
    // The draft's keywords derive from its title + tags → [alpha, redaction, rule,
    // mage, redact]; the note must share >= 3 of them to clear the lesson bar.
    await mkdir(join(dir, "mage", "notes"), { recursive: true });
    await writeFile(
      join(dir, "mage", "notes", "covers.md"),
      "---\ntype: gotcha\ntags: [mage/redact]\nkeywords: [alpha, redaction, rule, mage]\n---\n# Alpha redaction\n",
    );
    const r = await groomCmd({ dir });
    expect(r.pending).toBe(0); // the now-covered draft is filtered from the surface
    expect(r.drafts).toHaveLength(0);
    expect(slug).toBe("alpha-redaction-rule");
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

describe("mage groom — inbox ingest (ADR-0032)", () => {
  // A Gate-0 capture sitting flat at the docs-root top (CC-renormalized frontmatter,
  // already-scrubbed-and-shaped body).
  function gate0Capture(body: string, session = "sess-x"): string {
    return `---\nname: ""\nmetadata:\n  node_type: memory\n  type: note\n  created: 2026-06-27\n  originSessionId: ${session}\n---\n\n${body}\n`;
  }

  it("ingests an inbox capture into staging and surfaces it", async () => {
    const dir = await makeKb();
    const root = join(dir, "mage");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "ssh-timeout-fix.md"), gate0Capture("# SSH timeout fix\n\nbump ServerAliveInterval to 30."));

    const r = await groomCmd({ dir });
    expect(r.ingested).toEqual(["ssh-timeout-fix"]);
    expect(r.pending).toBe(1);
    expect(r.drafts?.[0]?.slug).toBe("ssh-timeout-fix");
    // Moved: gone from the root inbox, now a staged draft.
    expect(await exists(join(root, "ssh-timeout-fix.md"))).toBe(false);
    expect(await exists(stagingFile2(dir, "ssh-timeout-fix"))).toBe(true);
  });

  it("promotes an ingested capture to notes/ on --accept all (provenance stamped)", async () => {
    const dir = await makeKb();
    const root = join(dir, "mage");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "ssh-timeout-fix.md"), gate0Capture("# SSH timeout fix\n\nbump ServerAliveInterval to 30."));

    await groomCmd({ dir }); // ingest + surface
    const r = await groomCmd({ dir, accept: "all" });
    expect(r.accepted).toEqual(["notes/ssh-timeout-fix.md"]);
    const note = await readFile(noteFile(dir, "ssh-timeout-fix"), "utf8");
    expect(note).toContain("# SSH timeout fix");
    expect(note).toContain("cc-session:sess-x"); // session pointer survives to the note
    const { frontmatter } = parseNote(note);
    expect(frontmatter.provenance).toBeDefined(); // stamped at the promote chokepoint (ADR-0031)
  });

  it("--accept all --json emits a clean single JSON line (no index logging leak)", async () => {
    // F6: index()'s 'Indexed N note(s)...' success/detail must not corrupt the --json
    // stdout contract. acceptBatch passes quiet:true to index() in json mode.
    const dir = await makeKb();
    const root = join(dir, "mage");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "x-capture.md"), gate0Capture("# X capture\n\na distinct body."));
    await groomCmd({ dir }); // ingest x-capture into staging

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
    expect(parsed.accepted).toContain("notes/x-capture.md");
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

/**
 * A temp repo that git will actually commit in. CI runners carry no user.name /
 * user.email, so production `gitCommit` fails there while passing on a dev box.
 */
async function initRepoWithIdentity(repo: string): Promise<void> {
  await gitInit(repo);
  await run("git", ["-C", repo, "config", "user.email", "t@e.com"]);
  await run("git", ["-C", repo, "config", "user.name", "t"]);
}

describe("mage groom --accept … --propose (ADR-0046)", () => {
  it("refuses when grooming.proposals is not enabled", async () => {
    const { dir } = await withKb({ kind: "repo" });
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

  it("re-scans the INDEX after staging, catching a dirty KB file the first scan could not see", async () => {
    const { dir, repo, root } = await withKb({
      kind: "repo",
      grooming: { proposals: true, autonomy: "overseer" },
    });
    await initRepoWithIdentity(repo);
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "init"]);

    const [slug] = await stageDistinct(dir, 1);
    // An UNRELATED dirty file under the KB root. judgeProposal permits dirty paths
    // inside the KB, and gitAdd sweeps it in — so only an index re-scan can catch it.
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "unrelated.md"), "aws key: AKIAIOSFODNN7EXAMPLE\n");

    const pushSpy = vi.spyOn(gitModule, "gitPush").mockResolvedValue();
    const prSpy = vi.spyOn(gitModule, "createPullRequest").mockResolvedValue("https://x/pull/1");
    try {
      await expect(groomCmd({ dir, accept: slug, propose: true })).rejects.toThrow(/redaction scan blocked/i);
      expect(pushSpy).not.toHaveBeenCalled();
      expect(prSpy).not.toHaveBeenCalled();
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
