import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { hubProjectDocsRoot } from "../paths.js";
import { withKb } from "../../test/fixtures/kb.js";
import { reportHubFanout } from "./fanout-hint.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A hub root on disk registering `names` as hub-owned projects. */
async function hub(names: string[]): Promise<string> {
  const { dir } = await withKb({
    kind: "hub",
    prefix: "mage-fanout-",
    projects: names.map((name) => ({
      name,
      storage: "hub-owned",
      code_repo_path: "",
      code_repo_url: "",
    })),
  });
  return dir;
}

describe("reportHubFanout", () => {
  it("nudges at a hub root that owns registered projects, counting them", async () => {
    const dir = await hub(["engine", "platform"]);
    const step = vi.spyOn(logger, "step");
    await reportHubFanout({ root: dir, kind: "hub", repo: dir }, "distill");
    expect(step).toHaveBeenCalledTimes(1);
    const msg = String(step.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/2 registered project/);
    expect(msg).toContain("mage distill --dir");
  });

  it("names the engine in the hint", async () => {
    const dir = await hub(["engine"]);
    const step = vi.spyOn(logger, "step");
    await reportHubFanout({ root: dir, kind: "hub", repo: dir }, "promote");
    expect(String(step.mock.calls[0]?.[0] ?? "")).toContain("mage promote --dir");
  });

  it("is silent at a hub root with no registered projects", async () => {
    const dir = await hub([]);
    const step = vi.spyOn(logger, "step");
    await reportHubFanout({ root: dir, kind: "hub", repo: dir }, "distill");
    expect(step).not.toHaveBeenCalled();
  });

  it("is silent for a hub-owned project (root ≠ repo) — it is its own single scope", async () => {
    const dir = await hub(["engine"]);
    const proj = hubProjectDocsRoot(dir, "engine");
    const step = vi.spyOn(logger, "step");
    await reportHubFanout({ root: proj, kind: "hub", repo: dir }, "distill");
    expect(step).not.toHaveBeenCalled();
  });

  it("is silent for a repo KB", async () => {
    const dir = await hub([]);
    const step = vi.spyOn(logger, "step");
    await reportHubFanout({ root: join(dir, "mage"), kind: "repo", repo: dir }, "distill");
    expect(step).not.toHaveBeenCalled();
  });
});
