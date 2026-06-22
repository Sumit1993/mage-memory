import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { gitInit } from "./git.js";
import type { NoteFrontmatter } from "./note.js";
import { resolveCreationStamp, stampProvenance } from "./provenance.js";
import { run } from "./shell.js";
import { withKb } from "../test/fixtures/kb.js";

// ─── stampProvenance — the PURE frontmatter merge ──────────────────────────────

describe("stampProvenance", () => {
  it("adds repo + commit + autonomy to a frontmatter with no provenance", () => {
    const fm: NoteFrontmatter = { type: "gotcha", created: "2026-06-22" };
    const out = stampProvenance(fm, { autonomy: "overseer", repo: "mage-memory", commit: "abc1234" });
    expect(out.provenance).toEqual({ autonomy: "overseer", repo: "mage-memory", commit: "abc1234" });
    expect(out.type).toBe("gotcha"); // other fields preserved
    expect(out.created).toBe("2026-06-22");
  });

  it("never clobbers a hand-authored repo/commit, but always applies autonomy", () => {
    const fm: NoteFrontmatter = { provenance: { repo: "hand", commit: "deadbee" } };
    const out = stampProvenance(fm, { autonomy: "approver", repo: "auto", commit: "fffffff" });
    expect(out.provenance).toEqual({ repo: "hand", commit: "deadbee", autonomy: "approver" });
  });

  it("omits autonomy entirely when the stamp has none (operator / human-written)", () => {
    const out = stampProvenance({ type: "note" }, { repo: "mage-memory", commit: "abc1234" });
    expect(out.provenance).toEqual({ repo: "mage-memory", commit: "abc1234" });
    expect(out.provenance).not.toHaveProperty("autonomy");
  });

  it("returns the frontmatter untouched when the merge would add nothing", () => {
    const fm: NoteFrontmatter = { type: "note" };
    expect(stampProvenance(fm, {})).toBe(fm); // same reference — no empty provenance block added
  });
});

// ─── resolveCreationStamp — autonomy gating, repo basename, commit fail-open ───

describe("resolveCreationStamp", () => {
  it("stamps autonomy at approver / overseer", async () => {
    for (const level of ["approver", "overseer"] as const) {
      const { resolved } = await withKb({ kind: "repo", grooming: { autonomy: level } });
      expect((await resolveCreationStamp(resolved)).autonomy).toBe(level);
    }
  });

  it("omits autonomy at operator (and when no grooming block is present)", async () => {
    const operator = await withKb({ kind: "repo", grooming: { autonomy: "operator" } });
    expect(await resolveCreationStamp(operator.resolved)).not.toHaveProperty("autonomy");
    const none = await withKb({ kind: "repo" });
    expect(await resolveCreationStamp(none.resolved)).not.toHaveProperty("autonomy");
  });

  it("sets repo to the repo basename and omits commit when not a git repo", async () => {
    const { resolved } = await withKb({ kind: "repo" });
    const stamp = await resolveCreationStamp(resolved);
    expect(stamp.repo).toBe(basename(resolved.repo));
    expect(stamp).not.toHaveProperty("commit"); // a fresh tmp KB is not a git repo
  });

  it("reads autonomy via resolved.repo for a hub-owned project (root !== repo)", async () => {
    // The ADR-0030 hub-path: the level lives in the HUB's metadata at `repo`, not at
    // `root` (the project dir). A stamp keyed on `root` would silently drop autonomy.
    const { resolved } = await withKb({ kind: "project", grooming: { autonomy: "overseer" } });
    expect(resolved.root).not.toBe(resolved.repo);
    expect((await resolveCreationStamp(resolved)).autonomy).toBe("overseer");
  });

  it("stamps the short HEAD commit when the repo has one", async () => {
    const { resolved } = await withKb({ kind: "repo", grooming: { autonomy: "overseer" } });
    await gitInit(resolved.repo);
    await run("git", [
      "-C", resolved.repo,
      "-c", "user.email=t@example.com",
      "-c", "user.name=t",
      "commit", "--allow-empty", "-q", "-m", "init",
    ]);
    const stamp = await resolveCreationStamp(resolved);
    expect(stamp.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(stamp.autonomy).toBe("overseer");
    expect(stamp.repo).toBe(basename(resolved.repo));
  });
});
