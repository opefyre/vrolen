import { describe, expect, it } from "vitest";

import type { Distribution } from "./distribution";
import { constant } from "./distribution";
import { SeededPrng } from "./prng";
import { sample } from "./sampling";

const N = 100_000;
const TOLERANCE = 0.01; // 1% — what the AC requires

function meanOf(samples: number[]): number {
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function varianceOf(samples: number[]): number {
  const m = meanOf(samples);
  return samples.reduce((acc, v) => acc + (v - m) * (v - m), 0) / samples.length;
}

function sampleN(d: Distribution, prng: SeededPrng, n: number): number[] {
  return Array.from({ length: n }, () => sample(d, prng));
}

describe("sample — constant", () => {
  it("always returns the configured value", () => {
    const prng = new SeededPrng(42);
    for (let i = 0; i < 1000; i++) {
      expect(sample(constant(7.5), prng)).toBe(7.5);
    }
  });

  it("clamping does not affect a constant inside bounds", () => {
    const prng = new SeededPrng(42);
    expect(sample(constant(5), prng, { min: 0, max: 10 })).toBe(5);
  });

  it("clamping does affect a constant outside bounds", () => {
    const prng = new SeededPrng(42);
    expect(sample(constant(-5), prng, { min: 0 })).toBe(0);
    expect(sample(constant(100), prng, { max: 50 })).toBe(50);
  });
});

describe("sample — uniform", () => {
  it("produces values in [min, max)", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "uniform", min: 5, max: 15 };
    for (let i = 0; i < 1000; i++) {
      const v = sample(d, prng);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it("mean approaches (min + max) / 2 within 1% over 100k samples", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "uniform", min: 0, max: 100 };
    const m = meanOf(sampleN(d, prng, N));
    expect(Math.abs(m - 50)).toBeLessThan(50 * TOLERANCE);
  });
});

describe("sample — triangular", () => {
  it("respects [min, max] shape (no samples outside the support)", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "triangular", min: 10, mode: 30, max: 100 };
    for (let i = 0; i < 10_000; i++) {
      const v = sample(d, prng);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("mean ≈ (min + mode + max) / 3 within 1% over 100k samples", () => {
    const prng = new SeededPrng(42);
    const min = 0;
    const mode = 30;
    const max = 90;
    const d: Distribution = { kind: "triangular", min, mode, max };
    const m = meanOf(sampleN(d, prng, N));
    const expected = (min + mode + max) / 3; // 40
    expect(Math.abs(m - expected)).toBeLessThan(expected * TOLERANCE);
  });

  it("more samples land near mode than near tails", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "triangular", min: 0, mode: 50, max: 100 };
    let nearMode = 0;
    let nearTails = 0;
    for (let i = 0; i < N; i++) {
      const v = sample(d, prng);
      if (v >= 40 && v <= 60) nearMode++;
      if (v < 10 || v > 90) nearTails++;
    }
    expect(nearMode).toBeGreaterThan(nearTails);
  });
});

describe("sample — normal", () => {
  it("mean approaches the configured mean within 1% over 100k samples", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "normal", mean: 100, stddev: 10 };
    const m = meanOf(sampleN(d, prng, N));
    expect(Math.abs(m - 100)).toBeLessThan(100 * TOLERANCE);
  });

  it("variance approaches stddev² within 2% over 100k samples", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "normal", mean: 0, stddev: 5 };
    const v = varianceOf(sampleN(d, prng, N));
    const expected = 25;
    // Variance has higher sampling noise than mean; loosen to 2%.
    expect(Math.abs(v - expected)).toBeLessThan(expected * 0.02);
  });

  it("clamping at 0: Normal(mean=1, stddev=2) never returns negative when clamped", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "normal", mean: 1, stddev: 2 };
    let clamps = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = sample(d, prng, { min: 0 });
      expect(v).toBeGreaterThanOrEqual(0);
      if (v === 0) clamps++;
    }
    // Sanity: with mean=1, stddev=2, roughly 30% of samples should be < 0 → clamped to 0
    expect(clamps).toBeGreaterThan(2000);
    expect(clamps).toBeLessThan(4000);
  });
});

describe("sample — exponential", () => {
  it("produces non-negative values", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "exponential", rate: 0.5 };
    for (let i = 0; i < 10_000; i++) {
      expect(sample(d, prng)).toBeGreaterThanOrEqual(0);
    }
  });

  it("mean ≈ 1/rate within 1% over 100k samples", () => {
    const prng = new SeededPrng(42);
    const d: Distribution = { kind: "exponential", rate: 0.25 };
    const m = meanOf(sampleN(d, prng, N));
    const expected = 1 / 0.25; // 4
    expect(Math.abs(m - expected)).toBeLessThan(expected * TOLERANCE);
  });
});

describe("sample — determinism", () => {
  it("same PRNG seed + same distribution → bit-identical 1000 samples", () => {
    const d: Distribution = { kind: "normal", mean: 100, stddev: 10 };
    const a = new SeededPrng(0xdeadbeef);
    const b = new SeededPrng(0xdeadbeef);
    for (let i = 0; i < 1000; i++) {
      expect(sample(d, a)).toBe(sample(d, b));
    }
  });
});
