import { describe, expect, it } from "vitest";
import { parseNote } from "../note.js";
import { checkAdmission, RUNGS } from "./admission.js";

function check(raw: string) {
  return checkAdmission(parseNote(raw).frontmatter, raw);
}

describe("checkAdmission", () => {
  it("exports RUNGS in order from lowest to note", () => {
    expect(RUNGS).toEqual(["impossible", "check", "hook", "rule", "note"]);
  });

  it("passes a note with only rung, trigger and pointer", () => {
    const raw = `---
rung: note
trigger: "when soak monitor misses an incident"
pointer: "[issue #231](https://github.com/Sumit1993/mage-memory/issues/231)"
---
# Soak monitor blind spots
`;
    expect(check(raw)).toEqual([]);
  });

  it("passes the mapping trigger form", () => {
    const raw = `---
rung: note
trigger:
  when: "deciding which mage binary a verify command runs"
  match: ["Bash(npx mage *)", "Edit(package.json)"]
pointer: "[doc](https://example.com)"
---
# Test
`;
    expect(check(raw)).toEqual([]);
  });

  it("passes a note that also carries a valid id and skipped", () => {
    const raw = `---
id: repo/note/soak-monitor-blind-spots
rung: note
skipped:
  impossible: "needs runtime context"
  check: "behavioral, not static"
trigger: "when soak monitor misses an incident"
pointer: "[doc](https://example.com)"
---
# Test
`;
    expect(check(raw)).toEqual([]);
  });

  it("reports rung, trigger and pointer as required", () => {
    const problems = check(`---
type: gotcha
---
# Test
`);
    expect(problems.map((p) => [p.field, p.message, p.line])).toEqual([
      ["rung", "rung is required", null],
      ["trigger", "trigger is required", null],
      ["pointer", "pointer is required", null],
    ]);
  });

  it("does not require id or skipped", () => {
    const raw = `---
rung: impossible
trigger: "when types change"
pointer: "[type](src/types.ts#L10)"
---
# Test
`;
    expect(check(raw)).toEqual([]);
  });

  it("fails when rung is not in RUNGS", () => {
    const raw = `---
rung: invalid-rung
trigger: "t"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const p = check(raw).find((x) => x.field === "rung");
    expect(p?.line).toBe(2);
  });

  it("fails when id is present and does not match the pattern", () => {
    const raw = `---
id: INVALID_ID_FORMAT
rung: note
trigger: "t"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const p = check(raw).find((x) => x.field === "id");
    expect(p?.line).toBe(2);
    expect(p?.message).toMatch(/pattern/i);
  });

  it("fails when id middle segment mismatches the rung", () => {
    const raw = `---
id: repo/rule/soak-monitor-blind-spots
rung: note
trigger: "t"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const p = check(raw).find((x) => x.field === "id");
    expect(p?.message).toContain('"rule"');
    expect(p?.line).toBe(2);
  });

  it("fails when skipped is present but not a mapping", () => {
    const raw = `---
rung: note
skipped: nope
trigger: "t"
pointer: "[doc](https://example.com)"
---
# Test
`;
    expect(check(raw).find((x) => x.field === "skipped")?.message).toMatch(/mapping/);
  });

  it("fails when a present skipped entry is empty", () => {
    const raw = `---
rung: note
skipped:
  impossible: "reason"
  rule: ""
trigger: "t"
pointer: "[doc](https://example.com)"
---
# Test
`;
    const p = check(raw).find((x) => x.field === "skipped");
    expect(p?.message).toContain("rule");
    expect(p?.line).toBe(3);
  });

  it("fails when trigger is empty or a mapping without when", () => {
    for (const trigger of ['"   "', "{match: [\"Bash(x *)\"]}", "{when: \"\"}"]) {
      const raw = `---
rung: note
trigger: ${trigger}
pointer: "[doc](https://example.com)"
---
# Test
`;
      const p = check(raw).find((x) => x.field === "trigger");
      expect(p?.line).toBe(3);
    }
  });

  it("does not judge an invalid match entry; index reports that", () => {
    const raw = `---
rung: note
trigger:
  when: "w"
  match: ["Read(x)"]
pointer: "[doc](https://example.com)"
---
# Test
`;
    expect(check(raw)).toEqual([]);
  });

  it("fails when pointer is missing or holds no markdown link", () => {
    const missing = check(`---
rung: note
trigger: "t"
---
# Test
`);
    expect(missing.find((x) => x.field === "pointer")?.line).toBeNull();

    const bare = check(`---
rung: note
trigger: "t"
pointer: "https://example.com without markdown link syntax"
---
# Test
`);
    const p = bare.find((x) => x.field === "pointer");
    expect(p?.line).toBe(4);
    expect(p?.message).toMatch(/markdown link/i);
  });

  it("recovers fields nested under metadata as written by Claude Code", () => {
    const raw = `---
name: "soak-monitor-blind-spots"
description: "a description"
metadata:
  node_type: memory
  rung: note
  trigger: "when soak monitor misses an incident"
  pointer: "[issue #231](https://github.com/Sumit1993/mage-memory/issues/231)"
---
# Soak monitor blind spots
`;
    expect(check(raw)).toEqual([]);
  });

  it("reports the line number inside a metadata block", () => {
    const raw = `---
name: "test"
metadata:
  node_type: memory
  id: repo/rule/mismatch-slug
  rung: note
  trigger: "valid trigger"
  pointer: "[link](url)"
---
# Test
`;
    expect(check(raw).find((x) => x.field === "id")?.line).toBe(5);
  });
});
