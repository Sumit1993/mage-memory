import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitInit } from "../git.js";
import { writeNote } from "../note.js";
import { METRICS_DIR, STATE_DIR } from "../paths.js";
import { run } from "../shell.js";
import { tmpDir, withKb } from "../../test/fixtures/kb.js";
import {
  KEEP_RATE_VERSION,
  keepRatePath,
  normalizeLedger,
  readKeepRateLedger,
  reconcileKeepRate,
  summarizeKeepRate,
} from "./reconcile.js";

// ─── git + note helpers (a real repo, a real working tree) ─────────────────────

async function commit(repo: string, msg: string): Promise<void> {
  await run("git", [
    "-C", repo,
    "-c", "user.email=t@example.com",
    "-c", "user.name=t",
    "commit", "-q", "-m", msg,
  ]);
}

async function add(repo: string, ...paths: string[]): Promise<void> {
  await run("git", ["-C", repo, "add", "--", ...paths]);
}

interface NoteOpts {
  autonomy?: "approver" | "overseer";
  source?: "capture" | "adopt";
  body?: string;
}

/** Write a stamped note under `<root>/notes/<slug>.md`; returns its repo-relative git path. */
async function writeStampedNote(root: string, slug: string, opts: NoteOpts = {}): Promise<string> {
  const { autonomy = "overseer", source, body } = opts;
  const dir = join(root, "notes");
  await mkdir(dir, { recursive: true });
  const provenance = { repo: "t", commit: "abc1234", ...(source ? { source } : {}), autonomy };
  await writeNote(join(dir, `${slug}.md`), { type: "gotcha", provenance }, body ?? `# ${slug}\n\noriginal body\n`);
  return `mage/notes/${slug}.md`; // withKb "repo": root === <repo>/mage.
}

/** A resolved repo KB with a real git repo at `repo`. */
async function gitKb(): Promise<{ root: string; repo: string }> {
  const { root, repo } = await withKb({ kind: "repo", grooming: { autonomy: "overseer" } });
  await gitInit(repo);
  return { root, repo };
}

// ─── read / normalize (fail-open, mirrors rollup) ──────────────────────────────

describe("readKeepRateLedger — fresh empty on missing/corrupt", () => {
  it("returns a fresh empty ledger when no file exists", async () => {
    const dir = await tmpDir("mage-keeprate-");
    const l = await readKeepRateLedger(dir);
    expect(l.v).toBe(KEEP_RATE_VERSION);
    expect(l.seen).toEqual({});
    expect(l.tally.overseer).toEqual({ keep: 0, edited: 0, discard: 0, reject: 0 });
  });

  it("returns a fresh empty ledger when the file is corrupt JSON (fail-open)", async () => {
    const dir = await tmpDir("mage-keeprate-");
    await mkdir(join(dir, STATE_DIR, METRICS_DIR), { recursive: true });
    await writeFile(keepRatePath(dir), "{ not json", "utf8");
    expect((await readKeepRateLedger(dir)).seen).toEqual({});
  });

  it("normalizeLedger resets a mismatched schema version to empty", () => {
    const l = normalizeLedger({ v: 999, seen: { "notes/x.md": { autonomy: "overseer", state: "keep", bodyHash: "h" } }, tally: {} });
    expect(l.v).toBe(KEEP_RATE_VERSION);
    expect(l.seen).toEqual({});
  });

  it("normalizeLedger drops malformed seen rows", () => {
    const l = normalizeLedger({
      v: KEEP_RATE_VERSION,
      seen: {
        good: { autonomy: "approver", state: "pending", bodyHash: "h", source: "capture" },
        badState: { autonomy: "approver", state: "nope", bodyHash: "h" },
        noHash: { autonomy: "approver", state: "keep" },
        badLevel: { autonomy: "operator", state: "keep", bodyHash: "h" },
      },
      tally: {},
    });
    expect(Object.keys(l.seen)).toEqual(["good"]);
  });
});

// ─── the transition lifecycle ──────────────────────────────────────────────────

