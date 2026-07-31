import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import { canonicalizeHubRepo } from "./hub-url.js";
import { findDisplacedHubs } from "./hub-scan.js";

// findDisplacedHubs scans `hubsRoot()` (not arbitrary machine locations — ADR-0043
// §4) at EXACTLY the depth a legitimately-derived hub for the wanted key would sit
// at (host + N path segments) — e.g. a repo renamed upstream leaves its OLD clone
// at <root>/<host>/<old-owner>/<old-repo>, same depth as the NEW derived path, but
// whose `origin` (if updated, or a host redirect resolves it) now canonicalizes to
// the new key. So a "displaced" fixture in these tests sits at root/<segments...>
// with different literal names but the SAME segment count as the wanted key.

async function makeClone(path: string, origin: string): Promise<void> {
  await mkdir(join(path, "projects"), { recursive: true });
  await writeFile(join(path, "metadata.json"), JSON.stringify({ schema: "mage.v2" }));
  await mkdir(join(path, ".git"), { recursive: true });
  await writeFile(join(path, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
}

describe("findDisplacedHubs", () => {
  it("finds a same-depth clone under a different literal path whose origin matches", async () => {
    const root = await tmpDir("mage-scan-");
    // "github.com/o/r" has 3 segments (host + 2). Place the clone at a DIFFERENT
    // 3-segment path under root, e.g. as if the repo was renamed upstream.
    const displaced = join(root, "github.com", "old-owner", "old-name");
    await makeClone(displaced, "https://github.com/o/r.git");

    const wantedKey = canonicalizeHubRepo("git@github.com:o/r.git").key; // "github.com/o/r"
    const depth = wantedKey.split("/").length; // 3
    const found = await findDisplacedHubs(root, wantedKey, depth);
    expect(found.map((c) => c.path)).toEqual([displaced]);
  });

  it("depth is DERIVED, not hard-coded — a nested (GitLab-subgroup, 4-segment) key is found too", async () => {
    const root = await tmpDir("mage-scan-nested-");
    const wantedKey = canonicalizeHubRepo("https://gitlab.com/group/subgroup/repo.git").key;
    const depth = wantedKey.split("/").length; // 4: host + group + subgroup + repo
    const displaced = join(root, "gitlab.com", "group", "subgroup", "renamed-repo");
    await makeClone(displaced, "https://gitlab.com/group/subgroup/repo.git");

    const found = await findDisplacedHubs(root, wantedKey, depth);
    expect(found.map((c) => c.path)).toEqual([displaced]);

    // A hard-coded depth of 3 (host + 2, the non-subgroup shape) would never reach
    // this 4-segment candidate at all.
    const foundAtWrongDepth = await findDisplacedHubs(root, wantedKey, 3);
    expect(foundAtWrongDepth).toEqual([]);
  });

  it("a same-depth clone whose origin does NOT match is not a candidate", async () => {
    const root = await tmpDir("mage-scan-mismatch-");
    const decoy = join(root, "github.com", "someone", "else");
    await makeClone(decoy, "https://github.com/other/repo.git");

    const wantedKey = canonicalizeHubRepo("git@github.com:o/r.git").key;
    const found = await findDisplacedHubs(root, wantedKey, wantedKey.split("/").length);
    expect(found).toEqual([]);
  });

  it("returns ALL candidates, sorted by path, when there are several", async () => {
    const root = await tmpDir("mage-scan-multi-");
    const b = join(root, "github.com", "b-owner", "repo");
    const a = join(root, "github.com", "a-owner", "repo");
    await makeClone(b, "https://github.com/o/r.git");
    await makeClone(a, "https://github.com/o/r.git");

    const wantedKey = canonicalizeHubRepo("git@github.com:o/r.git").key;
    const found = await findDisplacedHubs(root, wantedKey, wantedKey.split("/").length);
    expect(found.map((c) => c.path)).toEqual([a, b]); // sorted: "a-owner" before "b-owner"
  });

  it("SORTED order is deterministic regardless of directory creation order", async () => {
    // Create in reverse-sorted order — the result must still come out sorted, so
    // the caller's "keep the first" pick never depends on filesystem readdir order.
    const root = await tmpDir("mage-scan-order-");
    const zLoc = join(root, "github.com", "z-owner", "repo");
    const aLoc = join(root, "github.com", "a-owner", "repo");
    await makeClone(zLoc, "https://github.com/o/r.git"); // created FIRST
    await makeClone(aLoc, "https://github.com/o/r.git"); // created SECOND

    const wantedKey = canonicalizeHubRepo("git@github.com:o/r.git").key;
    const found = await findDisplacedHubs(root, wantedKey, wantedKey.split("/").length);
    expect(found[0]?.path).toBe(aLoc);
    expect(found[1]?.path).toBe(zLoc);
  });

  it("a same-depth directory that isn't hub-shaped is skipped, not a match", async () => {
    const root = await tmpDir("mage-scan-noshape-");
    const notAHub = join(root, "github.com", "someone", "notahub");
    await mkdir(notAHub, { recursive: true });
    await mkdir(join(notAHub, ".git"), { recursive: true });
    await writeFile(
      join(notAHub, ".git", "config"),
      '[remote "origin"]\n\turl = https://github.com/o/r.git\n',
    );

    const wantedKey = canonicalizeHubRepo("git@github.com:o/r.git").key;
    const found = await findDisplacedHubs(root, wantedKey, wantedKey.split("/").length);
    expect(found).toEqual([]);
  });

  it("an absent root scans to nothing, never throws", async () => {
    const found = await findDisplacedHubs("/definitely/not/here", "host/o/r", 2);
    expect(found).toEqual([]);
  });

  it("depth < 1 returns nothing without touching the filesystem", async () => {
    const found = await findDisplacedHubs("/whatever", "host/o/r", 0);
    expect(found).toEqual([]);
  });
});
