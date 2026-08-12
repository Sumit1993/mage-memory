import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpDir } from "../test/fixtures/kb.js";
import {
  type HubMetadata,
  META_DIR,
  METADATA_SCHEMA,
  METADATA_SCHEMA_V1,
  type MageMetadata,
  hubMetadataPath,
  findCodeRepoRoot,
  hubProjectDocsRoot,
  hubProjectPath,
  isUnder,
  looksLikeHub,
  outOfRepoKbRoots,
  outOfRepoKbTargets,
  metadataPath,
  normalizeHubMetadata,
  normalizeMetadata,
  ownedDocsRoots,
  readHubMetadata,
  externalDocsRoot,
  readMetadata,
  resolveDocsRoot,
  writeHubMetadata,
  writeMetadata,
} from "./paths.js";

describe("paths", () => {
  it("uses the mage constants", () => {
    expect(META_DIR).toBe("mage");
    expect(METADATA_SCHEMA).toBe("mage.v2");
  });

  it("resolveDocsRoot finds a repo KB by walking up", async () => {
    const dir = await tmpDir("mage-paths-");
    await mkdir(join(dir, "mage"), { recursive: true });
    await writeFile(
      join(dir, "mage", "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, mode: "in-repo" }),
    );
    const sub = join(dir, "src", "deep");
    await mkdir(sub, { recursive: true });
    const r = await resolveDocsRoot(sub);
    expect(r?.kind).toBe("repo");
    expect(r?.root).toBe(join(dir, "mage"));
  });

  it("detects a hub by projects/ + metadata.json", async () => {
    const dir = await tmpDir("mage-hub-");
    await mkdir(join(dir, "projects"), { recursive: true });
    await writeFile(
      join(dir, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
    );
    expect(await looksLikeHub(dir)).toBe(true);
    expect((await resolveDocsRoot(dir))?.kind).toBe("hub");
  });

  it("resolveDocsRoot resolves a hub-owned project dir directly (groom fan-out, Decision 1)", async () => {
    // A hub-owned project (`<hub>/projects/<name>/`) is a flat docs root with NO
    // metadata.json of its own. Pointing the engine at it (e.g. `distill --dir
    // <hub>/projects/engine`) must resolve to that project so the fan-out can groom
    // its `.learnings/` even when the member code repo is absent on this machine.
    const hub = await tmpDir("mage-projhub-");
    await mkdir(join(hub, "projects", "engine", "notes"), { recursive: true });
    await writeFile(
      join(hub, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
    );
    const proj = hubProjectDocsRoot(hub, "engine");
    // From the project root AND a deep subdir, resolve to the project (kind hub, repo = hub).
    for (const start of [proj, join(proj, "notes")]) {
      const r = await resolveDocsRoot(start);
      expect(r?.root).toBe(proj);
      expect(r?.kind).toBe("hub");
      expect(r?.repo).toBe(hub);
    }
  });

  it("resolveDocsRoot resolves a non-project dir inside a hub to the hub root", async () => {
    const hub = await tmpDir("mage-inhub-");
    await mkdir(join(hub, "projects"), { recursive: true });
    await mkdir(join(hub, "notes", "deep"), { recursive: true });
    await writeFile(
      join(hub, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
    );
    const r = await resolveDocsRoot(join(hub, "notes", "deep"));
    expect(r?.root).toBe(hub);
    expect(r?.kind).toBe("hub");
  });

  it("resolveDocsRoot follows an external code repo to its hub project (capture routing)", async () => {
    // A hub that owns the project's notes.
    const hub = await tmpDir("mage-exthub-");
    await mkdir(join(hub, "projects", "engine"), { recursive: true });
    await writeFile(
      join(hub, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
    );
    // A code repo linked in external mode → the hub owns its docs (no in-repo notes).
    const code = await tmpDir("mage-extcode-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: METADATA_SCHEMA,
        mode: "external",
        project: "engine",
        hub_path: hub,
        hub_repo: null,
        hub_refs: [],
        linked_at: "",
      }),
    );
    // From the code repo AND a nested subdir, captures must resolve to the hub project
    // (root = <hub>/projects/engine), not the code repo's own mage/ dir.
    for (const start of [code, join(code, "src", "deep")]) {
      await mkdir(start, { recursive: true });
      const r = await resolveDocsRoot(start);
      expect(r?.root).toBe(hubProjectDocsRoot(hub, "engine"));
      expect(r?.repo).toBe(hub);
      expect(r?.kind).toBe("hub");
    }
  });

  it("resolveDocsRoot derives the hub from hub_repo when its origin matches (ADR-0043)", async () => {
    const mageHome = await tmpDir("mage-derive-home-");
    const saved = process.env.MAGE_HOME;
    process.env.MAGE_HOME = mageHome;
    try {
      const hubRepo = "https://github.com/acme/docs.git";
      const derived = join(mageHome, "hubs", "github.com", "acme", "docs");
      await mkdir(join(derived, "projects", "engine"), { recursive: true });
      await writeFile(
        join(derived, "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
      );
      await mkdir(join(derived, ".git"), { recursive: true });
      await writeFile(join(derived, ".git", "config"), `[remote "origin"]\n\turl = ${hubRepo}\n`);

      const code = await tmpDir("mage-derive-code-");
      await mkdir(join(code, "mage"), { recursive: true });
      await writeFile(
        join(code, "mage", "metadata.json"),
        JSON.stringify({
          schema: METADATA_SCHEMA,
          mode: "external",
          project: "engine",
          hub_path: null,
          hub_repo: hubRepo,
          hub_refs: [],
          linked_at: "",
        }),
      );

      const r = await resolveDocsRoot(code);
      expect(r?.root).toBe(hubProjectDocsRoot(derived, "engine"));
      expect(r?.repo).toBe(derived);
    } finally {
      if (saved === undefined) delete process.env.MAGE_HOME;
      else process.env.MAGE_HOME = saved;
    }
  });

  it("resolveDocsRoot degrades to hub_path when the derived hub's origin MISMATCHES (never throws, never reuses)", async () => {
    const mageHome = await tmpDir("mage-derive-mismatch-home-");
    const saved = process.env.MAGE_HOME;
    process.env.MAGE_HOME = mageHome;
    try {
      const hubRepo = "https://github.com/acme/docs.git";
      const derived = join(mageHome, "hubs", "github.com", "acme", "docs");
      await mkdir(join(derived, "projects"), { recursive: true });
      await writeFile(
        join(derived, "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
      );
      await mkdir(join(derived, ".git"), { recursive: true });
      // A DIFFERENT remote sits at the derived location.
      await writeFile(
        join(derived, ".git", "config"),
        '[remote "origin"]\n\turl = https://github.com/other/repo.git\n',
      );

      const legacyHub = await tmpDir("mage-derive-legacy-");
      await mkdir(join(legacyHub, "projects", "engine"), { recursive: true });
      await writeFile(
        join(legacyHub, "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, name: "h2", created_at: "", projects: [] }),
      );

      const code = await tmpDir("mage-derive-mismatch-code-");
      await mkdir(join(code, "mage"), { recursive: true });
      await writeFile(
        join(code, "mage", "metadata.json"),
        JSON.stringify({
          schema: METADATA_SCHEMA,
          mode: "external",
          project: "engine",
          hub_path: legacyHub,
          hub_repo: hubRepo,
          hub_refs: [],
          linked_at: "",
        }),
      );

      const r = await resolveDocsRoot(code);
      // Never throws, never silently reuses the mismatched derived clone —
      // degrades to the deprecated hub_path fallback instead.
      expect(r?.repo).toBe(legacyHub);
      expect(r?.root).toBe(hubProjectDocsRoot(legacyHub, "engine"));
    } finally {
      if (saved === undefined) delete process.env.MAGE_HOME;
      else process.env.MAGE_HOME = saved;
    }
  });

  it("resolveDocsRoot returns null on a malformed hub_repo (mode: external) — never degrades to repo KB", async () => {
    const code = await tmpDir("mage-derive-malformed-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({
        schema: METADATA_SCHEMA,
        mode: "external",
        project: "engine",
        hub_path: null,
        hub_repo: "/not/a/valid/git/url", // a bare local path — canonicalizeHubRepo rejects it
        hub_refs: [],
        linked_at: "",
      }),
    );
    const r = await resolveDocsRoot(code);
    expect(r).toBeNull();
  });

  it("resolveDocsRoot returns null when external metadata is malformed", async () => {
    // mode=external but no hub_path → returns null (never degrades to repo KB).
    const code = await tmpDir("mage-extbad-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, mode: "external", project: "x", hub_path: null }),
    );
    const r = await resolveDocsRoot(code);
    expect(r).toBeNull();
  });

  describe("externalDocsRoot discriminated results (issue #158)", () => {
    it("returns not-external when mode is in-repo or hybrid or metadata absent", async () => {
      const code = await tmpDir("mage-inrepo-");
      await mkdir(join(code, "mage"), { recursive: true });
      await writeFile(
        join(code, "mage", "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, mode: "in-repo", project: "x" }),
      );
      expect(await externalDocsRoot(code)).toEqual({ kind: "not-external" });

      const noMeta = await tmpDir("mage-nometa-");
      expect(await externalDocsRoot(noMeta)).toEqual({ kind: "not-external" });
    });

    it("returns hub-unreachable (malformed-config) when mode is external but project is missing", async () => {
      const code = await tmpDir("mage-noproject-");
      await mkdir(join(code, "mage"), { recursive: true });
      await writeFile(
        join(code, "mage", "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, mode: "external", hub_path: "/some/path" }),
      );
      const res = await externalDocsRoot(code);
      expect(res).toEqual({
        kind: "hub-unreachable",
        reason: "malformed-config",
        expected: "/some/path",
      });
    });

    it("returns hub-unreachable (no-hub-target) when mode is external but hub_repo and hub_path are absent/null", async () => {
      const code = await tmpDir("mage-notarget-");
      await mkdir(join(code, "mage"), { recursive: true });
      await writeFile(
        join(code, "mage", "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, mode: "external", project: "engine", hub_path: null, hub_repo: null }),
      );
      const res = await externalDocsRoot(code);
      expect(res).toEqual({
        kind: "hub-unreachable",
        reason: "no-hub-target",
        expected: undefined,
      });
    });

    it("returns hub-unreachable (hub-corrupted) when hub_path does not look like a hub", async () => {
      const code = await tmpDir("mage-badpath-");
      await mkdir(join(code, "mage"), { recursive: true });
      const nonHub = await tmpDir("not-a-hub-");
      await writeFile(
        join(code, "mage", "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, mode: "external", project: "engine", hub_path: nonHub }),
      );
      const res = await externalDocsRoot(code);
      expect(res).toEqual({
        kind: "hub-unreachable",
        reason: "hub-corrupted",
        expected: nonHub,
      });
    });

    it("returns hub-unreachable (unknown-failure) on read error", async () => {
      const code = await tmpDir("mage-corruptmeta-");
      await mkdir(join(code, "mage"), { recursive: true });
      await writeFile(join(code, "mage", "metadata.json"), "invalid json{");
      const res = await externalDocsRoot(code);
      expect(res).toEqual({
        kind: "hub-unreachable",
        reason: "unknown-failure",
      });
    });
  });

  it("returns null when no knowledge base is found", async () => {
    const dir = await tmpDir("mage-none-");
    expect(await resolveDocsRoot(dir)).toBeNull();
  });

  it("hubProjectDocsRoot is flat — projects/<name>/ with no mage/ nesting (ADR-0011 §6)", () => {
    const hub = "/hub";
    expect(hubProjectDocsRoot(hub, "engine")).toBe(join(hub, "projects", "engine"));
    expect(hubProjectDocsRoot(hub, "engine")).toBe(hubProjectPath(hub, "engine"));
    expect(hubProjectDocsRoot(hub, "engine").endsWith(`${"projects"}/engine/${META_DIR}`)).toBe(false);
  });

  it("hubProjectDocsRoot rejects unsafe project names", () => {
    expect(() => hubProjectDocsRoot("/hub", "..")).toThrow();
    expect(() => hubProjectDocsRoot("/hub", "a/b")).toThrow();
  });
});

describe("paths — schema migration (Dec 9 / v1 → v2)", () => {
  it("METADATA_SCHEMA_V1 is the prior version; current is v2", () => {
    expect(METADATA_SCHEMA_V1).toBe("mage.v1");
    expect(METADATA_SCHEMA).toBe("mage.v2");
  });

  it("readMetadata reads v1 leniently: in-repo + hub_refs → hybrid; on-disk schema preserved", async () => {
    const code = await tmpDir("mage-v1read-");
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
    const meta = await readMetadata(code);
    expect(meta?.mode).toBe("hybrid"); // normalized in memory
    expect(meta?.schema).toBe("mage.v1"); // on-disk value kept so status/doctor can flag it
  });

  it("readMetadata leaves a pure v1 in-repo (no refs) as in-repo", async () => {
    const code = await tmpDir("mage-v1pure-");
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
    expect((await readMetadata(code))?.mode).toBe("in-repo");
  });

  it("readMetadata throws on a genuinely foreign schema", async () => {
    const code = await tmpDir("mage-foreign-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(metadataPath(code), JSON.stringify({ schema: "mage.v99", mode: "in-repo" }));
    await expect(readMetadata(code)).rejects.toThrow(/schema/i);
  });

  it("readHubMetadata reads v1 leniently: storage in-repo → repo-owned; schema preserved", async () => {
    const hub = await tmpDir("mage-hubv1-");
    await writeFile(
      hubMetadataPath(hub),
      JSON.stringify({
        schema: "mage.v1",
        name: "h",
        created_at: "t",
        projects: [
          { name: "a", storage: "in-repo", code_repo_path: "/a", code_repo_url: "ua" },
          { name: "b", storage: "hub-owned", code_repo_path: "/b", code_repo_url: "ub" },
        ],
      }),
    );
    const hubMeta = await readHubMetadata(hub);
    expect(hubMeta?.projects.find((p) => p.name === "a")?.storage).toBe("repo-owned");
    expect(hubMeta?.projects.find((p) => p.name === "b")?.storage).toBe("hub-owned");
    expect(hubMeta?.schema).toBe("mage.v1");
  });

  it("readHubMetadata throws on a foreign schema", async () => {
    const hub = await tmpDir("mage-hubforeign-");
    await writeFile(hubMetadataPath(hub), JSON.stringify({ schema: "nope", name: "h", projects: [] }));
    await expect(readHubMetadata(hub)).rejects.toThrow(/schema/i);
  });

  it("normalizeMetadata is idempotent + immutable on a v2 hybrid (same reference)", () => {
    const v2: MageMetadata = {
      schema: "mage.v2",
      mode: "hybrid",
      project: "x",
      hub_path: null,
      hub_repo: null,
      hub_refs: [{ hub_path: "/h", hub_repo: "u", project: "x" }],
      linked_at: "t",
    };
    expect(normalizeMetadata(v2)).toBe(v2);
  });

  it("normalizeHubMetadata is a no-op (same reference) when all storage is already v2", () => {
    const hub: HubMetadata = {
      schema: "mage.v2",
      name: "h",
      created_at: "t",
      projects: [{ name: "a", storage: "hub-owned", code_repo_path: "/a", code_repo_url: "u" }],
    };
    expect(normalizeHubMetadata(hub)).toBe(hub);
  });

  it("writeMetadata stamps the current schema (lazy migration on write)", async () => {
    const code = await tmpDir("mage-writestamp-");
    await mkdir(join(code, "mage"), { recursive: true });
    await writeMetadata(code, {
      schema: "mage.v1",
      mode: "in-repo",
      project: "x",
      hub_path: null,
      hub_repo: null,
      hub_refs: [],
      linked_at: "t",
    });
    const raw = JSON.parse(await readFile(metadataPath(code), "utf8"));
    expect(raw.schema).toBe("mage.v2");
  });

  it("writeHubMetadata stamps the current schema", async () => {
    const hub = await tmpDir("mage-hubwrite-");
    await writeHubMetadata(hub, { schema: "mage.v1", name: "h", created_at: "t", projects: [] });
    const raw = JSON.parse(await readFile(hubMetadataPath(hub), "utf8"));
    expect(raw.schema).toBe("mage.v2");
  });

  describe("ownedDocsRoots (the shared hub fan-out enumerator)", () => {
    async function hubWithProjects(names: string[]): Promise<string> {
      const hub = await tmpDir("mage-owned-");
      await mkdir(join(hub, "projects"), { recursive: true });
      const projects = names.map((name) => ({
        name,
        storage: "hub-owned",
        code_repo_path: "",
        code_repo_url: "",
      }));
      await writeFile(
        join(hub, "metadata.json"),
        JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects }),
      );
      return hub;
    }

    it("a repo KB owns only its own docs root", async () => {
      const dir = await tmpDir("mage-ownrepo-");
      const root = join(dir, "mage");
      expect(await ownedDocsRoots({ root, kind: "repo", repo: dir })).toEqual([root]);
    });

    it("a hub root owns its root PLUS every registered project, in order", async () => {
      const hub = await hubWithProjects(["engine", "platform"]);
      expect(await ownedDocsRoots({ root: hub, kind: "hub", repo: hub })).toEqual([
        hub,
        hubProjectDocsRoot(hub, "engine"),
        hubProjectDocsRoot(hub, "platform"),
      ]);
    });

    it("a hub-owned project (root ≠ repo) owns only itself — never recurses", async () => {
      const hub = await hubWithProjects(["engine"]);
      const proj = hubProjectDocsRoot(hub, "engine");
      expect(await ownedDocsRoots({ root: proj, kind: "hub", repo: hub })).toEqual([proj]);
    });

    it("a hub root with no registered projects owns just the root", async () => {
      const hub = await hubWithProjects([]);
      expect(await ownedDocsRoots({ root: hub, kind: "hub", repo: hub })).toEqual([hub]);
    });

    it("fails open to just the root when hub metadata is absent/unreadable", async () => {
      const dir = await tmpDir("mage-ownmissing-");
      expect(await ownedDocsRoots({ root: dir, kind: "hub", repo: dir })).toEqual([dir]);
    });
  });
});

describe("isUnder", () => {
  it("a dir is under itself", () => {
    expect(isUnder("/a/b", "/a/b")).toBe(true);
  });

  it("a descendant is under", () => {
    expect(isUnder("/a/b", "/a/b/c/d")).toBe(true);
  });

  it("a sibling is not under", () => {
    expect(isUnder("/a/b", "/a/c")).toBe(false);
  });

  it("a parent is not under its child", () => {
    expect(isUnder("/a/b/c", "/a/b")).toBe(false);
  });

  it("a prefix-sharing sibling is not under (no substring false positive)", () => {
    expect(isUnder("/a/repo", "/a/repo-other")).toBe(false);
  });
});

describe("outOfRepoKbRoots / outOfRepoKbTargets (ADR-0043)", () => {
  const REPO = "/home/u/org/code";
  const HUB = "/home/u/org/docs-hub"; // a legacy hub_path fallback value
  let mageHome: string;
  const savedMageHome = process.env.MAGE_HOME;

  beforeEach(async () => {
    mageHome = await tmpDir("mage-outofrepo-");
    process.env.MAGE_HOME = mageHome;
  });

  afterEach(() => {
    if (savedMageHome === undefined) delete process.env.MAGE_HOME;
    else process.env.MAGE_HOME = savedMageHome;
  });

  const hubsRootDir = () => join(mageHome, "hubs");

  const base = (over: Partial<MageMetadata> = {}): MageMetadata => ({
    schema: METADATA_SCHEMA,
    mode: "in-repo",
    project: "p",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("in-repo grants nothing — the docs already sit under the project root", () => {
    expect(outOfRepoKbRoots(base(), REPO)).toEqual([]);
  });

  it("external with hub_repo DERIVES its path — hub_repo is authoritative over hub_path", () => {
    const meta = base({ mode: "external", hub_path: HUB, hub_repo: "git@x:y.git" });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([join(hubsRootDir(), "x", "y")]);
  });

  it("external with no hub_repo falls back to hub_path", () => {
    const meta = base({ mode: "external", hub_path: HUB, hub_repo: null });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([HUB]);
  });

  it("external with an unparseable hub_repo falls back to hub_path rather than throwing", () => {
    const meta = base({ mode: "external", hub_path: HUB, hub_repo: "/not/a/valid/git/url" });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([HUB]);
  });

  it("external with neither hub_repo nor hub_path grants nothing (degraded metadata)", () => {
    expect(outOfRepoKbRoots(base({ mode: "external" }), REPO)).toEqual([]);
  });

  it("hybrid grants every registered hub_ref, each independently derived", () => {
    const meta = base({
      hub_refs: [
        { hub_path: HUB, hub_repo: "git@x:a.git", project: "p" },
        { hub_path: "/home/u/org/hub2", hub_repo: "git@x:b.git", project: "p" },
      ],
    });
    // v1-shaped (mode "in-repo" + refs) normalizes to hybrid in memory.
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([
      join(hubsRootDir(), "x", "a"),
      join(hubsRootDir(), "x", "b"),
    ]);
  });

  it("drops a hub that sits INSIDE the project root (self-referential)", () => {
    const inside = join(REPO, "docs-hub");
    const meta = base({ mode: "external", hub_path: inside, hub_repo: null });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([]);
  });

  it("drops a hub equal to the project root", () => {
    const meta = base({ mode: "external", hub_path: REPO, hub_repo: null });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([]);
  });

  it("de-duplicates repeated hub_refs", () => {
    const meta = base({
      hub_refs: [
        { hub_path: HUB, hub_repo: "git@x:a.git", project: "p" },
        { hub_path: HUB, hub_repo: "git@x:a.git", project: "q" },
      ],
    });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([join(hubsRootDir(), "x", "a")]);
  });

  it("is pure — no filesystem access, so a non-existent derived hub is still returned", () => {
    const meta = base({ mode: "external", hub_repo: "git@nope-host:not/here.git", hub_path: null });
    expect(outOfRepoKbRoots(meta, REPO)).toEqual([join(hubsRootDir(), "nope-host", "not", "here")]);
  });

  it("outOfRepoKbTargets exposes source + hubRepo + hubPath (fallback) for the caller", () => {
    const meta = base({ mode: "external", hub_repo: "git@x:y.git", hub_path: HUB });
    expect(outOfRepoKbTargets(meta, REPO)).toEqual([
      {
        root: join(hubsRootDir(), "x", "y"),
        source: "derived",
        hubRepo: "git@x:y.git",
        hubPath: HUB,
      },
    ]);
  });

  it("outOfRepoKbTargets marks a hub_path fallback with source 'hub_path' and no hubRepo", () => {
    const meta = base({ mode: "external", hub_repo: null, hub_path: HUB });
    expect(outOfRepoKbTargets(meta, REPO)).toEqual([
      { root: HUB, source: "hub_path", hubRepo: undefined, hubPath: HUB },
    ]);
  });
});

describe("findCodeRepoRoot", () => {
  it("finds the repo root from a nested subdir", async () => {
    const dir = await tmpDir("mage-findrepo-");
    await mkdir(join(dir, META_DIR), { recursive: true });
    await writeFile(
      join(dir, META_DIR, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, mode: "in-repo", project: "p" }),
    );
    const nested = join(dir, "src", "deep");
    await mkdir(nested, { recursive: true });
    expect(await findCodeRepoRoot(nested)).toBe(dir);
  });

  it("returns the dir itself when it carries the metadata", async () => {
    const dir = await tmpDir("mage-findrepo-");
    await mkdir(join(dir, META_DIR), { recursive: true });
    await writeFile(
      join(dir, META_DIR, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, mode: "in-repo", project: "p" }),
    );
    expect(await findCodeRepoRoot(dir)).toBe(dir);
  });

  it("returns null when no code-repo KB exists above the start dir", async () => {
    const dir = await tmpDir("mage-findrepo-");
    expect(await findCodeRepoRoot(dir)).toBeNull();
  });
});
