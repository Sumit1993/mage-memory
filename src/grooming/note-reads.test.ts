import { describe, expect, it } from "vitest";
import { buildSkillLoad, buildToolUse, buildUserPrompt, type EventBase } from "../observe/events.js";
import type { ObserveEvent } from "../observe/types.js";
import { chapterIsSelfReferential, chapterNoteReads, isMageSkill, noteRelPathOf } from "./note-reads.js";

const ROOT = "/repo";
const DOCS = "/repo/mage";

let clock = 0;
function base(): EventBase {
  clock += 1;
  return { ts: new Date(Date.UTC(2026, 6, 19, 0, 0, clock)).toISOString(), session: "s1" };
}
function read(...paths: string[]): ObserveEvent {
  return buildToolUse(base(), { tool: "Read", paths, detail: null, ok: true, error_summary: null });
}
function skill(name: string): ObserveEvent {
  return buildSkillLoad(base(), { skill: name, args: null, match: null, trigger_hash: null });
}
/** The whole array as one chapter. */
function whole(events: ObserveEvent[]): { start: number; end: number } {
  return { start: 0, end: events.length };
}

describe("isMageSkill", () => {
  it("recognises mage's own skills in the forms a harness may record", () => {
    for (const s of ["mage:groom", "mage:learn", "MAGE:GRADUATE", "mage-wing-mage", "mage"]) {
      expect(isMageSkill(s)).toBe(true);
    }
  });

  it("does not claim a foreign skill that merely mentions mage", () => {
    for (const s of ["pr-watch", "image-tools", "damage-report", "my-mage-helper"]) {
      expect(isMageSkill(s)).toBe(false);
    }
  });
});

describe("noteRelPathOf", () => {
  it("maps an absolute path under the docs root to its relPath", () => {
    expect(noteRelPathOf("/repo/mage/notes/a.md", DOCS, ROOT)).toBe("notes/a.md");
  });

  it("resolves a cwd-relative path against the repo root", () => {
    expect(noteRelPathOf("mage/notes/a.md", DOCS, ROOT)).toBe("notes/a.md");
  });

  it("rejects a path outside the docs root", () => {
    expect(noteRelPathOf("/repo/src/index.md", DOCS, ROOT)).toBeNull();
    expect(noteRelPathOf("/elsewhere/mage/notes/a.md", DOCS, ROOT)).toBeNull();
  });

  it("rejects a docs-root sibling whose name merely shares the prefix", () => {
    // "/repo/mage-other/..." must not match "/repo/mage" — the boundary is a "/".
    expect(noteRelPathOf("/repo/mage-other/notes/a.md", DOCS, ROOT)).toBeNull();
  });

  it("rejects non-markdown", () => {
    expect(noteRelPathOf("/repo/mage/notes/a.txt", DOCS, ROOT)).toBeNull();
  });

  it("rejects GENERATED artifacts — reading the index is navigation, not consulting a note", () => {
    expect(noteRelPathOf("/repo/mage/INDEX.md", DOCS, ROOT)).toBeNull();
    expect(noteRelPathOf("/repo/mage/MEMORY.md", DOCS, ROOT)).toBeNull();
    expect(noteRelPathOf("/repo/mage/_index.mage.md", DOCS, ROOT)).toBeNull();
  });

  it("rejects a `..` escape that survived the prefix match", () => {
    expect(noteRelPathOf("/repo/mage/../secrets.md", DOCS, ROOT)).toBeNull();
  });

  it("returns null for a relative path when there is no repo root to resolve against", () => {
    expect(noteRelPathOf("mage/notes/a.md", DOCS, null)).toBeNull();
  });
});

describe("chapterIsSelfReferential", () => {
  it("is true when the chapter loaded a mage skill", () => {
    const events = [read("/repo/mage/notes/a.md"), skill("mage:groom")];
    expect(chapterIsSelfReferential(events, whole(events))).toBe(true);
  });

  it("is false for a chapter loading only foreign skills", () => {
    const events = [skill("pr-watch"), read("/repo/mage/notes/a.md")];
    expect(chapterIsSelfReferential(events, whole(events))).toBe(false);
  });

  it("only inspects the given segment, not the whole array", () => {
    const events = [skill("mage:groom"), read("/repo/mage/notes/a.md")];
    expect(chapterIsSelfReferential(events, { start: 1, end: 2 })).toBe(false);
  });
});

describe("chapterNoteReads", () => {
  it("collects the distinct notes read in the chapter", () => {
    const events = [
      read("/repo/mage/notes/b.md"),
      read("/repo/mage/notes/a.md"),
      buildUserPrompt(base(), "why?"),
    ];
    expect(chapterNoteReads(events, whole(events), DOCS, ROOT)).toEqual(["notes/a.md", "notes/b.md"]);
  });

  it("DEDUPES within the chapter — six reads of one note is one chapter of usage", () => {
    const events = [
      read("/repo/mage/notes/a.md"),
      read("/repo/mage/notes/a.md"),
      read("/repo/mage/notes/a.md"),
    ];
    expect(chapterNoteReads(events, whole(events), DOCS, ROOT)).toEqual(["notes/a.md"]);
  });

  it("counts every note path on a multi-path tool_use", () => {
    const events = [read("/repo/mage/notes/a.md", "/repo/src/x.ts", "/repo/mage/notes/b.md")];
    expect(chapterNoteReads(events, whole(events), DOCS, ROOT)).toEqual(["notes/a.md", "notes/b.md"]);
  });

  it("counts a FAILED read — going looking for the note is the signal", () => {
    const events = [
      buildToolUse(base(), {
        tool: "Read",
        paths: ["/repo/mage/notes/a.md"],
        detail: null,
        ok: false,
        error_summary: "permission denied",
      }),
    ];
    expect(chapterNoteReads(events, whole(events), DOCS, ROOT)).toEqual(["notes/a.md"]);
  });

  it("yields NOTHING for a self-referential chapter (the loop must not feed itself)", () => {
    const events = [skill("mage:groom"), read("/repo/mage/notes/a.md"), read("/repo/mage/notes/b.md")];
    expect(chapterNoteReads(events, whole(events), DOCS, ROOT)).toEqual([]);
  });

  it("excludes the WHOLE chapter, including reads BEFORE the mage skill loaded", () => {
    // There is no skill_unload to bound the context, so the chapter is the unit —
    // a read preceding the load is discarded too. Deliberately coarse (ADR-0038 §2).
    const events = [read("/repo/mage/notes/a.md"), skill("mage:learn")];
    expect(chapterNoteReads(events, whole(events), DOCS, ROOT)).toEqual([]);
  });

  it("still counts a neighbouring chapter that loaded no mage skill", () => {
    const events = [
      skill("mage:groom"),
      read("/repo/mage/notes/a.md"), // chapter 1 — excluded
      read("/repo/mage/notes/b.md"), // chapter 2 — clean
    ];
    expect(chapterNoteReads(events, { start: 0, end: 2 }, DOCS, ROOT)).toEqual([]);
    expect(chapterNoteReads(events, { start: 2, end: 3 }, DOCS, ROOT)).toEqual(["notes/b.md"]);
  });
});
