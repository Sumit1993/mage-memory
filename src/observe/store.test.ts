import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEARNINGS_ARCHIVE_DIR,
  LEARNINGS_DIR,
  LEARNINGS_PURGE_MARKER,
  learningsPath,
  STATE_DIR,
} from "../paths.js";
import {
  buildSessionStart,
  buildSkillLoad,
  buildToolUse,
} from "./events.js";
import {
  appendEvent,
  maybePurge,
  ROTATE_MAX_BYTES,
  resolveLearningsDir,
  sessionFilePath,
  SKILL_LOAD_PURGE_DAYS,
  TOOL_USE_PURGE_DAYS,
} from "./store.js";
import type { ObserveEvent } from "./types.js";

const META = JSON.stringify({ schema: "mage.v1", mode: "in-repo", project: "x" });
const BASE = { ts: "2026-06-06T00:00:00.000Z", session: "sess-1" };

async function mkTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mage-observe-store-"));
}

/** A code repo with an in-repo mage KB (mage/metadata.json present). */
async function inRepoKb(): Promise<string> {
  const repo = await mkTmp();
  await mkdir(join(repo, "mage"), { recursive: true });
  await writeFile(join(repo, "mage", "metadata.json"), META);
  return repo;
}

/** A hub root (projects/ + metadata.json). */
async function hubKb(): Promise<string> {
  const hub = await mkTmp();
  await mkdir(join(hub, "projects"), { recursive: true });
  await writeFile(join(hub, "metadata.json"), JSON.stringify({ schema: "mage.v1", name: "h" }));
  return hub;
}

const toolEvent = (): ObserveEvent =>
  buildToolUse(BASE, { tool: "Read", paths: ["/a.ts"], detail: null, ok: true, error_summary: null });

const skillEvent = (): ObserveEvent =>
  buildSkillLoad(BASE, { skill: "mage-wing-mage", args: null, match: null, trigger_hash: "h" });

describe("resolveLearningsDir", () => {
  it("returns <repo>/mage/.mage/learnings for an in-repo KB", async () => {
    const repo = await inRepoKb();
    expect(await resolveLearningsDir(repo)).toBe(learningsPath(join(repo, "mage")));
  });

  it("returns <hub>/.mage/learnings for a hub KB", async () => {
    const hub = await hubKb();
    expect(await resolveLearningsDir(hub)).toBe(learningsPath(hub));
  });

  it("returns null when no KB is found", async () => {
    const plain = await mkTmp();
    expect(await resolveLearningsDir(plain)).toBeNull();
  });
});

describe("sessionFilePath — session-id sanitization", () => {
  it("sanitizes a path-separator session id so it can't escape learningsDir", () => {
    const dir = "/tmp/learn";
    const p = sessionFilePath(dir, "../../etc/passwd");
    expect(p.startsWith(join(dir) + "/")).toBe(true);
    expect(p).not.toContain("..");
  });

  it("coerces an empty session id to a safe token (never throws)", () => {
    const dir = "/tmp/learn";
    expect(() => sessionFilePath(dir, "")).not.toThrow();
    expect(sessionFilePath(dir, "")).toMatch(/unknown\.jsonl$/);
  });

  it("caps a very long session id so it can't exceed NAME_MAX", () => {
    const dir = "/tmp/learn";
    const long = "s".repeat(1000);
    const p = sessionFilePath(dir, long);
    const name = p.slice(dir.length + 1);
    expect(name.length).toBeLessThanOrEqual(255);
  });
});

