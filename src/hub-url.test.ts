import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import {
  HubUrlError,
  canonicalizeHubRepo,
  chosenHubRoot,
  deriveHubPath,
  deriveHubPathSafe,
  hubsRoot,
  parseOriginUrlFromConfig,
  readGitConfigOriginUrl,
  redactUrl,
  verifyHubArrival,
} from "./hub-url.js";

// ─── canonicalizeHubRepo — equivalence / canonicalization ─────────────────

describe("canonicalizeHubRepo — equivalence", () => {
  it("scp-like, https, ssh:// and a trailing slash all derive the SAME key", () => {
    const forms = [
      "git@github.com:Owner/Repo.git",
      "https://github.com/owner/repo",
      "ssh://git@github.com/owner/repo.git",
      "https://github.com/owner/repo/",
    ];
    const keys = forms.map((f) => canonicalizeHubRepo(f).key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("github.com/owner/repo");
  });

  it("case-folds host and path segments", () => {
    expect(canonicalizeHubRepo("git@Github.com:Sumit1993/sreforge-memory.git").key).toBe(
      "github.com/sumit1993/sreforge-memory",
    );
  });

  it("strips exactly one trailing .git; foo.git.git keeps one", () => {
    expect(canonicalizeHubRepo("https://h/o/foo.git.git").segments).toEqual(["o", "foo.git"]);
  });

  it("a GitLab subgroup becomes three segments", () => {
    expect(canonicalizeHubRepo("https://gitlab.com/group/subgroup/repo.git").segments).toEqual([
      "group",
      "subgroup",
      "repo",
    ]);
  });
});

// ─── injectivity — the property the ADR exists for ────────────────────────

describe("canonicalizeHubRepo — injectivity", () => {
  it("acme/web-ui and acme-web/ui derive DIFFERENT keys (no lossy flattening)", () => {
    const a = canonicalizeHubRepo("https://h/acme/web-ui.git").key;
    const b = canonicalizeHubRepo("https://h/acme-web/ui.git").key;
    expect(a).not.toBe(b);
  });

  it("scp-like `host:2222/o/r` (PATH) and `ssh://host:2222/o/r` (PORT) derive DIFFERENT keys", () => {
    // BUG BEING GUARDED: reading the scp-like leading numeric segment as a port
    // collapses these onto the same directory. scp-like has NO port field —
    // "2222" here is a PATH component, not a port.
    const scpLike = canonicalizeHubRepo("git@host:2222/o/r.git");
    const sshPort = canonicalizeHubRepo("ssh://git@host:2222/o/r.git");
    expect(scpLike.key).not.toBe(sshPort.key);
    expect(scpLike.segments).toEqual(["2222", "o", "r"]);
    expect(sshPort.host).toBe("host_2222");
    expect(sshPort.segments).toEqual(["o", "r"]);
  });

  it("ssh:// with the default port (22) drops it — matches the portless scp-like form", () => {
    expect(canonicalizeHubRepo("ssh://git@host/o/r.git").key).toBe(
      canonicalizeHubRepo("git@host:o/r.git").key,
    );
  });

  it("https://./o/r is REJECTED, so it cannot collide with https://o/r", () => {
    expect(() => canonicalizeHubRepo("https://./o/r.git")).toThrow(HubUrlError);
    // The would-be-colliding form still parses fine on its own.
    expect(canonicalizeHubRepo("https://o/r.git").key).toBe("o/r");
  });
});

// ─── safety ─────────────────────────────────────────────────────────────

describe("canonicalizeHubRepo — safety", () => {
  it("drops userinfo (a credential) from the derived path", () => {
    const c = canonicalizeHubRepo("https://x-access-token:ghp_SECRETTOKEN@github.com/o/r.git");
    expect(c.key).toBe("github.com/o/r");
  });

  it("an embedded PAT never appears in a HubUrlError message", () => {
    // ~user rejection still fires; the point is the message text.
    let message = "";
    try {
      canonicalizeHubRepo("https://x-access-token:ghp_SECRETTOKEN@github.com/~alice/repo.git");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("ghp_SECRETTOKEN");
    expect(message).not.toContain("x-access-token:ghp_SECRETTOKEN");
  });

  it("host '.' is rejected", () => {
    expect(() => canonicalizeHubRepo("https://./o/r.git")).toThrow(HubUrlError);
  });

  it("host '..' is rejected", () => {
    expect(() => canonicalizeHubRepo("https://../o/r.git")).toThrow(HubUrlError);
  });

  it("an IPv6 host literal is rejected", () => {
    expect(() => canonicalizeHubRepo("ssh://git@[::1]:22/o/r.git")).toThrow(HubUrlError);
  });

  it("a '..' path segment is rejected", () => {
    expect(() => canonicalizeHubRepo("https://h/o/../r.git")).toThrow(HubUrlError);
  });

  it("an empty path segment (double slash) is rejected", () => {
    expect(() => canonicalizeHubRepo("https://h/o//r.git")).toThrow(HubUrlError);
  });

  it("percent-encoded traversal is NOT decoded — stays a literal, safe segment", () => {
    const c = canonicalizeHubRepo("https://h/o/%2e%2e.git");
    expect(c.segments).toEqual(["o", "%2e%2e"]);
  });

  it("./foo:bar is NOT parsed as an scp remote (a slash precedes the colon) — rejected AS a local path", () => {
    // Message-specific: a bare indexOf(":") would still misparse "./foo" as an
    // scp-like authority, which happens to ALSO get rejected (it contains "/",
    // an unsafe host character) — but for the WRONG reason. Asserting the
    // "local path" message is what actually pins down the slash-position rule.
    expect(() => canonicalizeHubRepo("./foo:bar")).toThrow(/local path/i);
  });

  it("a bare local path is rejected", () => {
    expect(() => canonicalizeHubRepo("/path/to/repo.git")).toThrow(HubUrlError);
  });

  it("ftp:// is rejected with its own message", () => {
    expect(() => canonicalizeHubRepo("ftp://host/o/r.git")).toThrow(/ftp/i);
  });

  it("ftps:// is rejected with its own message", () => {
    expect(() => canonicalizeHubRepo("ftps://host/o/r.git")).toThrow(/ftps/i);
  });

  it("file:// is rejected with its own message (local hubs use local://<name>)", () => {
    expect(() => canonicalizeHubRepo("file:///path/to/repo.git")).toThrow(/file:\/\//i);
  });

  it("a bare local path is rejected with its own message", () => {
    expect(() => canonicalizeHubRepo("/path/to/repo.git")).toThrow(/local path/i);
  });

  it("~user expansion (ssh://) is rejected with its own message", () => {
    expect(() => canonicalizeHubRepo("ssh://git@host/~alice/repo.git")).toThrow(/~/);
  });

  it("~user expansion (scp-like, explicit leading slash) is rejected", () => {
    expect(() => canonicalizeHubRepo("git@host:/~alice/repo.git")).toThrow(/~/);
  });
});

// ─── redaction ──────────────────────────────────────────────────────────

describe("redactUrl", () => {
  it("strips userinfo from an https:// URL", () => {
    expect(redactUrl("https://x-access-token:ghp_SECRET@github.com/o/r.git")).toBe(
      "https://github.com/o/r.git",
    );
  });

  it("strips userinfo from an scp-like remote", () => {
    expect(redactUrl("git@host:o/r.git")).toBe("host:o/r.git");
  });

  it("is a no-op on a URL with no userinfo", () => {
    expect(redactUrl("https://github.com/o/r.git")).toBe("https://github.com/o/r.git");
  });

  it("never throws on unparseable input", () => {
    expect(() => redactUrl("::::not a url::::")).not.toThrow();
  });
});

// ─── derivation ─────────────────────────────────────────────────────────

describe("deriveHubPath / deriveHubPathSafe / chosenHubRoot", () => {
  it("derives <root>/<host>/<segments...>", () => {
    expect(deriveHubPath("git@github.com:owner/repo.git", "/root")).toBe(
      "/root/github.com/owner/repo",
    );
  });

  it("deriveHubPathSafe returns null instead of throwing on a bad URL", () => {
    expect(deriveHubPathSafe("/local/path", "/root")).toBeNull();
  });

  it("hubsRoot honors MAGE_HOME", () => {
    const saved = process.env.MAGE_HOME;
    process.env.MAGE_HOME = "/custom/home";
    try {
      expect(hubsRoot()).toBe(join("/custom/home", "hubs"));
    } finally {
      if (saved === undefined) delete process.env.MAGE_HOME;
      else process.env.MAGE_HOME = saved;
    }
  });

  it("chosenHubRoot prefers a derivable hub_repo over hub_path", () => {
    expect(chosenHubRoot("git@h:o/r.git", "/legacy/hub", "/root")).toEqual({
      root: "/root/h/o/r",
      source: "derived",
    });
  });

  it("chosenHubRoot falls back to hub_path when hub_repo doesn't canonicalize", () => {
    expect(chosenHubRoot("/not/a/url", "/legacy/hub", "/root")).toEqual({
      root: "/legacy/hub",
      source: "hub_path",
    });
  });

  it("chosenHubRoot returns null when both are absent", () => {
    expect(chosenHubRoot(null, null, "/root")).toBeNull();
  });
});

// ─── git config parsing (no shelling out) ──────────────────────────────────

describe("parseOriginUrlFromConfig", () => {
  it("reads the url under [remote \"origin\"]", () => {
    const cfg = [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "origin"]',
      "\turl = https://github.com/o/r.git",
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    ].join("\n");
    expect(parseOriginUrlFromConfig(cfg)).toBe("https://github.com/o/r.git");
  });

  it("ignores a url under a different remote section", () => {
    const cfg = ['[remote "upstream"]', "\turl = https://github.com/other/repo.git"].join("\n");
    expect(parseOriginUrlFromConfig(cfg)).toBeNull();
  });

  it("returns null when there is no remote section at all", () => {
    expect(parseOriginUrlFromConfig("[core]\n\tbare = false\n")).toBeNull();
  });
});

describe("readGitConfigOriginUrl", () => {
  it("reads a plain repo's .git/config", async () => {
    const dir = await tmpDir("mage-gitcfg-");
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(
      join(dir, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:o/r.git\n',
    );
    expect(await readGitConfigOriginUrl(dir)).toBe("git@github.com:o/r.git");
  });

  it("follows the worktree gitdir: indirection to the COMMON config", async () => {
    const main = await tmpDir("mage-gitcfg-main-");
    const mainGitDir = join(main, ".git");
    await mkdir(mainGitDir, { recursive: true });
    await writeFile(
      join(mainGitDir, "config"),
      '[remote "origin"]\n\turl = https://github.com/o/r.git\n',
    );
    const worktreeGitDir = join(mainGitDir, "worktrees", "wt1");
    await mkdir(worktreeGitDir, { recursive: true });
    await writeFile(join(worktreeGitDir, "commondir"), "../..\n");

    const worktree = await tmpDir("mage-gitcfg-wt-");
    await writeFile(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);

    expect(await readGitConfigOriginUrl(worktree)).toBe("https://github.com/o/r.git");
  });

  it("returns null (never throws) when there is no .git at all", async () => {
    const dir = await tmpDir("mage-gitcfg-none-");
    expect(await readGitConfigOriginUrl(dir)).toBeNull();
  });
});

// ─── arrival verification ───────────────────────────────────────────────

describe("verifyHubArrival", () => {
  async function makeHub(origin: string | null): Promise<string> {
    const hub = await tmpDir("mage-arrival-");
    await mkdir(join(hub, "projects"), { recursive: true });
    await writeFile(join(hub, "metadata.json"), JSON.stringify({ schema: "mage.v2" }));
    if (origin) {
      await mkdir(join(hub, ".git"), { recursive: true });
      await writeFile(join(hub, ".git", "config"), `[remote "origin"]\n\turl = ${origin}\n`);
    }
    return hub;
  }

  it("ok when the clone's origin canonicalizes to the same key as hub_repo", async () => {
    const hub = await makeHub("https://github.com/o/r.git");
    const result = await verifyHubArrival(hub, "git@github.com:o/r.git");
    expect(result).toEqual({ ok: true });
  });

  it("absent when nothing is at the derived path", async () => {
    const dir = await tmpDir("mage-arrival-absent-");
    const result = await verifyHubArrival(join(dir, "nope"), "git@h:o/r.git");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("absent");
  });

  it("not-a-hub when the directory exists but lacks projects/+metadata.json", async () => {
    const dir = await tmpDir("mage-arrival-shape-");
    const result = await verifyHubArrival(dir, "git@h:o/r.git");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-a-hub");
  });

  it("origin-mismatch is a hard, named failure — never silently reused", async () => {
    const hub = await makeHub("https://github.com/other/repo.git");
    const result = await verifyHubArrival(hub, "git@github.com:o/r.git");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("origin-mismatch");
    expect(result.detail).toContain("github.com:o/r.git");
    expect(result.detail).toContain("github.com/other/repo.git");
  });

  it("a mismatch's detail never quotes an unredacted credential", async () => {
    const hub = await makeHub("https://x-access-token:ghp_SECRET@github.com/other/repo.git");
    const result = await verifyHubArrival(hub, "https://x-access-token:ghp_OTHERSECRET@github.com/o/r.git");
    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain("ghp_SECRET");
    expect(result.detail).not.toContain("ghp_OTHERSECRET");
  });

  it("origin-unreadable when the hub-shaped directory has no readable git config", async () => {
    const hub = await tmpDir("mage-arrival-noconfig-");
    await mkdir(join(hub, "projects"), { recursive: true });
    await writeFile(join(hub, "metadata.json"), JSON.stringify({ schema: "mage.v2" }));
    const result = await verifyHubArrival(hub, "git@h:o/r.git");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("origin-unreadable");
  });
});
