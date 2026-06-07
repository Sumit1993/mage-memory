import { afterEach, describe, expect, it } from "vitest";
import { isInteractive, resolveDecision } from "./interactive.js";

// We mutate process.stdin.isTTY / process.stdout.isTTY to simulate TTY vs non-TTY
// runs (ADR-0017 section 4: non-TTY => non-interactive). Stash the originals and
// restore after each test so cases don't leak into one another.
const origStdin = process.stdin.isTTY;
const origStdout = process.stdout.isTTY;

function setTty(stdin: boolean | undefined, stdout: boolean | undefined): void {
  // isTTY is `true` on a real terminal and `undefined` when piped/redirected.
  (process.stdin as { isTTY?: boolean }).isTTY = stdin;
  (process.stdout as { isTTY?: boolean }).isTTY = stdout;
}

afterEach(() => {
  (process.stdin as { isTTY?: boolean }).isTTY = origStdin;
  (process.stdout as { isTTY?: boolean }).isTTY = origStdout;
});

describe("isInteractive", () => {
  it("is true only when both stdin and stdout are TTYs", () => {
    setTty(true, true);
    expect(isInteractive()).toBe(true);
  });

  it("is false when stdin is not a TTY", () => {
    setTty(undefined, true);
    expect(isInteractive()).toBe(false);
  });

  it("is false when stdout is not a TTY", () => {
    setTty(true, undefined);
    expect(isInteractive()).toBe(false);
  });

  it("is false when neither is a TTY", () => {
    setTty(undefined, undefined);
    expect(isInteractive()).toBe(false);
  });
});

describe("resolveDecision", () => {
  it("returns the flag value when one is provided (flag wins), even in a TTY", async () => {
    setTty(true, true);
    let prompted = false;
    const out = await resolveDecision<boolean>({
      flagValue: false,
      interactive: async () => {
        prompted = true;
        return true;
      },
      fallback: { value: true },
      flagName: "yes",
    });
    expect(out).toBe(false);
    expect(prompted).toBe(false);
  });

  it("flag wins over --yes and never consults the fallback", async () => {
    setTty(false as unknown as undefined, false as unknown as undefined);
    const out = await resolveDecision<string>({
      flagValue: "flagged",
      yes: true,
      interactive: async () => "prompted",
      fallback: { value: "fallback" },
      flagName: "value",
    });
    expect(out).toBe("flagged");
  });

  it("non-TTY with a fallback returns the fallback value (never prompts)", async () => {
    setTty(undefined, undefined);
    let prompted = false;
    const out = await resolveDecision<boolean>({
      flagValue: undefined,
      interactive: async () => {
        prompted = true;
        return false;
      },
      fallback: { value: true },
      flagName: "yes",
    });
    expect(out).toBe(true);
    expect(prompted).toBe(false);
  });

  it("non-TTY with no fallback throws an error naming the flag", async () => {
    setTty(undefined, undefined);
    await expect(
      resolveDecision<boolean>({
        flagValue: undefined,
        interactive: async () => true,
        flagName: "yes",
      }),
    ).rejects.toThrow("--yes");
  });

  it("--yes forces the non-interactive path even inside a TTY (uses fallback)", async () => {
    setTty(true, true);
    let prompted = false;
    const out = await resolveDecision<boolean>({
      flagValue: undefined,
      yes: true,
      interactive: async () => {
        prompted = true;
        return false;
      },
      fallback: { value: true },
      flagName: "yes",
    });
    expect(out).toBe(true);
    expect(prompted).toBe(false);
  });

  it("--yes with no fallback throws naming the flag (never hangs, never guesses)", async () => {
    setTty(true, true);
    await expect(
      resolveDecision<boolean>({
        flagValue: undefined,
        yes: true,
        interactive: async () => true,
        flagName: "force",
      }),
    ).rejects.toThrow("--force");
  });

  it("interactive path calls the prompt thunk and returns its resolved value", async () => {
    setTty(true, true);
    let prompted = false;
    const out = await resolveDecision<string>({
      flagValue: undefined,
      interactive: async () => {
        prompted = true;
        return "from-prompt";
      },
      fallback: { value: "fallback" },
      flagName: "yes",
    });
    expect(prompted).toBe(true);
    expect(out).toBe("from-prompt");
  });
});
