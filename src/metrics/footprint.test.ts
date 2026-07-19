import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatTokensEst,
  measureFootprint,
} from "./footprint.js";
import { tmpDir } from "../../test/fixtures/kb.js";
import { writeTally, PROMOTE_VERSION } from "../grooming/tally.js";
import type { PromoteTally } from "../grooming/types.js";

describe("formatTokensEst", () => {
  it("renders coarsely and does not contain a precise integer", () => {
    // 4823 bytes / 4 = 1205 tokens. Coarse should be ~1.2K est.
    const res = formatTokensEst(4823);
    expect(res).toBe("~1.2K est.");
    expect(res).not.toMatch(/\d,\d/); // No precise integer formatting
    expect(res).not.toMatch(/1205/);
    
    // Test a smaller one
    const res2 = formatTokensEst(1316);
    expect(res2).toBe("~0.3K est.");
  });
});

describe("measureFootprint", () => {
  it("defaults to AUTO_MEMORY_MAX_BYTES when capBytes is omitted", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });
    
    const footprint = await measureFootprint(docsRoot);
    expect(footprint.budget.capBytes).toBe(25600);
  });

  it("explicit capBytes overrides the default", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });
    
    const footprint = await measureFootprint(docsRoot, { capBytes: 10000 });
    expect(footprint.budget.capBytes).toBe(10000);
  });
  it("budget usedBytes counts ONLY the capped surface", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });

    // Capped surface: MEMORY.md
    const memoryBody = "a".repeat(1000);
    await writeFile(join(docsRoot, "MEMORY.md"), memoryBody);
    
    // Uncapped surface: AGENTS.md (at repoRoot)
    const agentsBody = "b".repeat(100000);
    await writeFile(join(dir, "AGENTS.md"), agentsBody);

    const footprint = await measureFootprint(docsRoot, { capBytes: 25600 });
    
    expect(footprint.budget.usedBytes).toBe(1000); // Only MEMORY.md counts
    expect(footprint.budget.capBytes).toBe(25600);
    expect(footprint.budget.ratio).toBe(1000 / 25600);
    expect(footprint.budget.state).toBe("ok");
    
    // Ensure both were measured
    const memorySurface = footprint.surfaces.find(s => s.label === "MEMORY.md");
    expect(memorySurface?.bytes).toBe(1000);
    const agentsSurface = footprint.surfaces.find(s => s.label === "AGENTS.md");
    expect(agentsSurface?.bytes).toBe(100000);
  });

  it("state transitions at exactly ok / warn (>=70%) / breach (>=90%) boundaries", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });

    const capBytes = 10000;
    
    // Exactly 69.99%
    await writeFile(join(docsRoot, "MEMORY.md"), "a".repeat(6999));
    let footprint = await measureFootprint(docsRoot, { capBytes });
    expect(footprint.budget.state).toBe("ok");

    // Exactly 70%
    await writeFile(join(docsRoot, "MEMORY.md"), "a".repeat(7000));
    footprint = await measureFootprint(docsRoot, { capBytes });
    expect(footprint.budget.state).toBe("warn");

    // Exactly 89.99%
    await writeFile(join(docsRoot, "MEMORY.md"), "a".repeat(8999));
    footprint = await measureFootprint(docsRoot, { capBytes });
    expect(footprint.budget.state).toBe("warn");

    // Exactly 90%
    await writeFile(join(docsRoot, "MEMORY.md"), "a".repeat(9000));
    footprint = await measureFootprint(docsRoot, { capBytes });
    expect(footprint.budget.state).toBe("breach");
  });

  it("missing files are skipped, not zero-reported", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });

    // Do NOT create MEMORY.md, INDEX.md, etc.
    const footprint = await measureFootprint(docsRoot, { capBytes: 10000 });
    
    expect(footprint.surfaces.length).toBe(0); // Should be empty
    expect(footprint.budget.usedBytes).toBe(0);
  });

  it("pointer classification correctly resolves files against both docsRoot and repoRoot", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    const notesRoot = join(docsRoot, "notes");
    await mkdir(notesRoot, { recursive: true });

    // Create target repo file (100 bytes)
    const targetFile = join(dir, "target.txt");
    await writeFile(targetFile, "a".repeat(100));

    // Create docs-root target file (100 bytes)
    const docsFile = join(docsRoot, "docs-target.txt");
    await writeFile(docsFile, "a".repeat(100));

    // Create note with pointers
    const noteContent = `---
sources:
  - target.txt
  - docs-target.txt
  - missing.txt
  - https://example.com/docs
  - cc-session:abcdef
---
Note body
`;
    await writeFile(join(notesRoot, "note1.md"), noteContent);

    const footprint = await measureFootprint(docsRoot, { capBytes: 10000 });
    
    expect(footprint.pointers.total).toBe(5);
    expect(footprint.pointers.measurable).toBe(2);
    expect(footprint.pointers.dead).toBe(1);
    expect(footprint.pointers.unmeasurable).toBe(2);
    expect(footprint.pointers.measurableBytes).toBe(200);
  });

  it("_index.<wing>.md is on-follow, and duplicate skills yield one description-only row", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });

    // Create an index file for a wing
    await writeFile(join(docsRoot, "_index.foo.md"), "wing index");

    // Create both claude and agents skills
    const ccSkillDir = join(dir, ".claude", "skills", "mage-wing-foo");
    await mkdir(ccSkillDir, { recursive: true });
    await writeFile(join(ccSkillDir, "SKILL.md"), "cc skill");

    const agSkillDir = join(dir, ".agents", "skills", "mage-wing-foo");
    await mkdir(agSkillDir, { recursive: true });
    await writeFile(join(agSkillDir, "SKILL.md"), "agents skill");

    const footprint = await measureFootprint(docsRoot);
    
    const indexSurface = footprint.surfaces.find(s => s.label === "_index.foo.md");
    expect(indexSurface).toBeDefined();
    expect(indexSurface?.loadMode).toBe("on-follow");
    
    const skillSurfaces = footprint.surfaces.filter(s => s.label === "SKILL.md (mage-wing-foo)");
    expect(skillSurfaces.length).toBe(1);
    expect(skillSurfaces[0]!.loadMode).toBe("description-only");
    expect(skillSurfaces[0]!.relPath).toContain(".claude"); // prefers CC when both exist
  });

  it("yield sufficientData is false when the tally is absent", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });
    
    const footprint = await measureFootprint(docsRoot);
    expect(footprint.yield.sufficientData).toBe(false);
  });

  it("yield sufficientData is false when sessions < 30", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(docsRoot, { recursive: true });
    
    const tally: PromoteTally = {
      v: PROMOTE_VERSION,
      notes: {},
      sessions: {},
    };
    // Add 29 sessions
    for (let i = 0; i < 29; i++) {
      tally.sessions[`sess-${i}`] = { offset: 0, sigs: [] };
    }
    await writeTally(docsRoot, tally);

    const footprint = await measureFootprint(docsRoot);
    expect(footprint.yield.sessions).toBe(29);
    expect(footprint.yield.sufficientData).toBe(false);
  });

  it("yield sufficientData is true when sessions >= 30, and notesNeverRead arithmetic is correct", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    const notesRoot = join(docsRoot, "notes");
    await mkdir(notesRoot, { recursive: true });
    
    // Create 3 notes
    await writeFile(join(notesRoot, "note1.md"), "n1");
    await writeFile(join(notesRoot, "note2.md"), "n2");
    await writeFile(join(notesRoot, "note3.md"), "n3");

    const tally: PromoteTally = {
      v: PROMOTE_VERSION,
      notes: {
        "notes/note1.md": { chapters: 2, lastSeen: "" },
        "notes/note2.md": { chapters: 0, lastSeen: "" }, // 0 chapters = not read
      },
      sessions: {},
    };
    // Add 30 sessions
    for (let i = 0; i < 30; i++) {
      tally.sessions[`sess-${i}`] = { offset: 0, sigs: [] };
    }
    await writeTally(docsRoot, tally);

    const footprint = await measureFootprint(docsRoot);
    expect(footprint.yield.sessions).toBe(30);
    expect(footprint.yield.sufficientData).toBe(true);
    expect(footprint.yield.notesTracked).toBe(3);
    expect(footprint.yield.notesRead).toBe(1); // note1 was read
    expect(footprint.yield.notesNeverRead).toBe(2); // 3 total - 1 read = 2
  });

  it("malformed promote.json (garbage bytes) does NOT throw and yields sufficientData: false", async () => {
    const dir = await tmpDir("mage-footprint-");
    const docsRoot = join(dir, "mage");
    await mkdir(join(docsRoot, ".mage", "metrics"), { recursive: true });
    await writeFile(join(docsRoot, ".mage", "metrics", "promote.json"), "garbage bytes");

    const footprint = await measureFootprint(docsRoot);
    expect(footprint.yield.sufficientData).toBe(false);
    expect(footprint.yield.sessions).toBe(0);
  });
});
