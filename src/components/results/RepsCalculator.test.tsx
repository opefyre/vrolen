import { describe, expect, it } from "vitest";

import { RepsCalculator } from "./RepsCalculator";
import { CONFIDENCE_Z, requiredReplications, type ConfidenceLevel } from "./reps-calc";

describe("requiredReplications — VROL-844", () => {
  it("matches the textbook n* = ceil((z·σ/(d·μ))²) for each tabled z", () => {
    // μ = 100, σ = 20, target ±5% ⇒ d·μ = 5.
    const mean = 100;
    const stddev = 20;
    const target = 0.05;
    for (const level of [90, 95, 99] as const) {
      const z = CONFIDENCE_Z[level];
      const expected = Math.ceil(((z * stddev) / (target * mean)) ** 2);
      expect(requiredReplications(mean, stddev, target, level)).toBe(expected);
    }
  });

  it("known case: μ=100, σ=20, ±5% at 95% confidence ⇒ 62 reps", () => {
    // (1.96 * 20 / 5)^2 = (7.84)^2 = 61.4656 ⇒ ceil = 62
    expect(requiredReplications(100, 20, 0.05, 95)).toBe(62);
  });

  it("returns null when mean is zero (relative target is undefined)", () => {
    expect(requiredReplications(0, 5, 0.05, 95)).toBeNull();
  });

  it("returns null when mean is negative", () => {
    expect(requiredReplications(-10, 5, 0.05, 95)).toBeNull();
  });

  it("returns 1 when stddev is zero (any single rep already hits the target)", () => {
    expect(requiredReplications(100, 0, 0.05, 95)).toBe(1);
    expect(requiredReplications(100, 0, 0.01, 99)).toBe(1);
  });

  it("returns null when target precision is zero or negative", () => {
    expect(requiredReplications(100, 20, 0, 95)).toBeNull();
    expect(requiredReplications(100, 20, -0.01, 95)).toBeNull();
  });

  it("scales as 1/target² — halving the target quadruples the reps", () => {
    const coarse = requiredReplications(100, 20, 0.1, 95);
    const fine = requiredReplications(100, 20, 0.05, 95);
    expect(coarse).not.toBeNull();
    expect(fine).not.toBeNull();
    if (coarse !== null && fine !== null) {
      // Ceil noise can shift by 1 either way; check ratio is ~4 within tolerance.
      expect(fine / coarse).toBeGreaterThan(3.5);
      expect(fine / coarse).toBeLessThan(4.5);
    }
  });

  it("scales as σ² — doubling stddev quadruples the reps", () => {
    const low = requiredReplications(100, 10, 0.05, 95);
    const high = requiredReplications(100, 20, 0.05, 95);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    if (low !== null && high !== null) {
      expect(high / low).toBeGreaterThan(3.5);
      expect(high / low).toBeLessThan(4.5);
    }
  });

  it("guards against non-finite inputs", () => {
    expect(requiredReplications(Number.NaN, 20, 0.05, 95)).toBeNull();
    expect(requiredReplications(100, Number.POSITIVE_INFINITY, 0.05, 95)).toBeNull();
    expect(requiredReplications(100, 20, Number.NaN, 95)).toBeNull();
  });

  it("always returns at least 1 rep for valid inputs", () => {
    // Very loose target — formula could compute < 1 in theory; we floor at 1.
    const n = requiredReplications(100, 1, 0.5, 90);
    expect(n).not.toBeNull();
    if (n !== null) expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe("CONFIDENCE_Z", () => {
  it("exposes the textbook two-sided normal critical values", () => {
    const expected: Record<ConfidenceLevel, number> = { 90: 1.645, 95: 1.96, 99: 2.576 };
    for (const level of [90, 95, 99] as const) {
      expect(CONFIDENCE_Z[level]).toBe(expected[level]);
    }
  });
});

describe("RepsCalculator component", () => {
  it("exports a default", () => {
    // Smoke check — component is a function. Full rendering is exercised in
    // the ResultPanel integration test (kept light because base-ui Select +
    // happy-dom interaction is brittle).
    expect(typeof RepsCalculator).toBe("function");
  });
});