describe("reconcileKeepRate — transition lifecycle", () => {
  it("new untracked note → pending (not yet counted)", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("pending");
    expect(summarizeKeepRate(l).capture.terminals).toBe(0);
    expect(rel).toBe("mage/notes/a.md");
  });

  it("pending → keep on an unchanged commit (counted, rate 100%)", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture" });
    await reconcileKeepRate(root, repo); // pending
    await add(repo, rel);
    await commit(repo, "add note");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("keep");
    const s = summarizeKeepRate(l);
    expect(s.capture).toMatchObject({ keep: 1, terminals: 1, rate: 1 });
    expect(s.byLevel.overseer.keep).toBe(1);
  });

  it("pending → edited when the body changed before the commit", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture", body: "# a\n\nv1\n" });
    await reconcileKeepRate(root, repo); // pending, hash(v1)
    await writeStampedNote(root, "a", { source: "capture", body: "# a\n\nv2 changed\n" }); // human edit
    await add(repo, rel);
    await commit(repo, "add edited note");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("edited");
    const s = summarizeKeepRate(l);
    expect(s.capture).toMatchObject({ edited: 1, keep: 0, terminals: 1, rate: 1 });
  });

  it("pending → discard when an uncommitted note is deleted", async () => {
    const { root, repo } = await gitKb();
    await writeStampedNote(root, "a", { source: "capture" });
    await reconcileKeepRate(root, repo); // pending
    await rm(join(root, "notes", "a.md"));
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("discard");
    expect(summarizeKeepRate(l).capture).toMatchObject({ discard: 1, terminals: 1, rate: 0 });
  });

  it("keep → reject when a committed note is later removed", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture" });
    await reconcileKeepRate(root, repo); // pending
    await add(repo, rel);
    await commit(repo, "add note");
    const kept = await reconcileKeepRate(root, repo); // keep
    expect(kept.tally.overseer.keep).toBe(1);
    // Remove + commit the deletion.
    await run("git", ["-C", repo, "rm", "-q", "--", rel]);
    await commit(repo, "remove note");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("reject");
    expect(l.tally.overseer.keep).toBe(0); // the old keep was decremented
    expect(l.tally.overseer.reject).toBe(1);
    expect(summarizeKeepRate(l).capture).toMatchObject({ keep: 0, reject: 1, terminals: 1, rate: 0 });
  });

  it("is idempotent: re-running an unchanged committed state does not double-count", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture" });
    await reconcileKeepRate(root, repo);
    await add(repo, rel);
    await commit(repo, "add note");
    const first = await reconcileKeepRate(root, repo);
    const second = await reconcileKeepRate(root, repo);
    const third = await reconcileKeepRate(root, repo);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(third.tally.overseer.keep).toBe(1); // still exactly one, not three.
  });

  it("counts only source==='capture' toward the headline rate (adopt + legacy excluded)", async () => {
    const { root, repo } = await gitKb();
    const cap = await writeStampedNote(root, "cap", { source: "capture" });
    const adp = await writeStampedNote(root, "adp", { source: "adopt" });
    const leg = await writeStampedNote(root, "leg"); // no source → legacy/unmarked
    await reconcileKeepRate(root, repo); // all pending
    await add(repo, cap, adp, leg);
    await commit(repo, "add three");
    const l = await reconcileKeepRate(root, repo); // all keep
    const s = summarizeKeepRate(l);
    // Headline capture cohort sees ONLY the capture note.
    expect(s.capture).toMatchObject({ keep: 1, terminals: 1, rate: 1 });
    // The per-level tally still records every source (a future breakdown).
    expect(s.byLevel.overseer.keep).toBe(3);
  });

  it("ignores notes with no autonomy stamp (human / operator authored)", async () => {
    const { root, repo } = await gitKb();
    const dir = join(root, "notes");
    await mkdir(dir, { recursive: true });
    // A note with provenance but NO autonomy — must never enter the ledger.
    await writeNote(join(dir, "human.md"), { type: "note", provenance: { repo: "t", source: "capture" } }, "# h\n\nx\n");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/human.md"]).toBeUndefined();
  });
});

// ─── adversarial regressions (FIX 1 / 2 / 3) ────────────────────────────────────

