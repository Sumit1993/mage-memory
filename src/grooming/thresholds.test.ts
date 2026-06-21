import { describe, expect, it } from "vitest";
import {
  DEMOTE_MATCH_RATE,
  LOW_MATCH_RATE,
  MIN_LOADS_FOR_SUGGESTION,
} from "../metrics/context-match.js";
import {
  BASE_THRESHOLDS,
  DEFAULT_SENSITIVITY,
  narrowSensitivity,
  type Sensitivity,
  thresholdsFor,
} from "./thresholds.js";

// thresholds.ts is PURE compute: the constants/scaling + the sensitivity narrower. The metadata
// READ that feeds the narrower lives in grooming/config.ts (covered by config.test.ts).

// ─── BASE_THRESHOLDS — single-sources the rate-floors ─────────────────────────

describe("BASE_THRESHOLDS — finalizes the provisional 0.0.6 numbers", () => {
  it("uses the @normal recurrence gates and the new 0.0.8 constants", () => {
    expect(BASE_THRESHOLDS.promoteSessions).toBe(3);
    expect(BASE_THRESHOLDS.graduateSessions).toBe(5);
    expect(BASE_THRESHOLDS.noteSizeCap).toBe(6000);
    expect(BASE_THRESHOLDS.editBudget).toBe(3);
    expect(BASE_THRESHOLDS.promotionBudget).toBe(5);
  });

  it("reuses context-match.ts's rate-floors (never forks the numbers)", () => {
    expect(BASE_THRESHOLDS.rewordRate).toBe(LOW_MATCH_RATE);
    expect(BASE_THRESHOLDS.demoteRate).toBe(DEMOTE_MATCH_RATE);
    expect(BASE_THRESHOLDS.minLoads).toBe(MIN_LOADS_FOR_SUGGESTION);
  });

  it("defaults the dial to normal", () => {
    expect(DEFAULT_SENSITIVITY).toBe("normal");
  });
});

// ─── thresholdsFor — scales ONLY the recurrence gates ─────────────────────────

describe("thresholdsFor — the dial scales only promote/graduate sessions", () => {
  it("normal returns the BASE values", () => {
    expect(thresholdsFor("normal")).toEqual(BASE_THRESHOLDS);
  });

  it("high lowers the gates (easier to surface)", () => {
    const t = thresholdsFor("high");
    expect(t.promoteSessions).toBe(2);
    expect(t.graduateSessions).toBe(4);
  });

  it("low raises the gates (harder to surface)", () => {
    const t = thresholdsFor("low");
    expect(t.promoteSessions).toBe(4);
    expect(t.graduateSessions).toBe(7);
  });

  it("never scales the rate-floors / minLoads / editBudget / sizeCap", () => {
    for (const s of ["low", "normal", "high"] as Sensitivity[]) {
      const t = thresholdsFor(s);
      expect(t.rewordRate).toBe(BASE_THRESHOLDS.rewordRate);
      expect(t.demoteRate).toBe(BASE_THRESHOLDS.demoteRate);
      expect(t.minLoads).toBe(BASE_THRESHOLDS.minLoads);
      expect(t.editBudget).toBe(BASE_THRESHOLDS.editBudget);
      expect(t.noteSizeCap).toBe(BASE_THRESHOLDS.noteSizeCap);
    }
  });

  it("returns a NEW object — never mutates BASE_THRESHOLDS", () => {
    const before = { ...BASE_THRESHOLDS };
    const t = thresholdsFor("high");
    t.promoteSessions = 999;
    expect(BASE_THRESHOLDS).toEqual(before);
  });
});

// ─── narrowSensitivity — junk-narrow the dial (PURE) ──────────────────────────

describe("narrowSensitivity — narrows to the three-way enum, else default", () => {
  it("passes the three positions through", () => {
    expect(narrowSensitivity("low")).toBe("low");
    expect(narrowSensitivity("normal")).toBe("normal");
    expect(narrowSensitivity("high")).toBe("high");
  });

  it("falls back to normal on junk / undefined (never throws)", () => {
    expect(narrowSensitivity("aggressive")).toBe(DEFAULT_SENSITIVITY);
    expect(narrowSensitivity(undefined)).toBe(DEFAULT_SENSITIVITY);
    expect(narrowSensitivity(3)).toBe(DEFAULT_SENSITIVITY);
  });
});
