import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSettingsTarget } from "../../src/adapters/claude-code/settings.js";

describe("unit tests never reach the real home directory", () => {
  it("homedir() is a throwaway dir under the OS temp dir", () => {
    expect(homedir().startsWith(join(tmpdir(), "mage-test-home-"))).toBe(true);
  });

  it("the --user settings target resolves inside it", () => {
    expect(resolveSettingsTarget({ user: true }).path).toBe(join(homedir(), ".claude", "settings.json"));
  });
});