describe("reconcileKeepRate — adversarial regressions", () => {
  it("FIX 1: a capture note first observed already-committed is a baseline (counts toward neither headline nor tally)", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture" });
    // Commit BEFORE the first reconcile — we never witness the keep/revert decision.
    await add(repo, rel);
    await commit(repo, "add note (pre-observed)");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("keep");
    expect(l.seen["notes/a.md"]?.baseline).toBe(true);
    // Headline: the baseline note must NOT inflate the rate.
    expect(summarizeKeepRate(l).capture.terminals).toBe(0);
    expect(summarizeKeepRate(l).capture.keep).toBe(0);
    // byLevel (tally) must also stay zero (never bumped).
    expect(l.tally.overseer.keep).toBe(0);
    // Idempotent: a re-run stays a no-op.
    expect(await reconcileKeepRate(root, repo)).toEqual(l);
  });

  it("FIX 2: a de-stamped (autonomy removed) note still on disk is NOT reclassified reject", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture" });
    await reconcileKeepRate(root, repo); // pending
    await add(repo, rel);
    await commit(repo, "add note");
    const kept = await reconcileKeepRate(root, repo); // keep
    expect(kept.tally.overseer.keep).toBe(1);
    // A human takes ownership: remove provenance.autonomy but keep the file on disk + committed.
    await writeNote(join(root, "notes", "a.md"), { type: "gotcha", provenance: { repo: "t", source: "capture" } }, "# a\n\noriginal body\n");
    await add(repo, rel);
    await commit(repo, "human takes ownership (de-stamp)");
    const l = await reconcileKeepRate(root, repo);
    // Frozen: still keep, never reject; the rate is unchanged.
    expect(l.seen["notes/a.md"]?.state).toBe("keep");
    expect(l.tally.overseer.reject).toBe(0);
    expect(l.tally.overseer.keep).toBe(1);
    expect(summarizeKeepRate(l).capture).toMatchObject({ keep: 1, reject: 0, terminals: 1, rate: 1 });
  });

  it("FIX 3: a discarded note re-created at the same path and committed ends as keep, counted once", async () => {
    const { root, repo } = await gitKb();
    const rel = await writeStampedNote(root, "a", { source: "capture" });
    await reconcileKeepRate(root, repo); // pending
    await rm(join(root, "notes", "a.md"));
    const discarded = await reconcileKeepRate(root, repo); // discard
    expect(discarded.seen["notes/a.md"]?.state).toBe("discard");
    expect(discarded.tally.overseer.discard).toBe(1);
    // Re-create at the same path — discard un-freezes back to pending.
    await writeStampedNote(root, "a", { source: "capture" });
    const repending = await reconcileKeepRate(root, repo);
    expect(repending.seen["notes/a.md"]?.state).toBe("pending");
    expect(repending.tally.overseer.discard).toBe(0); // the earlier discard was undone
    // Commit → keep, counted exactly once.
    await add(repo, rel);
    await commit(repo, "re-add note");
    const l = await reconcileKeepRate(root, repo);
    expect(l.seen["notes/a.md"]?.state).toBe("keep");
    expect(l.tally.overseer).toMatchObject({ keep: 1, discard: 0 });
    expect(summarizeKeepRate(l).capture).toMatchObject({ keep: 1, discard: 0, terminals: 1, rate: 1 });
  });
});

// ─── fail-open ─────────────────────────────────────────────────────────────────

describe("reconcileKeepRate — fail-open", () => {
  it("does not throw and mutates nothing on a non-git dir", async () => {
    const dir = await tmpDir("mage-keeprate-");
    // A stamped note present, but the dir is NOT a git repo → the enumeration bails.
    await mkdir(join(dir, "notes"), { recursive: true });
    await writeNote(join(dir, "notes", "a.md"), { type: "gotcha", provenance: { autonomy: "overseer", source: "capture" } }, "# a\n\nx\n");
    const l = await reconcileKeepRate(dir, dir);
    expect(l.seen).toEqual({});
  });

  it("recovers from a corrupt ledger and reconciles fresh", async () => {
    const { root, repo } = await gitKb();
    await mkdir(join(root, STATE_DIR, METRICS_DIR), { recursive: true });
    await writeFile(keepRatePath(root), "}} corrupt {{", "utf8");
    await writeStampedNote(root, "a", { source: "capture" });
    const l = await reconcileKeepRate(root, repo); // must not throw
    expect(l.seen["notes/a.md"]?.state).toBe("pending");
  });
});
