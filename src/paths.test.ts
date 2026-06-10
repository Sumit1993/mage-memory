import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  META_DIR,
  METADATA_SCHEMA,
  hubProjectDocsRoot,
  hubProjectPath,
  looksLikeHub,
  resolveDocsRoot,
} from "./paths.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("paths", () => {
  it("uses the mage constants", () => {
    expect(META_DIR).toBe("mage");
    expect(METADATA_SCHEMA).toBe("mage.v1");
  });

  it("resolveDocsRoot finds an in-repo vault by walking up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mage-paths-"));
    made.push(dir);
    await mkdir(join(dir, "mage"), { recursive: true });
    await writeFile(
      join(dir, "mage", "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, mode: "in-repo" }),
    );
    const sub = join(dir, "src", "deep");
    await mkdir(sub, { recursive: true });
    const r = await resolveDocsRoot(sub);
    expect(r?.kind).toBe("in-repo");
    expect(r?.root).toBe(join(dir, "mage"));
  });

  it("detects a hub by projects/ + metadata.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mage-hub-"));
    made.push(dir);
    await mkdir(join(dir, "projects"), { recursive: true });
    await writeFile(
      join(dir, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
    );
    expect(await looksLikeHub(dir)).toBe(true);
    expect((await resolveDocsRoot(dir))?.kind).toBe("hub");
  });

  it("resolveDocsRoot follows an external code repo to its hub project (capture routing)", async () => {
    // A hub that owns the project's notes.
    const hub = await mkdtemp(join(tmpdir(), "mage-exthub-"));
    made.push(hub);
    await mkdir(join(hub, "projects", "engine"), { recursive: true });
    await writeFile(
      join(hub, "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, name: "h", created_at: "", projects: [] }),
    );
    // A code repo linked in external mode → the hub owns its docs (no in-repo notes).
    const code = await mkdtemp(join(tmpdir(), "mage-extcode-"));
    made.push(code);
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

  it("resolveDocsRoot falls back to in-repo when external metadata is malformed", async () => {
    // mode=external but no hub_path → degrade to the code repo's own mage/ (never null).
    const code = await mkdtemp(join(tmpdir(), "mage-extbad-"));
    made.push(code);
    await mkdir(join(code, "mage"), { recursive: true });
    await writeFile(
      join(code, "mage", "metadata.json"),
      JSON.stringify({ schema: METADATA_SCHEMA, mode: "external", project: "x", hub_path: null }),
    );
    const r = await resolveDocsRoot(code);
    expect(r?.kind).toBe("in-repo");
    expect(r?.root).toBe(join(code, "mage"));
  });

  it("returns null when no knowledge base is found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mage-none-"));
    made.push(dir);
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
