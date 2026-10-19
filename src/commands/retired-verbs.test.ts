import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withKb } from "../../test/fixtures/kb.js";
import { buildProgram } from "../cli-program.js";
import { RETIRED_VERB_MESSAGES } from "./retired.js";

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const program = buildProgram();
  program.exitOverride();
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...msgs: unknown[]) => {
    lines.push(msgs.map((m) => String(m)).join(" "));
  };
  try {
    await program.parseAsync(args, { from: "user" });
    return { stdout: lines.join("\n"), exitCode: 0 };
  } catch (err) {
    const code = (err as { exitCode?: number }).exitCode;
    return { stdout: lines.join("\n"), exitCode: code ?? 1 };
  } finally {
    console.log = origLog;
  }
}

describe("retired verb messages", () => {
  it("retire exactly these seven verbs; skills generates again", () => {
    expect(Object.keys(RETIRED_VERB_MESSAGES).sort()).toEqual([
      "dashboard",
      "distill",
      "footprint",
      "graduate",
      "ingest",
      "promote",
      "stage",
    ]);
  });

  it("each points at the verb that replaces it", () => {
    const m = RETIRED_VERB_MESSAGES;
    for (const verb of ["distill", "promote", "graduate", "stage", "ingest"] as const) {
      expect(m[verb], verb).toMatch(/`mage groom`|`\/mage:learn/);
    }
    expect(m.dashboard).toContain("`mage index`");
    expect(m.footprint).toContain("`mage doctor`");
  });

  it("none names a verb or issue that no longer exists", () => {
    const banned = /mage (observe|ledger)|proposal digest|#219|#235|#237/;
    for (const [verb, text] of Object.entries(RETIRED_VERB_MESSAGES)) {
      expect(text, verb).not.toMatch(banned);
    }
  });
});

describe("retired verbs print their signpost and exit 0", () => {
  for (const verb of ["distill", "promote", "graduate", "stage", "ingest", "dashboard", "footprint"] as const) {
    it(`mage ${verb}`, async () => {
      const res = await runCli([verb]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe(RETIRED_VERB_MESSAGES[verb]);
    });
  }

  it("mage footprint --quiet produces empty stdout and exits 0", async () => {
    const res = await runCli(["footprint", "--quiet"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
  });
});

describe("mage skills generates wing skills again (#282)", () => {
  it("with no flags writes a wing skill into a fixture knowledge base", async () => {
    const { dir, root } = await withKb();
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(
      join(root, "notes", "n.md"),
      "---\ntype: gotcha\ntags: [billing/payments]\n---\n# Webhooks retry\n",
    );
    const res = await runCli(["skills", "-d", dir]);
    expect(res.exitCode).toBe(0);
    const skill = await readFile(join(dir, ".claude", "skills", "mage-wing-billing", "SKILL.md"), "utf8");
    expect(skill).toContain("billing");
  });
});
