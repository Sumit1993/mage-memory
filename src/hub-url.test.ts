import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import {
  canonicalizeHubRepo,
  deriveHubPath,
  HubUrlError,
  hubsRoot,
  resolveHubPath,
} from "./hub-url.js";
import {
  looksLikeHub,
  METADATA_SCHEMA,
  resolveDocsRoot,
  writeHubMetadata,
  writeMetadata,
} from "./paths.js";

describe("canonicalizeHubRepo — spec §8 unit tests", () => {
  it("Equivalence: various forms of the same repo produce identical .key", () => {
    const urls = [
      "git@github.com:Owner/Repo.git",
      "https://github.com/owner/repo",
      "ssh://git@github.com/owner/repo.git",
      "https://github.com/owner/repo/",
    ];

    const results = urls.map(canonicalizeHubRepo);
    const expectedKey = "github.com/owner/repo";

    for (const r of results) {
      expect(r.key).toBe(expectedKey);
      expect(r.host).toBe("github.com");
      expect(r.segments).toEqual(["owner", "repo"]);
    }
  });

  it("Case fold: Sumit1993/sreforge-memory -> sumit1993/sreforge-memory", () => {
    const r = canonicalizeHubRepo(
      "git@github.com:Sumit1993/sreforge-memory.git",
    );
    expect(r.key).toBe("github.com/sumit1993/sreforge-memory");
    expect(r.segments).toEqual(["sumit1993", "sreforge-memory"]);
  });

  it("Injectivity: acme/web-ui and acme-web/ui derive to different paths/keys", () => {
    const r1 = canonicalizeHubRepo("https://github.com/acme/web-ui");
    const r2 = canonicalizeHubRepo("https://github.com/acme-web/ui");

    expect(r1.key).toBe("github.com/acme/web-ui");
    expect(r2.key).toBe("github.com/acme-web/ui");
    expect(r1.key).not.toBe(r2.key);
    expect(r1.segments).toEqual(["acme", "web-ui"]);
    expect(r2.segments).toEqual(["acme-web", "ui"]);
  });

  it("Credential stripping: embedded PAT does not leak into host, segments, or key", () => {
    const url = "https://x-access-token:ghp_xxx@github.com/o/r.git";
    const r = canonicalizeHubRepo(url);

    expect(r.host).toBe("github.com");
    expect(r.segments).toEqual(["o", "r"]);
    expect(r.key).toBe("github.com/o/r");
    expect(r.key).not.includes("x-access-token");
    expect(r.key).not.includes("ghp_xxx");
  });

  it("Ports: default ports 443/22 dropped; non-default port joins host_port", () => {
    const rDefaultSsh = canonicalizeHubRepo(
      "ssh://git@github.com:22/owner/repo.git",
    );
    expect(rDefaultSsh.host).toBe("github.com");

    const rDefaultHttps = canonicalizeHubRepo(
      "https://github.com:443/owner/repo.git",
    );
    expect(rDefaultHttps.host).toBe("github.com");

    const rNonDefault = canonicalizeHubRepo("git@host:2222/o/r.git");
    expect(rNonDefault.host).toBe("host_2222");
    expect(rNonDefault.key).toBe("host_2222/o/r");
  });

  it("Subgroups: GitLab subgroups yield multi-segment paths", () => {
    const r = canonicalizeHubRepo("https://gitlab.com/group/subgroup/repo.git");
    expect(r.host).toBe("gitlab.com");
    expect(r.segments).toEqual(["group", "subgroup", "repo"]);
    expect(r.key).toBe("gitlab.com/group/subgroup/repo");
  });

  it("Traversal: hub_repo engineered to produce .. or empty segment throws HubUrlError", () => {
    expect(() => canonicalizeHubRepo("https://github.com/../repo")).toThrow(
      HubUrlError,
    );
    expect(() => canonicalizeHubRepo("git@github.com:foo/./bar")).toThrow(
      HubUrlError,
    );
    expect(() => canonicalizeHubRepo("https://github.com/foo//bar")).toThrow(
      HubUrlError,
    );

    // Also deriveHubPath checks
    expect(() => deriveHubPath("https://github.com/../repo")).toThrow(
      HubUrlError,
    );
  });

  it(".git stripping: exactly one trailing .git removed; foo.git.git keeps one", () => {
    const rSingle = canonicalizeHubRepo("https://github.com/owner/repo.git");
    expect(rSingle.segments).toEqual(["owner", "repo"]);

    const rDouble = canonicalizeHubRepo("https://github.com/owner/foo.git.git");
    expect(rDouble.segments).toEqual(["owner", "foo.git"]);
    expect(rDouble.key).toBe("github.com/owner/foo.git");
  });
});

