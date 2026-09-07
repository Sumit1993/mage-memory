import { describe, expect, it } from "vitest";
import { checkReadability } from "./readability.js";

describe("checkReadability", () => {
  it("passes a clean, concise, self-contained note with plain words", () => {
    const raw = `---
id: repo/note/short-clean
rung: note
---
# Short clean note

This is a concise note.
Every step is clear and directly stated.
`;
    const problems = checkReadability(raw);
    expect(problems).toEqual([]);
  });

  it("fails length rule when body exceeds 40 lines", () => {
    const lines = Array.from({ length: 45 }, (_, i) => `Line ${i + 1} with text.`);
    const raw = `---
id: repo/note/long-lines
rung: note
---
# Long lines note

${lines.join("\n")}
`;
    const problems = checkReadability(raw);
    const p = problems.find((x) => x.rule === "length");
    expect(p).toBeDefined();
    expect(p?.message).toMatch(/lines/i);
  });

  it("fails length rule when body exceeds 350 words", () => {
    // 360 words
    const words = Array.from({ length: 360 }, (_, i) => `token${i}`).join(" ");
    const raw = `---
id: repo/note/many-words
rung: note
---
# Many words note

${words}
`;
    const problems = checkReadability(raw);
    const p = problems.find((x) => x.rule === "length");
    expect(p).toBeDefined();
    expect(p?.message).toMatch(/words/i);
  });

  it("fails self-contained rule when naming outside document without a markdown link", () => {
    const raw = `---
id: repo/note/unlinked-doc
rung: note
---
# Unlinked doc note

Please review section 12.3 for background details.
`;
    const problems = checkReadability(raw);
    const p = problems.find((x) => x.rule === "self-contained");
    expect(p).toBeDefined();
    expect(p?.message).toMatch(/section 12\.3/i);
    expect(p?.line).toBe(7);
  });

  it("fails self-contained rule for other unlinked shapes: the plan page, tonight's ruling, WP-42, the inventory, the redirection page", () => {
    const raw = `---
id: repo/note/shapes
rung: note
---
# Shapes note

Consult the plan page before editing.
According to tonight's ruling we must stop.
Ticket WP-123 is closed.
Check the inventory for items.
Visit the redirection page soon.
`;
    const problems = checkReadability(raw);
    const selfContained = problems.filter((x) => x.rule === "self-contained");
    expect(selfContained.length).toBe(5);
  });

  it("passes when outside document reference is inside a markdown link", () => {
    const raw = `---
id: repo/note/linked-doc
rung: note
---
# Linked doc note

Please review [section 12.3](https://example.com/sec12) for background.
Also see [the plan page](plan.md) and [tonight's ruling](ruling.md).
Tracked in [WP-42](https://jira.example.com/WP-42).
See [the inventory](inventory.md) and [the redirection page](redirect.md).
`;
    const problems = checkReadability(raw);
    const selfContained = problems.filter((x) => x.rule === "self-contained");
    expect(selfContained).toEqual([]);
  });

  it("fails plain-words rule when unslop jargon word appears in prose", () => {
    const raw = `---
id: repo/note/jargon
rung: note
---
# Jargon note

We must leverage this tool to delve into issues.
`;
    const problems = checkReadability(raw);
    const plainWords = problems.filter((x) => x.rule === "plain-words");
    expect(plainWords.length).toBe(2);
    expect(plainWords[0]?.line).toBe(7);
  });

  it("fails plain-words rule on em dash in prose", () => {
    const raw = `---
id: repo/note/em-dash
rung: note
---
# Em dash note

Here is a thought — with an em dash.
`;
    const problems = checkReadability(raw);
    const plainWords = problems.filter((x) => x.rule === "plain-words");
    expect(plainWords.length).toBe(1);
    expect(plainWords[0]?.message).toMatch(/em dash/i);
    expect(plainWords[0]?.line).toBe(7);
  });

  it("skips fenced code blocks and inline code spans for jargon words", () => {
    const raw = `---
id: repo/note/code-spans
rung: note
---
# Code spans note

Use \`leverage\` as the option name.
Run the following code:

\`\`\`ts
const harness = "test";
const surface = 42;
function delve() {
  return "substrate";
}
\`\`\`

The option is verified.
`;
    const problems = checkReadability(raw);
    const plainWords = problems.filter((x) => x.rule === "plain-words");
    expect(plainWords).toEqual([]);
  });
});
