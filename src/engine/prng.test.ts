import { describe, expect, it } from "vitest";

import { SeededPrng } from "./prng";

describe("SeededPrng — determinism", () => {
  it("same seed produces identical first 10,000 u32 values", () => {
    const a = new SeededPrng(12345);
    const b = new SeededPrng(12345);
    for (let i = 0; i < 10_000; i++) {
      expect(a.nextU32()).toBe(b.nextU32());
    }
  });

  it("same seed produces identical first 1000 floats", () => {
    const a = new SeededPrng(0xdeadbeef);
    const b = new SeededPrng(0xdeadbeef);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextFloat()).toBe(b.nextFloat());
    }
  });

  it("different seeds produce different first u32 (basic uncorrelation)", () => {
    const a = new SeededPrng(1);
    const b = new SeededPrng(2);
    // Adjacent seeds with raw mulberry32 produce nearly-identical streams; the
    // SplitMix avalanche we apply at construction breaks that. First 5 draws
    // should all differ.
    let differences = 0;
    for (let i = 0; i < 5; i++) {
      if (a.nextU32() !== b.nextU32()) differences++;
    }
    expect(differences).toBe(5);
  });

  it("default seed is consistent across constructions", () => {
    const a = new SeededPrng();
    const b = new SeededPrng();
    for (let i = 0; i < 100; i++) {
      expect(a.nextU32()).toBe(b.nextU32());
    }
  });
});

describe("SeededPrng — output ranges", () => {
  it("nextU32 returns integers in [0, 2^32)", () => {
    const p = new SeededPrng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = p.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4294967296);
    }
  });

  it("nextFloat returns values in [0, 1)", () => {
    const p = new SeededPrng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = p.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt returns values in [min, max)", () => {
    const p = new SeededPrng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = p.nextInt(5, 15);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it("nextInt rejects non-integer or invalid ranges", () => {
    const p = new SeededPrng();
    expect(() => p.nextInt(0.5, 10)).toThrow();
    expect(() => p.nextInt(0, 10.5)).toThrow();
    expect(() => p.nextInt(10, 10)).toThrow();
    expect(() => p.nextInt(10, 5)).toThrow();
  });
});

describe("SeededPrng — statistical quality", () => {
  it("chi-squared uniformity test on 1M samples (α=0.01, k=10 bins)", () => {
    // Bin 1M nextFloat() draws into 10 equal-width bins over [0, 1).
    // Expected count per bin: 100,000. Compute χ² = Σ((O - E)² / E).
    // Critical value for df=9, α=0.01: 21.666 (from a standard table).
    // For a well-behaved uniform RNG, χ² should be well below that.
    const N = 1_000_000;
    const K = 10;
    const counts = new Array<number>(K).fill(0);
    const prng = new SeededPrng(0xc0ffee);

    for (let i = 0; i < N; i++) {
      const v = prng.nextFloat();
      const bin = Math.min(Math.floor(v * K), K - 1);
      counts[bin] = (counts[bin] ?? 0) + 1;
    }

    const expected = N / K;
    let chiSquared = 0;
    for (let i = 0; i < K; i++) {
      const observed = counts[i] ?? 0;
      const diff = observed - expected;
      chiSquared += (diff * diff) / expected;
    }

    // 21.666 is the α=0.01 critical value for df=9. A good PRNG passes this
    // by a wide margin (typically χ² < 15 for N=1M, K=10).
    expect(chiSquared).toBeLessThan(21.666);
  });

  it("no draw repeats within the first 100 calls (basic decorrelation)", () => {
    const p = new SeededPrng(0xabcdef);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const v = p.nextU32();
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });
});
