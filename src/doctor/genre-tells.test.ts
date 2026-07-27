import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpDir } from "../../test/fixtures/kb.js";
import { doctor } from "../commands/doctor.js";
import { gitInit } from "../git.js";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import { logger } from "../logger.js";
import { METADATA_SCHEMA, resolveDocsRoot } from "../paths.js";
import { genreOf, TYPE_TO_GENRE } from "../scanner/genre-map.js";
import {
  checkNoteGenreTells,
  evaluateGenreTells,
  formatFlaggedNoteLine,
  formatGenreTellsSummary,
  renderGenreTells,
} from "./genre-tells.js";

async function freshDir(prefix = "mage-genre-tells-"): Promise<string> {
  return tmpDir(prefix);
}

async function makeTestKb(dir: string): Promise<void> {
  await gitInit(dir);
  await mkdir(join(dir, "mage", "notes"), { recursive: true });
  const meta = {
    schema: METADATA_SCHEMA,
    mode: "in-repo",
    project: "demo",
    hub_path: null,
    hub_repo: null,
    hub_refs: [],
    linked_at: new Date().toISOString(),
  };
  await writeFile(
    join(dir, "mage", "metadata.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  await writeFile(join(dir, "mage", "INDEX.md"), "# Index\n");
  await writeFile(join(dir, ".gitignore"), "mage/.mage/\n");
}

describe("genre tells — unit & fixture tests (ADR-0041 Wave 1)", () => {
  let home: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    home = await freshDir("mage-home-");
    origHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("TYPE_TO_GENRE and genreOf map note types to genres according to ADR-0041 §2", () => {
    expect(TYPE_TO_GENRE.gotcha).toBe("memory");
    expect(TYPE_TO_GENRE.procedure).toBe("memory");
    expect(TYPE_TO_GENRE.pointer).toBe("memory");
    expect(TYPE_TO_GENRE.principle).toBe("memory");
    expect(TYPE_TO_GENRE.feedback).toBe("memory");
    expect(TYPE_TO_GENRE.reference).toBe("memory");
    expect(TYPE_TO_GENRE.note).toBe("memory");
    expect(TYPE_TO_GENRE.decision).toBe("decision");
    expect(TYPE_TO_GENRE.plan).toBe("work");
    expect(TYPE_TO_GENRE.tasks).toBe("work");
    expect(TYPE_TO_GENRE.spec).toBe("doc");
    expect(TYPE_TO_GENRE.doc).toBe("doc");

    expect(genreOf("gotcha")).toBe("memory");
    expect(genreOf("decision")).toBe("decision");
    expect(genreOf("plan")).toBe("work");
    expect(genreOf("doc")).toBe("doc");
    expect(genreOf("unknown")).toBe("unclassified");
    expect(genreOf(undefined)).toBe("unclassified");
  });

  it("flags a fat memory-shaped note and leaves a small clean gotcha note unflagged", async () => {
    const dir = await freshDir();
    await makeTestKb(dir);

    // (a) Fat memory-shaped note (size > noteSizeCap, done-state vocab >= 5, issue refs >= 10, checkbox)
    const doneVocabText =
      "shipped deferred build order critical path PR #101 PR #102\n";
    const issueRefsText = "#1 #2 #3 #4 #5 #6 #7 #8 #9 #10\n";
    const checkboxText = "- [ ] todo task\n";
    const padding = "x".repeat(BASE_THRESHOLDS.noteSizeCap + 100);
    const fatNoteText = `---\ntype: gotcha\n---\n# Fat Memory Note\n${doneVocabText}${issueRefsText}${checkboxText}${padding}`;

    await writeFile(
      join(dir, "mage", "notes", "fat-memory-note.md"),
      fatNoteText,
    );

    // (b) Small clean gotcha note
    const smallGotchaText = `---\ntype: gotcha\n---\n# Small Gotcha Note\nJust a quick tip.\n`;
    await writeFile(
      join(dir, "mage", "notes", "clean-gotcha.md"),
      smallGotchaText,
    );

    const kb = (await resolveDocsRoot(dir))!;
    const report = await evaluateGenreTells(kb);

    expect(report.scannedCount).toBe(2);
    expect(report.flagged.length).toBe(1);

    const flagged = report.flagged[0]!;
    expect(flagged.relPath).toBe("mage/notes/fat-memory-note.md");
    expect(flagged.tells.size).toBeDefined();
    expect(flagged.tells.size).toBeGreaterThan(BASE_THRESHOLDS.noteSizeCap);
    expect(flagged.tells.doneVocab).toBeGreaterThanOrEqual(5);
    expect(flagged.tells.issueRefs).toBeGreaterThanOrEqual(10);
    expect(flagged.tells.checkboxes).toBeGreaterThanOrEqual(1);

    const formatted = formatFlaggedNoteLine(flagged);
    expect(formatted).toContain("mage/notes/fat-memory-note.md:");
    expect(formatted).toContain("size (");
    expect(formatted).toContain("done-state vocab (");
    expect(formatted).toContain("issue-ref density (");
    expect(formatted).toContain("checkboxes (");
  });

  it("scopes size tell to memory genre notes and ignores size for non-memory notes", () => {
    const fatBody = "x".repeat(BASE_THRESHOLDS.noteSizeCap + 500);

    const memoryNote = checkNoteGenreTells(
      `---\ntype: gotcha\n---\n${fatBody}`,
    );
    expect(memoryNote?.size).toBe(BASE_THRESHOLDS.noteSizeCap + 500);

    const planNote = checkNoteGenreTells(`---\ntype: plan\n---\n${fatBody}`);
    expect(planNote).toBeNull(); // size tell doesn't fire for work genre

    const decisionNote = checkNoteGenreTells(
      `---\ntype: decision\n---\n${fatBody}`,
    );
    expect(decisionNote).toBeNull(); // size tell doesn't fire for decision genre
  });

  it("threshold-reachability regression test: sizes just above and below noteSizeCap", () => {
    // This test exercises the default parameter path (omitting noteSizeCap argument)
    // to guarantee noteSizeCap from thresholds.ts remains the live threshold.
    const justAbove =
      `---\ntype: gotcha\n---\n` + "a".repeat(BASE_THRESHOLDS.noteSizeCap + 1);
    const justBelow =
      `---\ntype: gotcha\n---\n` + "b".repeat(BASE_THRESHOLDS.noteSizeCap);

    const tellsAbove = checkNoteGenreTells(justAbove);
    const tellsBelow = checkNoteGenreTells(justBelow);

    expect(tellsAbove).not.toBeNull();
    expect(tellsAbove?.size).toBe(BASE_THRESHOLDS.noteSizeCap + 1);

    expect(tellsBelow).toBeNull();
  });

  it("evaluateGenreTells uses noteSizeCap default threshold for memory-genre notes (±1 body size)", async () => {
    const dir = await freshDir();
    await makeTestKb(dir);

    const fm = "---\ntype: gotcha\n---\n";
    const bodyAbove = "a".repeat(BASE_THRESHOLDS.noteSizeCap + 1);
    const bodyExact = "b".repeat(BASE_THRESHOLDS.noteSizeCap);

    await writeFile(
      join(dir, "mage", "notes", "note-above.md"),
      fm + bodyAbove,
    );
    await writeFile(
      join(dir, "mage", "notes", "note-exact.md"),
      fm + bodyExact,
    );

    const kb = (await resolveDocsRoot(dir))!;
    const report = await evaluateGenreTells(kb);

    expect(report.scannedCount).toBe(2);
    expect(report.flagged.length).toBe(1);
    expect(report.flagged[0]?.relPath).toBe("mage/notes/note-above.md");
    expect(report.flagged[0]?.tells.size).toBe(BASE_THRESHOLDS.noteSizeCap + 1);
  });

  it("checkbox regex matches valid bullet checkboxes (* [ ], + [ ], - [ ]) and rejects cross-newline -\\n[ ]", () => {
    const dashCheck = checkNoteGenreTells("- [ ] dash task\n");
    expect(dashCheck?.checkboxes).toBe(1);

    const starCheck = checkNoteGenreTells("* [ ] star task\n");
    expect(starCheck?.checkboxes).toBe(1);

    const plusCheck = checkNoteGenreTells("+ [x] plus task\n");
    expect(plusCheck?.checkboxes).toBe(1);

    const newlineCheck = checkNoteGenreTells("-\n[ ] newline task\n");
    expect(newlineCheck).toBeNull();
  });

  it("formatGenreTellsSummary formats singular and plural flagged counts", () => {
    expect(formatGenreTellsSummary(0, 10)).toBe(
      "0 notes flagged of 10 scanned",
    );
    expect(formatGenreTellsSummary(1, 10)).toBe("1 note flagged of 10 scanned");
    expect(formatGenreTellsSummary(5, 10)).toBe(
      "5 notes flagged of 10 scanned",
    );
  });

  it("renderGenreTells caps flagged-note output at 10 items", () => {
    const flagged = Array.from({ length: 15 }, (_, i) => ({
      relPath: `mage/notes/note-${i}.md`,
      tells: { checkboxes: 1 },
    }));

    const logs: string[] = [];
    const origDetail = logger.detail;
    logger.detail = (msg: string) => {
      logs.push(msg);
    };

    try {
      renderGenreTells({ scannedCount: 20, flagged });
      expect(logs).toContain("…and 5 more");
      expect(logs).toContain("15 notes flagged of 20 scanned");
      expect(logs.filter((l) => l.startsWith("mage/notes/note-")).length).toBe(
        10,
      );
    } finally {
      logger.detail = origDetail;
    }
  });

  it("doctor's exit code (passed flag) is unchanged when genre-tell flags fire (read-only, fail-open)", async () => {
    const dir = await freshDir();
    await makeTestKb(dir);

    // Create a note that fires size & checkbox tells
    const fatText =
      `---\ntype: gotcha\n---\n# Oversized Note\n- [ ] item\n` +
      "z".repeat(BASE_THRESHOLDS.noteSizeCap + 1000);
    await writeFile(join(dir, "mage", "notes", "oversized.md"), fatText);

    const result = await doctor({ cwd: dir });
    expect(result.passed).toBe(true); // read-only annotation, NEVER a failure

    const check = result.checks.find((c) => c.name === "genre tells");
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.optional).toBe(true);
    expect(check?.detail).toBe("1 note flagged of 1 scanned");
  });

  it("evaluateGenreTells respects metadata.json genres overrides", async () => {
    const dir = await freshDir();
    await makeTestKb(dir);

    // Add metadata genre override: "runbook": "memory"
    const metaPath = join(dir, "mage", "metadata.json");
    const meta = JSON.parse(
      await (await import("node:fs/promises")).readFile(metaPath, "utf8"),
    );
    meta.genres = { runbook: "memory" };
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    const fatText =
      `---\ntype: runbook\n---\n# Oversized Runbook\n` +
      "z".repeat(BASE_THRESHOLDS.noteSizeCap + 1000);
    await writeFile(
      join(dir, "mage", "notes", "oversized-runbook.md"),
      fatText,
    );

    const kb = (await resolveDocsRoot(dir))!;
    const report = await evaluateGenreTells(kb);

    expect(report.scannedCount).toBe(1);
    expect(report.flagged.length).toBe(1);
    expect(report.flagged[0]?.relPath).toBe("mage/notes/oversized-runbook.md");
    expect(report.flagged[0]?.tells.size).toBeDefined();
  });
});
