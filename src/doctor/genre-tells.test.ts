import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_THRESHOLDS } from "../grooming/thresholds.js";
import { gitInit } from "../git.js";
import { METADATA_SCHEMA, resolveDocsRoot } from "../paths.js";
import { tmpDir } from "../../test/fixtures/kb.js";
import { doctor } from "../commands/doctor.js";
import {
  checkNoteGenreTells,
  evaluateGenreTells,
  formatFlaggedNoteLine,
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
  await writeFile(join(dir, "mage", "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
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

  it("flags a fat PM-shaped note and leaves a small clean gotcha note unflagged", async () => {
    const dir = await freshDir();
    await makeTestKb(dir);

    // (a) Fat PM-shaped note (size > 6000, done-state vocab >= 5, issue refs >= 10, checkbox)
    const doneVocabText = "shipped deferred build order critical path PR #101 PR #102\n";
    const issueRefsText = "#1 #2 #3 #4 #5 #6 #7 #8 #9 #10\n";
    const checkboxText = "- [ ] todo task\n";
    const padding = "x".repeat(6000);
    const fatNoteText = `---\ntype: plan\n---\n# Fat PM Note\n${doneVocabText}${issueRefsText}${checkboxText}${padding}`;

    await writeFile(join(dir, "mage", "notes", "fat-pm-note.md"), fatNoteText);

    // (b) Small clean gotcha note
    const smallGotchaText = `---\ntype: gotcha\n---\n# Small Gotcha Note\nJust a quick tip.\n`;
    await writeFile(join(dir, "mage", "notes", "clean-gotcha.md"), smallGotchaText);

    const kb = (await resolveDocsRoot(dir))!;
    const report = await evaluateGenreTells(kb);

    expect(report.scannedCount).toBe(2);
    expect(report.flagged.length).toBe(1);

    const flagged = report.flagged[0]!;
    expect(flagged.relPath).toBe("mage/notes/fat-pm-note.md");
    expect(flagged.tells.size).toBeDefined();
    expect(flagged.tells.size).toBeGreaterThan(BASE_THRESHOLDS.noteSizeCap);
    expect(flagged.tells.doneVocab).toBeGreaterThanOrEqual(5);
    expect(flagged.tells.issueRefs).toBeGreaterThanOrEqual(10);
    expect(flagged.tells.checkboxes).toBeGreaterThanOrEqual(1);

    const formatted = formatFlaggedNoteLine(flagged);
    expect(formatted).toContain("mage/notes/fat-pm-note.md:");
    expect(formatted).toContain("size (");
    expect(formatted).toContain("done-state vocab (");
    expect(formatted).toContain("issue-ref density (");
    expect(formatted).toContain("checkboxes (");
  });

  it("threshold-reachability regression test: sizes just above and below noteSizeCap", () => {
    // This test exercises the default parameter path (omitting noteSizeCap argument)
    // to guarantee noteSizeCap from thresholds.ts remains the live threshold.
    const justAbove = "a".repeat(BASE_THRESHOLDS.noteSizeCap + 1);
    const justBelow = "b".repeat(BASE_THRESHOLDS.noteSizeCap);

    const tellsAbove = checkNoteGenreTells(justAbove);
    const tellsBelow = checkNoteGenreTells(justBelow);

    expect(tellsAbove).not.toBeNull();
    expect(tellsAbove?.size).toBe(BASE_THRESHOLDS.noteSizeCap + 1);

    expect(tellsBelow).toBeNull();
  });

  it("doctor's exit code (passed flag) is unchanged when genre-tell flags fire (read-only, fail-open)", async () => {
    const dir = await freshDir();
    await makeTestKb(dir);

    // Create a note that fires size & checkbox tells
    const fatText = `# Oversized Note\n- [ ] item\n` + "z".repeat(7000);
    await writeFile(join(dir, "mage", "notes", "oversized.md"), fatText);

    const result = await doctor({ cwd: dir });
    expect(result.passed).toBe(true); // read-only annotation, NEVER a failure

    const check = result.checks.find((c) => c.name === "genre tells");
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.optional).toBe(true);
    expect(check?.detail).toMatch(/1 note\(s\) flagged of 1 scanned/);
  });
});
