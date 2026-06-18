import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as pathsMod from "../paths.js";
import {
  hubMetadataPath,
  learningsPath,
  metadataPath,
  metricsPath,
  stagingPath,
} from "../paths.js";
import { mageMigrate } from "./migrate.js";

const made: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

/** True iff `p` exists on disk (file or dir). */
async function present(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("mage migrate", () => {
  it("upgrades a v1 code-repo metadata file to v2 on disk (mode normalized + persisted)", async () => {
    const code = await tmp("mage-mig-code-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [{ hub_path: "/h", hub_repo: "u", project: "x" }],
        linked_at: "t",
      }),
    );
    const result = await mageMigrate({ dir: code });
    expect(result.migrated).toHaveLength(1);
    expect(result.migrated[0]?.from).toBe("mage.v1");
    expect(result.migrated[0]?.to).toBe("mage.v2");
    const raw = JSON.parse(await readFile(metadataPath(code), "utf8"));
    expect(raw.schema).toBe("mage.v2");
    expect(raw.mode).toBe("hybrid"); // v1 in-repo + hub_refs → hybrid, persisted
  });

  it("upgrades a v1 hub metadata file (storage in-repo → repo-owned, schema v2)", async () => {
    const hub = await tmp("mage-mig-hub-");
    await mkdir(join(hub, "projects"), { recursive: true }); // makes looksLikeHub() true
    await writeFile(
      hubMetadataPath(hub),
      JSON.stringify({
        schema: "mage.v1",
        name: "h",
        created_at: "t",
        projects: [{ name: "a", storage: "in-repo", code_repo_path: "/a", code_repo_url: "u" }],
      }),
    );
    const result = await mageMigrate({ dir: hub });
    expect(result.migrated.map((m) => m.to)).toContain("mage.v2");
    const raw = JSON.parse(await readFile(hubMetadataPath(hub), "utf8"));
    expect(raw.schema).toBe("mage.v2");
    expect(raw.projects[0].storage).toBe("repo-owned");
  });

  it("is idempotent: a v2 KB reports already-current and rewrites nothing", async () => {
    const code = await tmp("mage-mig-v2-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v2",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [],
        linked_at: "t",
      }),
    );
    const result = await mageMigrate({ dir: code });
    expect(result.migrated).toHaveLength(0);
    expect(result.alreadyCurrent).toHaveLength(1);
  });

  it("walks up from a subdir to find the code repo", async () => {
    const code = await tmp("mage-mig-walk-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v1",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [],
        linked_at: "t",
      }),
    );
    const sub = join(code, "src", "deep");
    await mkdir(sub, { recursive: true });
    expect((await mageMigrate({ dir: sub })).migrated).toHaveLength(1);
  });

  it("throws when there is no KB at or above dir", async () => {
    const empty = await tmp("mage-mig-none-");
    await expect(mageMigrate({ dir: empty })).rejects.toThrow(/no mage knowledge base/i);
  });
});

// ─── state-fold layout migration (ADR-0025) ──────────────────────────────────

/** A v1 in-repo code-repo metadata (drives the v1→v2 bump alongside the fold). */
function v1CodeMeta(): string {
  return JSON.stringify({
    schema: "mage.v1",
    mode: "in-repo",
    project: "x",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: "t",
  });
}

/**
 * Seed the pre-fold transient dirs at `docsRoot` with sentinel content:
 * `.learnings/x.jsonl`, `.metrics/promote.json`, `.staging/d.md`. Returns the
 * exact bytes written so a test can assert the move is byte-identical.
 */
async function seedOldLayout(
  docsRoot: string,
): Promise<{ learning: string; promote: string; draft: string }> {
  const learning = '{"insight":"cache key","session":"s1"}\n';
  const promote = '{"watermark":7,"last":"2026-06-16"}';
  const draft = "# draft note\n\nstaged body — must survive the move.\n";
  await mkdir(join(docsRoot, ".learnings"), { recursive: true });
  await mkdir(join(docsRoot, ".metrics"), { recursive: true });
  await mkdir(join(docsRoot, ".staging"), { recursive: true });
  await writeFile(join(docsRoot, ".learnings", "x.jsonl"), learning);
  await writeFile(join(docsRoot, ".metrics", "promote.json"), promote);
  await writeFile(join(docsRoot, ".staging", "d.md"), draft);
  return { learning, promote, draft };
}

