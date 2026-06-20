/**
 * VROL-465 — coverage augment tests.
 *
 * Targeted tests filling gaps in engine module coverage so the engine
 * line + branch percentage moves toward the 85% / 80% goal stated in
 * project rules. Each block here exists because the corresponding code
 * path was previously uncovered or only exercised indirectly.
 */

import { describe, expect, it } from "vitest";

import { constant, meanOf, type Distribution } from "./distribution";
import { SeededPrng } from "./prng";
import { sample } from "./sampling";
import { makeSampler } from "./sampler";

describe("Distribution coverage (VROL-465)", () => {
  it("meanOf covers every distribution kind", () => {
    expect(meanOf(constant(7))).toBe(7);
    expect(meanOf({ kind: "uniform", min: 0, max: 10 })).toBe(5);
    expect(meanOf({ kind: "normal", mean: 12, stddev: 1 })).toBe(12);
    expect(meanOf({ kind: "triangular", min: 0, mode: 5, max: 10 })).toBeCloseTo(5);
    expect(meanOf({ kind: "exponential", rate: 0.5 })).toBe(2);
  });
});

describe("Sampling coverage (VROL-465)", () => {
  const prng = new SeededPrng(0xc0ffee);

  it("sample(uniform) lands inside [min, max]", () => {
    const d: Distribution = { kind: "uniform", min: 0, max: 10 };
    for (let i = 0; i < 200; i++) {
      const v = sample(d, prng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("sample(normal) is broadly within ±5σ", () => {
    const d: Distribution = { kind: "normal", mean: 100, stddev: 10 };
    for (let i = 0; i < 200; i++) {
      const v = sample(d, prng);
      expect(v).toBeGreaterThan(50);
      expect(v).toBeLessThan(150);
    }
  });

  it("sample(triangular) lands inside [min, max]", () => {
    const d: Distribution = { kind: "triangular", min: 0, mode: 3, max: 10 };
    for (let i = 0; i < 200; i++) {
      const v = sample(d, prng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it("sample(exponential) is non-negative", () => {
    const d: Distribution = { kind: "exponential", rate: 0.01 };
    for (let i = 0; i < 200; i++) {
      const v = sample(d, prng);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("sample respects min + max clamp options", () => {
    expect(sample(constant(-10), prng, { min: 0 })).toBe(0);
    expect(sample(constant(1000), prng, { max: 50 })).toBe(50);
    expect(sample(constant(5), prng, { min: 0, max: 10 })).toBe(5);
  });
});

describe("Sampler coverage (VROL-465)", () => {
  it("next() yields a stream of valid samples", () => {
    const prng = new SeededPrng(1);
    const s = makeSampler({ kind: "uniform", min: 1, max: 2 }, prng);
    for (let i = 0; i < 100; i++) {
      const v = s.next();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it("two samplers from the same seed produce identical streams", () => {
    const a = makeSampler(constant(7), new SeededPrng(42));
    const b = makeSampler(constant(7), new SeededPrng(42));
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});

describe("PRNG coverage (VROL-465)", () => {
  it("two PRNGs from the same seed produce identical streams", () => {
    const a = new SeededPrng(1234);
    const b = new SeededPrng(1234);
    for (let i = 0; i < 100; i++) {
      expect(a.nextFloat()).toBe(b.nextFloat());
    }
  });

  it("two PRNGs from different seeds diverge", () => {
    const a = new SeededPrng(1);
    const b = new SeededPrng(2);
    const aVals = Array.from({ length: 50 }, () => a.nextFloat());
    const bVals = Array.from({ length: 50 }, () => b.nextFloat());
    expect(aVals).not.toEqual(bVals);
  });
});