describe("ADR-0043 Integration tests with temporary MAGE_HOME", () => {
  let tmpHome: string;
  let oldMageHome: string | undefined;

  beforeEach(async () => {
    oldMageHome = process.env.MAGE_HOME;
    tmpHome = await tmpDir();
    process.env.MAGE_HOME = tmpHome;
  });

  afterEach(() => {
    if (oldMageHome !== undefined) {
      process.env.MAGE_HOME = oldMageHome;
    } else {
      delete process.env.MAGE_HOME;
    }
  });

  async function createFakeHub(path: string, originUrl: string): Promise<void> {
    await mkdir(join(path, "projects"), { recursive: true });
    await mkdir(join(path, ".git"), { recursive: true });
    await writeHubMetadata(path, {
      schema: METADATA_SCHEMA,
      name: "test-hub",
      created_at: "2026-07-31T00:00:00Z",
      projects: [],
    });
    await writeFile(
      join(path, ".git", "config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${originUrl}\n`,
    );
  }

  it("origin match passes -> derived hub used", async () => {
    const hubRepo = "https://github.com/my-org/my-hub.git";
    const derived = deriveHubPath(hubRepo);

    await createFakeHub(derived, hubRepo);

    expect(await looksLikeHub(derived)).toBe(true);

    const res = await resolveHubPath({ hub_repo: hubRepo });
    expect(res.status).toBe("derived");
    expect(res.hubRoot).toBe(derived);
  });

  it("origin mismatch -> hard error naming BOTH remotes", async () => {
    const requestedRepo = "https://github.com/my-org/my-hub.git";
    const actualRepo = "https://github.com/other-org/other-hub.git";
    const derived = deriveHubPath(requestedRepo);

    // Create a clone at derived path with different origin
    await createFakeHub(derived, actualRepo);

    const res = await resolveHubPath({ hub_repo: requestedRepo });
    expect(res.status).toBe("origin_mismatch");
    expect(res.hubRoot).toBeNull();
    expect(res.error).toBeDefined();
    // Must name BOTH expected and found remotes
    expect(res.error).includes("github.com/my-org/my-hub");
    expect(res.error).includes("github.com/other-org/other-hub");
  });

  it("derived absent + hub_path set and valid -> falls back, emits deprecation notice", async () => {
    const requestedRepo = "https://github.com/my-org/missing-hub.git";
    const legacyPath = await tmpDir();
    await createFakeHub(legacyPath, "https://github.com/my-org/legacy-hub.git");

    const res = await resolveHubPath({
      hub_repo: requestedRepo,
      hub_path: legacyPath,
    });
    expect(res.status).toBe("fallback");
    expect(res.hubRoot).toBe(legacyPath);
    expect(res.deprecationNotice).toBeDefined();
    expect(res.deprecationNotice).includes("deprecated");
  });

  it("derived absent + a displaced clone with matching origin -> suggests mv, does NOT move", async () => {
    const requestedRepo = "https://github.com/my-org/renamed-hub.git";
    const derivedPath = deriveHubPath(requestedRepo);

    // Create a displaced hub clone inside hubsRoot under an old path
    const displacedPath = join(
      hubsRoot(),
      "github.com",
      "my-org",
      "old-hub-name",
    );
    await createFakeHub(displacedPath, requestedRepo);

    const res = await resolveHubPath({ hub_repo: requestedRepo });
    expect(res.status).toBe("misplaced");
    expect(res.hubRoot).toBeNull();
    expect(res.displacedScan?.misplaced).toBeDefined();
    expect(res.displacedScan?.misplaced?.path).toBe(displacedPath);
    expect(res.displacedScan?.misplaced?.mvCommand).toBe(
      `mv "${displacedPath}" "${derivedPath}"`,
    );

    // Verify it did NOT move the directory
    expect(await looksLikeHub(displacedPath)).toBe(true);
    expect(await looksLikeHub(derivedPath)).toBe(false);
  });

  it("resolveDocsRoot with a malformed hub_repo -> degrades to repo KB, does not throw", async () => {
    const codeRepo = await tmpDir();
    await mkdir(join(codeRepo, "mage"), { recursive: true });
    await writeMetadata(codeRepo, {
      schema: METADATA_SCHEMA,
      mode: "external",
      project: "test-proj",
      hub_path: null,
      hub_repo: "https://github.com/../malformed-repo",
      hub_refs: [],
      linked_at: "2026-07-31T00:00:00Z",
    });

    let resolved: Awaited<ReturnType<typeof resolveDocsRoot>> = null;
    expect(async () => {
      resolved = await resolveDocsRoot(codeRepo);
    }).not.toThrow();

    resolved = await resolveDocsRoot(codeRepo);
    expect(resolved).not.toBeNull();
    expect(resolved?.kind).toBe("repo");
    expect(resolved?.root).toBe(join(codeRepo, "mage"));
  });
});