describe("appendEvent — append-only (O_APPEND, no read-before-append)", () => {
  it("creates the dir + file and writes exactly one JSON line per append", async () => {
    const repo = await inRepoKb();
    await appendEvent(repo, BASE.session, toolEvent());
    await appendEvent(repo, BASE.session, toolEvent());
    const dir = (await resolveLearningsDir(repo)) as string;
    const file = sessionFilePath(dir, BASE.session);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      const parsed = JSON.parse(l) as ObserveEvent;
      expect(parsed.v).toBe(1);
      expect(parsed.type).toBe("tool_use");
    }
  });

  it("preserves causal order (line order == append order)", async () => {
    const repo = await inRepoKb();
    await appendEvent(
      repo,
      BASE.session,
      buildSessionStart(BASE, { harness: "h", cwd: "/", repo_root: null, mage_version: "v", source: "s" }),
    );
    await appendEvent(repo, BASE.session, toolEvent());
    const dir = (await resolveLearningsDir(repo)) as string;
    const lines = (await readFile(sessionFilePath(dir, BASE.session), "utf8")).split("\n").filter(Boolean);
    expect((JSON.parse(lines[0] as string) as ObserveEvent).type).toBe("session_start");
    expect((JSON.parse(lines[1] as string) as ObserveEvent).type).toBe("tool_use");
  });

  it("concurrent appends produce two well-formed parseable lines (no interleaving)", async () => {
    const repo = await inRepoKb();
    await Promise.all([
      appendEvent(repo, BASE.session, toolEvent()),
      appendEvent(repo, BASE.session, toolEvent()),
    ]);
    const dir = (await resolveLearningsDir(repo)) as string;
    const lines = (await readFile(sessionFilePath(dir, BASE.session), "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it("keeps each serialized line under the atomic-write threshold (< PIPE_BUF 4096)", async () => {
    const repo = await inRepoKb();
    // A tool_use whose detail/error are at their caps — the largest line shape.
    const big = buildToolUse(BASE, {
      tool: "Bash",
      paths: [`/${"p".repeat(400)}`],
      detail: "d".repeat(200),
      ok: false,
      error_summary: "e".repeat(200),
    });
    await appendEvent(repo, BASE.session, big);
    const dir = (await resolveLearningsDir(repo)) as string;
    const line = (await readFile(sessionFilePath(dir, BASE.session), "utf8")).split("\n")[0] as string;
    expect(Buffer.byteLength(`${line}\n`, "utf8")).toBeLessThan(4096);
  });

  it("writes skill_load events to a per-session sidecar (.skills.jsonl) for longer retention", async () => {
    const repo = await inRepoKb();
    await appendEvent(repo, BASE.session, skillEvent());
    const dir = (await resolveLearningsDir(repo)) as string;
    const sidecar = join(dir, `${BASE.session}.skills.jsonl`);
    const lines = (await readFile(sidecar, "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] as string) as ObserveEvent).type).toBe("skill_load");
  });

  it("does NOT write a tool_use to the skills sidecar", async () => {
    const repo = await inRepoKb();
    await appendEvent(repo, BASE.session, toolEvent());
    const dir = (await resolveLearningsDir(repo)) as string;
    const sidecar = join(dir, `${BASE.session}.skills.jsonl`);
    await expect(readFile(sidecar, "utf8")).rejects.toThrow();
  });

  it("fails open (does not throw) when no KB is found", async () => {
    const plain = await mkTmp();
    await expect(appendEvent(plain, BASE.session, toolEvent())).resolves.toBeUndefined();
  });
});

describe("rotation — size cap (ECC parity)", () => {
  it("rotates a file >= ROTATE_MAX_BYTES into .archive and starts fresh", async () => {
    const repo = await inRepoKb();
    const dir = (await resolveLearningsDir(repo)) as string;
    await mkdir(dir, { recursive: true });
    const file = sessionFilePath(dir, BASE.session);
    await writeFile(file, "x".repeat(ROTATE_MAX_BYTES + 10));

    await appendEvent(repo, BASE.session, toolEvent());

    const archiveDir = join(dir, LEARNINGS_ARCHIVE_DIR);
    const archived = (await readdir(archiveDir)).filter((n) => n.endsWith(".jsonl") && !n.endsWith(".skills.jsonl"));
    expect(archived.length).toBeGreaterThanOrEqual(1);
    // The live file now holds ONLY the freshly-appended line.
    const live = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(live).toHaveLength(1);
  });
});

describe("age-purge — retention split (skill_load retained longer)", () => {
  const dayMs = 86_400_000;

  async function seedArchive(dir: string, name: string, ageDays: number): Promise<string> {
    const archiveDir = join(dir, LEARNINGS_ARCHIVE_DIR);
    await mkdir(archiveDir, { recursive: true });
    const p = join(archiveDir, name);
    await writeFile(p, '{"v":1}\n');
    const when = new Date(Date.now() - ageDays * dayMs);
    await utimes(p, when, when);
    return p;
  }

  it("deletes full archives older than TOOL_USE_PURGE_DAYS while a same-age .skills.jsonl survives", async () => {
    const repo = await inRepoKb();
    const dir = (await resolveLearningsDir(repo)) as string;
    await mkdir(dir, { recursive: true });
    const full = await seedArchive(dir, "sess-1-old.jsonl", TOOL_USE_PURGE_DAYS + 5);
    const skills = await seedArchive(dir, "sess-1-old.skills.jsonl", TOOL_USE_PURGE_DAYS + 5);

    await maybePurge(dir);

    await expect(stat(full)).rejects.toThrow(); // bulky tool_use archive expired at 30d
    await expect(stat(skills)).resolves.toBeTruthy(); // skill_load extract persists
  });

  it("deletes a .skills.jsonl only past SKILL_LOAD_PURGE_DAYS", async () => {
    const repo = await inRepoKb();
    const dir = (await resolveLearningsDir(repo)) as string;
    await mkdir(dir, { recursive: true });
    const skills = await seedArchive(dir, "sess-1-veryold.skills.jsonl", SKILL_LOAD_PURGE_DAYS + 5);

    await maybePurge(dir);

    await expect(stat(skills)).rejects.toThrow();
  });

  it("is throttled once-per-day by a fresh .last-purge marker (old archive survives)", async () => {
    const repo = await inRepoKb();
    const dir = (await resolveLearningsDir(repo)) as string;
    await mkdir(dir, { recursive: true });
    const full = await seedArchive(dir, "sess-1-old.jsonl", TOOL_USE_PURGE_DAYS + 5);
    // A fresh marker (mtime now) → purge is a no-op.
    await writeFile(join(dir, LEARNINGS_PURGE_MARKER), "");

    await maybePurge(dir);

    await expect(stat(full)).resolves.toBeTruthy();
  });

  it("swallows fs errors (points at a non-existent dir → resolves, no throw)", async () => {
    await expect(maybePurge(join("/nope-does-not-exist", STATE_DIR, LEARNINGS_DIR))).resolves.toBeUndefined();
  });
});
