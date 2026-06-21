import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY,
  LEVELS,
  coerceAutonomy,
  mandateFor,
  meaningOf,
  narrowAutonomy,
} from "./autonomy-ladder.js";

describe("autonomy ladder — LEVELS / default", () => {
  it("lists the three rungs in order, defaulting to the lowest", () => {
    expect(LEVELS).toEqual(["operator", "approver", "overseer"]);
    expect(DEFAULT_AUTONOMY).toBe("operator");
    expect(LEVELS[0]).toBe(DEFAULT_AUTONOMY);
  });
});

describe("coerceAutonomy", () => {
  it("accepts the three levels", () => {
    expect(coerceAutonomy("operator")).toBe("operator");
    expect(coerceAutonomy("approver")).toBe("approver");
    expect(coerceAutonomy("overseer")).toBe("overseer");
  });

  it("throws on junk, listing all three", () => {
    expect(() => coerceAutonomy("autopilot")).toThrow(/operator, approver, overseer/);
  });
});

describe("narrowAutonomy", () => {
  it("passes the three levels through", () => {
    expect(narrowAutonomy("operator")).toBe("operator");
    expect(narrowAutonomy("approver")).toBe("approver");
    expect(narrowAutonomy("overseer")).toBe("overseer");
  });

  it("fails open to the default on junk / undefined (never throws)", () => {
    expect(narrowAutonomy("autopilot")).toBe(DEFAULT_AUTONOMY);
    expect(narrowAutonomy(undefined)).toBe(DEFAULT_AUTONOMY);
    expect(narrowAutonomy(42)).toBe(DEFAULT_AUTONOMY);
  });
});

describe("meaningOf", () => {
  it("gives a one-line meaning per level", () => {
    expect(meaningOf("operator")).toMatch(/you run mage:groom/);
    expect(meaningOf("approver")).toMatch(/review the diff \+ commit/);
    expect(meaningOf("overseer")).toMatch(/graduates eligible notes/);
  });
});

describe("mandateFor", () => {
  const line = "mage: 3 staged · 1 chapter unmined · up to 0 eligible to graduate";

  it("prepends the backlog line at every level", () => {
    for (const level of LEVELS) expect(mandateFor(level, line).startsWith(`${line}\n`)).toBe(true);
  });

  it("operator is a reminder, not an autonomous-write authorization", () => {
    const m = mandateFor("operator", line);
    expect(m).toContain("Review with `mage:groom`");
    expect(m).not.toContain("authorized");
  });

  it("approver authorizes durable writes, uncommitted + Gate-2", () => {
    const m = mandateFor("approver", line);
    expect(m).toContain("autonomy: approver");
    expect(m).toContain("UNCOMMITTED");
    expect(m).toContain("Gate-2");
  });

  it("overseer adds dispose + graduate, still commit-gated", () => {
    const m = mandateFor("overseer", line);
    expect(m).toContain("autonomy: overseer");
    expect(m).toContain("mage:graduate");
    expect(m).toContain("mage never commits");
  });
});
