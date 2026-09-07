import { describe, expect, it } from "vitest";
import { parseNote } from "../note.js";
import { checkAdmission, RUNGS } from "./admission.js";

describe("checkAdmission", () => {
  it("exports RUNGS in order from lowest to note", () => {
    expect(RUNGS).toEqual(["impossible", "check", "hook", "rule", "note"]);
  });

  it("passes a valid note with all admission fields", () => {
    const raw = `---
id: repo/note/soak-monitor-blind-spots
rung: note
skipped:
  impossible: "needs runtime context"
  check: "behavioral, not static"
  hook: "cannot observe cross-session"
  rule: "agent ignored instruction"
trigger: "when soak monitor misses an incident"
pointer: "[issue #231](https://github.com/Sumit1993/mage-memory/issues/231)"
---
# Soak monitor blind spots

Body text.
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    expect(problems).toEqual([]);
  });

  it("fails when id is missing entirely", () => {
    const raw = `---
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    expect(problems.length).toBeGreaterThan(0);
    const p = problems.find((x) => x.field === "id");
    expect(p).toBeDefined();
    expect(p?.line).toBeNull();
  });

  it("fails when id does not match the required regex pattern", () => {
    const raw = `---
id: INVALID_ID_FORMAT
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "id");
    expect(p).toBeDefined();
    expect(p?.line).toBe(2);
    expect(p?.message).toMatch(/pattern|format/i);
  });

  it("fails when id middle segment mismatches the rung", () => {
    const raw = `---
id: repo/rule/soak-monitor-blind-spots
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "id" && x.message.includes("rule") && x.message.includes("note"));
    expect(p).toBeDefined();
    expect(p?.line).toBe(2);
  });

  it("fails when rung is missing entirely", () => {
    const raw = `---
id: repo/note/my-slug
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "rung");
    expect(p).toBeDefined();
    expect(p?.line).toBeNull();
  });

  it("fails when rung is not in RUNGS", () => {
    const raw = `---
id: repo/note/my-slug
rung: invalid-rung
skipped:
  impossible: "reason"
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "rung");
    expect(p).toBeDefined();
    expect(p?.line).toBe(3);
  });

  it("fails when skipped is missing entirely", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "skipped");
    expect(p).toBeDefined();
    expect(p?.line).toBeNull();
  });

  it("fails when skipped lacks reasons for required rungs", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
skipped:
  impossible: "reason"
  check: "reason"
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "skipped");
    expect(p).toBeDefined();
    expect(p?.message).toMatch(/hook|rule/);
    expect(p?.line).toBe(4);
  });

  it("fails when a skipped entry is empty", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: ""
trigger: "trigger text"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "skipped" && x.message.includes("rule"));
    expect(p).toBeDefined();
    expect(p?.line).toBe(4);
  });

  it("passes rung: impossible with empty skipped mapping", () => {
    const raw = `---
id: repo/impossible/my-guard
rung: impossible
skipped: {}
trigger: "when types change"
pointer: "[type](src/types.ts#L10)"
---
# Impossible guard
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    expect(problems).toEqual([]);
  });

  it("fails when trigger is missing entirely", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "trigger");
    expect(p).toBeDefined();
    expect(p?.line).toBeNull();
  });

  it("fails when trigger is empty", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "   "
pointer: "[doc](https://example.com)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "trigger");
    expect(p).toBeDefined();
    expect(p?.line).toBe(9);
  });

  it("fails when pointer is missing entirely", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "trigger text"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "pointer");
    expect(p).toBeDefined();
    expect(p?.line).toBeNull();
  });

  it("fails when pointer contains no markdown link", () => {
    const raw = `---
id: repo/note/my-slug
rung: note
skipped:
  impossible: "reason"
  check: "reason"
  hook: "reason"
  rule: "reason"
trigger: "trigger text"
pointer: "https://example.com without markdown link syntax"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "pointer");
    expect(p).toBeDefined();
    expect(p?.line).toBe(10);
    expect(p?.message).toMatch(/markdown link/i);
  });

  it("recovers fields nested under metadata as written by Claude Code harness", () => {
    const raw = `---
name: "soak-monitor-blind-spots"
description: "a description"
metadata:
  node_type: memory
  id: repo/note/soak-monitor-blind-spots
  rung: note
  skipped:
    impossible: "needs runtime context"
    check: "behavioral, not static"
    hook: "cannot observe cross-session"
    rule: "agent ignored instruction"
  trigger: "when soak monitor misses an incident"
  pointer: "[issue #231](https://github.com/Sumit1993/mage-memory/issues/231)"
---
# Soak monitor blind spots

Recovered from metadata.
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    expect(problems).toEqual([]);
  });

  it("reports line number inside metadata block for invalid field", () => {
    const raw = `---
name: "test"
metadata:
  node_type: memory
  id: repo/rule/mismatch-slug
  rung: note
  skipped:
    impossible: "r"
    check: "r"
    hook: "r"
    rule: "r"
  trigger: "valid trigger"
  pointer: "[link](url)"
---
# Test
`;
    const { frontmatter } = parseNote(raw);
    const problems = checkAdmission(frontmatter, raw);
    const p = problems.find((x) => x.field === "id");
    expect(p).toBeDefined();
    expect(p?.line).toBe(5);
  });
});