describe("mage migrate — state fold (ADR-0025)", () => {
  it("folds an old code-repo layout under .mage/ byte-identically + folds .redactignore + bumps schema", async () => {
    const code = await tmp("mage-fold-code-");
    const docs = join(code, "mage");
    await mkdir(docs, { recursive: true });
    await writeFile(metadataPath(code), v1CodeMeta());
    const seed = await seedOldLayout(docs);
    // One glob (→ ignore) and one literal: line (→ allow).
    await writeFile(
      join(docs, ".redactignore"),
      "notes/generated/**\nliteral:AKIAEXAMPLENOTREAL\n",
    );

    const result = await mageMigrate({ dir: code });

    // All three dirs now live under mage/.mage/<leaf>/ with byte-identical content.
    expect(await readFile(join(learningsPath(docs), "x.jsonl"), "utf8")).toBe(seed.learning);
    expect(await readFile(join(metricsPath(docs), "promote.json"), "utf8")).toBe(seed.promote);
    expect(await readFile(join(stagingPath(docs), "d.md"), "utf8")).toBe(seed.draft);

    // The old dot-dirs are gone (it was a MOVE, not a copy).
    expect(await present(join(docs, ".learnings"))).toBe(false);
    expect(await present(join(docs, ".metrics"))).toBe(false);
    expect(await present(join(docs, ".staging"))).toBe(false);

    // .redactignore is gone and merged into metadata.redact; schema bumped to v2.
    expect(await present(join(docs, ".redactignore"))).toBe(false);
    const raw = JSON.parse(await readFile(metadataPath(code), "utf8"));
    expect(raw.schema).toBe("mage.v2");
    expect(raw.redact).toEqual({
      ignore: ["notes/generated/**"],
      allow: ["AKIAEXAMPLENOTREAL"],
    });

    // Each move is recorded; all four outcomes are "moved".
    const moved = result.layoutMoves.filter((m) => m.outcome === "moved");
    expect(moved.map((m) => m.kind).sort()).toEqual([
      "learnings",
      "metrics",
      "redactignore",
      "staging",
    ]);
    expect(result.layoutMoves.every((m) => m.outcome === "moved")).toBe(true);
  });

  it("is idempotent: a second run moves nothing and leaves content unchanged", async () => {
    const code = await tmp("mage-fold-idem-");
    const docs = join(code, "mage");
    await mkdir(docs, { recursive: true });
    await writeFile(metadataPath(code), v1CodeMeta());
    const seed = await seedOldLayout(docs);

    await mageMigrate({ dir: code }); // first run does the fold

    const second = await mageMigrate({ dir: code });
    // No dirs to move, no .redactignore — the layout pass is a quiet no-op.
    expect(second.layoutMoves).toHaveLength(0);
    // Content is exactly where the first run left it, unchanged.
    expect(await readFile(join(learningsPath(docs), "x.jsonl"), "utf8")).toBe(seed.learning);
    expect(await readFile(join(metricsPath(docs), "promote.json"), "utf8")).toBe(seed.promote);
    expect(await readFile(join(stagingPath(docs), "d.md"), "utf8")).toBe(seed.draft);
  });

  it("moves each hub project's dirs under projects/<name>/.mage/", async () => {
    const hub = await tmp("mage-fold-hub-");
    await mkdir(join(hub, "projects", "alpha"), { recursive: true });
    await mkdir(join(hub, "projects", "beta"), { recursive: true });
    await writeFile(
      hubMetadataPath(hub),
      JSON.stringify({
        schema: "mage.v2",
        name: "h",
        created_at: "t",
        projects: [
          { name: "alpha", storage: "repo-owned", code_repo_path: "/a", code_repo_url: "u" },
          { name: "beta", storage: "repo-owned", code_repo_path: "/b", code_repo_url: "u" },
        ],
      }),
    );
    const alpha = join(hub, "projects", "alpha");
    const beta = join(hub, "projects", "beta");
    const seedA = await seedOldLayout(alpha);
    const seedB = await seedOldLayout(beta);

    const result = await mageMigrate({ dir: hub });

    // Each project's dirs moved under its own .mage/, byte-identical.
    expect(await readFile(join(learningsPath(alpha), "x.jsonl"), "utf8")).toBe(seedA.learning);
    expect(await readFile(join(stagingPath(alpha), "d.md"), "utf8")).toBe(seedA.draft);
    expect(await readFile(join(metricsPath(beta), "promote.json"), "utf8")).toBe(seedB.promote);
    expect(await present(join(alpha, ".learnings"))).toBe(false);
    expect(await present(join(beta, ".staging"))).toBe(false);

    // Both project roots are represented among the recorded moves.
    const roots = new Set(result.layoutMoves.map((m) => m.root));
    expect(roots.has(alpha)).toBe(true);
    expect(roots.has(beta)).toBe(true);
    expect(result.layoutMoves.every((m) => m.outcome === "moved")).toBe(true);
  });

  it("folds a .redactignore found at a hub project into the hub's single metadata", async () => {
    const hub = await tmp("mage-fold-hubredact-");
    await mkdir(join(hub, "projects", "alpha"), { recursive: true });
    await writeFile(
      hubMetadataPath(hub),
      JSON.stringify({
        schema: "mage.v2",
        name: "h",
        created_at: "t",
        projects: [
          { name: "alpha", storage: "repo-owned", code_repo_path: "/a", code_repo_url: "u" },
        ],
      }),
    );
    const alpha = join(hub, "projects", "alpha");
    await writeFile(join(alpha, ".redactignore"), "work/**\nliteral:ghp_exampletoken\n");

    await mageMigrate({ dir: hub });

    // Project dirs carry no metadata.json — the allowlist lands in the hub metadata.
    expect(await present(join(alpha, ".redactignore"))).toBe(false);
    expect(await present(join(alpha, "metadata.json"))).toBe(false);
    const raw = JSON.parse(await readFile(hubMetadataPath(hub), "utf8"));
    expect(raw.redact).toEqual({ ignore: ["work/**"], allow: ["ghp_exampletoken"] });
  });

  it("fail-safe: a pre-existing .mage/learnings target leaves the old .learnings intact (no data lost)", async () => {
    const code = await tmp("mage-fold-failsafe-");
    const docs = join(code, "mage");
    await mkdir(docs, { recursive: true });
    await writeFile(metadataPath(code), v1CodeMeta());
    const seed = await seedOldLayout(docs);

    // Simulate a partial prior run: the target already holds a draft of its own.
    const prior = '{"insight":"already here","session":"prior"}\n';
    await mkdir(learningsPath(docs), { recursive: true });
    await writeFile(join(learningsPath(docs), "prior.jsonl"), prior);

    const result = await mageMigrate({ dir: code });

    // The collision is recorded as a skip, never a merge-destroy.
    const learnMove = result.layoutMoves.find((m) => m.kind === "learnings");
    expect(learnMove?.outcome).toBe("skipped");

    // The source .learnings is LEFT in place — its draft is not lost...
    expect(await present(join(docs, ".learnings"))).toBe(true);
    expect(await readFile(join(docs, ".learnings", "x.jsonl"), "utf8")).toBe(seed.learning);
    // ...and the pre-existing target draft is untouched too.
    expect(await readFile(join(learningsPath(docs), "prior.jsonl"), "utf8")).toBe(prior);

    // The non-colliding siblings still migrate cleanly (fail-safe is per-leaf).
    expect(await readFile(join(metricsPath(docs), "promote.json"), "utf8")).toBe(seed.promote);
    expect(await readFile(join(stagingPath(docs), "d.md"), "utf8")).toBe(seed.draft);
    expect(await present(join(docs, ".metrics"))).toBe(false);
    expect(await present(join(docs, ".staging"))).toBe(false);
  });

  it("never loses data: every leaf's bytes are reachable at exactly one location after the fold", async () => {
    const code = await tmp("mage-fold-nodata-");
    const docs = join(code, "mage");
    await mkdir(docs, { recursive: true });
    await writeFile(metadataPath(code), v1CodeMeta());
    const seed = await seedOldLayout(docs);

    await mageMigrate({ dir: code });

    // For each leaf: content arrived at the destination AND the source is gone —
    // there is no path where the source vanished without the bytes arriving.
    const learningDest = await present(join(learningsPath(docs), "x.jsonl"));
    const learningSrc = await present(join(docs, ".learnings", "x.jsonl"));
    expect(learningDest).toBe(true);
    expect(learningSrc).toBe(false);
    expect(await readFile(join(learningsPath(docs), "x.jsonl"), "utf8")).toBe(seed.learning);

    const promoteDest = await present(join(metricsPath(docs), "promote.json"));
    const promoteSrc = await present(join(docs, ".metrics", "promote.json"));
    expect(promoteDest).toBe(true);
    expect(promoteSrc).toBe(false);
    expect(await readFile(join(metricsPath(docs), "promote.json"), "utf8")).toBe(seed.promote);

    const draftDest = await present(join(stagingPath(docs), "d.md"));
    const draftSrc = await present(join(docs, ".staging", "d.md"));
    expect(draftDest).toBe(true);
    expect(draftSrc).toBe(false);
    expect(await readFile(join(stagingPath(docs), "d.md"), "utf8")).toBe(seed.draft);
  });

  it("never loses the allowlist: a failed metadata write leaves .redactignore intact for a retry", async () => {
    const code = await tmp("mage-fold-writefail-");
    const docs = join(code, "mage");
    await mkdir(docs, { recursive: true });
    await writeFile(metadataPath(code), v1CodeMeta());
    const ignoreText = "notes/generated/**\nliteral:AKIAEXAMPLENOTREAL\n";
    await writeFile(join(docs, ".redactignore"), ignoreText);

    // The metadata write rejects ONCE (ENOSPC-class failure) — parse-then-write-then-
    // delete must surface the failure WITHOUT having dropped the source file first.
    const spy = vi
      .spyOn(pathsMod, "writeMetadata")
      .mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    await expect(mageMigrate({ dir: code })).rejects.toThrow(/ENOSPC/);

    // The allowlist is NOT lost: the file is byte-intact and ready for a retry.
    expect(await present(join(docs, ".redactignore"))).toBe(true);
    expect(await readFile(join(docs, ".redactignore"), "utf8")).toBe(ignoreText);

    // A successful re-run (real write restored) folds it: file gone, allowlist in metadata.
    spy.mockRestore();
    await mageMigrate({ dir: code });
    expect(await present(join(docs, ".redactignore"))).toBe(false);
    const raw = JSON.parse(await readFile(metadataPath(code), "utf8"));
    expect(raw.schema).toBe("mage.v2");
    expect(raw.redact).toEqual({
      ignore: ["notes/generated/**"],
      allow: ["AKIAEXAMPLENOTREAL"],
    });
  });

  it("unions a .redactignore over existing metadata.redact (base-first, deduped)", async () => {
    const code = await tmp("mage-fold-union-");
    const docs = join(code, "mage");
    await mkdir(docs, { recursive: true });
    // v2 metadata already carrying a redact allowlist (base).
    await writeFile(
      metadataPath(code),
      JSON.stringify({
        schema: "mage.v2",
        mode: "in-repo",
        project: "x",
        hub_path: null,
        hub_repo: null,
        hub_refs: [],
        linked_at: "t",
        redact: { ignore: ["a/**"], allow: ["LIT_A"] },
      }),
    );
    // The file adds a new glob + literal AND re-states the base glob (the dup is dropped).
    await writeFile(
      join(docs, ".redactignore"),
      "b/**\nliteral:LIT_B\na/**\n",
    );

    await mageMigrate({ dir: code });

    // Union is base-first then new, deduped; the file is folded away.
    const raw = JSON.parse(await readFile(metadataPath(code), "utf8"));
    expect(raw.redact).toEqual({ ignore: ["a/**", "b/**"], allow: ["LIT_A", "LIT_B"] });
    expect(await present(join(docs, ".redactignore"))).toBe(false);
  });
});
