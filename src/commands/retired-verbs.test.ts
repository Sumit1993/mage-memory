import { describe, expect, it } from "vitest";
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
  } catch (err: any) {
    return { stdout: lines.join("\n"), exitCode: err.exitCode ?? 1 };
  } finally {
    console.log = origLog;
  }
}

describe("retired verbs signposts (graduate, ingest)", () => {
  it("mage graduate prints that graduate has retired and exits 0", async () => {
    const res = await runCli(["graduate"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(RETIRED_VERB_MESSAGES.graduate);
  });

  it("mage ingest prints that ingest has retired and exits 0", async () => {
    const res = await runCli(["ingest", "."]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(RETIRED_VERB_MESSAGES.ingest);
  });
});

describe("retired verbs signposts respect --quiet (skills, footprint)", () => {
  it("mage skills --metrics --quiet produces empty stdout and exits 0", async () => {
    const res = await runCli(["skills", "--metrics", "--quiet"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("mage skills prints that skills has retired and exits 0", async () => {
    const res = await runCli(["skills"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(RETIRED_VERB_MESSAGES.skills);
  });

  it("mage footprint --quiet produces empty stdout and exits 0", async () => {
    const res = await runCli(["footprint", "--quiet"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("mage footprint prints that footprint has retired and exits 0", async () => {
    const res = await runCli(["footprint"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(RETIRED_VERB_MESSAGES.footprint);
  });
});

