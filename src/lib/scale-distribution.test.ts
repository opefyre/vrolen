import { describe, expect, it } from "vitest";

import type { Distribution } from "@/engine";

import { isDistribution, meanOfDistribution, scaleDistribution } from "./scale-distribution";

describe("scaleDistribution", () => {
  it("returns the same reference when k=1 (no-op fast path)", () => {
    const d: Distribution = { kind: "constant", value: 100 };
    expect(scaleDistribution(d, 1)).toBe(d);
  });

  it("scales a constant", () => {
    const d: Distribution = { kind: "constant", value: 100 };
    expect(scaleDistribution(d, 0.5)).toEqual({ kind: "constant", value: 50 });
  });

  it("scales a uniform range", () => {
    const d: Distribution = { kind: "uniform", min: 10, max: 20 };
    expect(scaleDistribution(d, 2)).toEqual({ kind: "uniform", min: 20, max: 40 });
  });

  it("scales normal mean and stddev together", () => {
    const d: Distribution = { kind: "normal", mean: 100, stddev: 10 };
    expect(scaleDistribution(d, 0.5)).toEqual({ kind: "normal", mean: 50, stddev: 5 });
  });

  it("scales triangular min/mode/max (rounded to whole ms)", () => {
    const d: Distribution = { kind: "triangular", min: 10, mode: 15, max: 20 };
    // 15 * 0.5 = 7.5 → rounds to 8 (engine requires integer ms).
    expect(scaleDistribution(d, 0.5)).toEqual({
      kind: "triangular",
      min: 5,
      mode: 8,
      max: 10,
    });
  });

  it("clamps to a minimum of 1ms so a scaled constant never collapses to 0", () => {
    const d: Distribution = { kind: "constant", value: 2 };
    expect(scaleDistribution(d, 0.1)).toEqual({ kind: "constant", value: 1 });
  });

  it("inverts exponential rate (rate ∝ 1/time)", () => {
    const d: Distribution = { kind: "exponential", rate: 0.01 };
    expect(scaleDistribution(d, 2)).toEqual({ kind: "exponential", rate: 0.005 });
  });

  it("shifts lognormal mu by ln(k), keeps sigma", () => {
    const d: Distribution = { kind: "lognormal", mu: 1, sigma: 0.5 };
    const scaled = scaleDistribution(d, Math.E);
    expect(scaled.kind).toBe("lognormal");
    if (scaled.kind === "lognormal") {
      expect(scaled.mu).toBeCloseTo(2);
      expect(scaled.sigma).toBe(0.5);
    }
  });

  it("scales weibull scale only", () => {
    const d: Distribution = { kind: "weibull", shape: 1.5, scale: 100 };
    expect(scaleDistribution(d, 2)).toEqual({ kind: "weibull", shape: 1.5, scale: 200 });
  });

  it("scales gamma scale only", () => {
    const d: Distribution = { kind: "gamma", shape: 2, scale: 50 };
    expect(scaleDistribution(d, 0.5)).toEqual({ kind: "gamma", shape: 2, scale: 25 });
  });

  it("scales empirical values pointwise", () => {
    const d: Distribution = { kind: "empirical", values: [10, 20, 30] };
    expect(scaleDistribution(d, 0.5)).toEqual({ kind: "empirical", values: [5, 10, 15] });
  });
});

describe("meanOfDistribution", () => {
  it("constant → value", () => {
    expect(meanOfDistribution({ kind: "constant", value: 100 })).toBe(100);
  });
  it("uniform → midpoint", () => {
    expect(meanOfDistribution({ kind: "uniform", min: 10, max: 30 })).toBe(20);
  });
  it("normal → mean", () => {
    expect(meanOfDistribution({ kind: "normal", mean: 50, stddev: 5 })).toBe(50);
  });
  it("triangular → (min+mode+max)/3", () => {
    expect(meanOfDistribution({ kind: "triangular", min: 10, mode: 15, max: 35 })).toBe(20);
  });
  it("exponential → 1/rate", () => {
    expect(meanOfDistribution({ kind: "exponential", rate: 0.01 })).toBe(100);
  });
  it("empirical → arithmetic mean", () => {
    expect(meanOfDistribution({ kind: "empirical", values: [10, 20, 30] })).toBe(20);
  });
  it("empirical empty → 0 (degenerate)", () => {
    expect(meanOfDistribution({ kind: "empirical", values: [] })).toBe(0);
  });
});

describe("isDistribution", () => {
  it("accepts a valid Distribution", () => {
    expect(isDistribution({ kind: "constant", value: 100 })).toBe(true);
  });
  it("rejects non-object", () => {
    expect(isDistribution(null)).toBe(false);
    expect(isDistribution(undefined)).toBe(false);
    expect(isDistribution(42)).toBe(false);
  });
  it("rejects object without a known kind", () => {
    expect(isDistribution({ kind: "unknown" })).toBe(false);
    expect(isDistribution({})).toBe(false);
  });
});
