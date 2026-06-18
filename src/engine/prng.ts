/**
 * Seedable deterministic pseudo-random number generator.
 *
 * Algorithm: a 32-bit variant in the PCG/SplitMix family (commonly called
 * "mulberry32"). Period 2^32 ≈ 4 billion, more than enough for a single
 * simulation run. Passes chi-squared, Kolmogorov-Smirnov, and TestU01 small
 * crush statistical tests.
 *
 * Why this over true PCG32 or xoshiro256++:
 *   - Pure 32-bit Number math (no BigInt overhead). On V8, the inner loop
 *     stays in SMI / int32 representations and JITs well.
 *   - The simulation engine doesn't need the longer periods of 64-bit
 *     generators — a 30-day sim emits ~10M events; we'd use ~10M PRNG
 *     draws, far short of 2^32.
 *   - Same statistical quality for non-crypto use.
 *
 * DETERMINISM IS THE CONTRACT: same seed → same sequence forever. The whole
 * engine relies on this. Tests assert it; do not modify the algorithm without
 * a migration plan (changed numbers will break every existing fixture).
 */

export interface Prng {
  /** Next u32 (0 to 2^32 - 1). */
  nextU32(): number;
  /** Next uniform double in [0, 1). */
  nextFloat(): number;
  /** Next uniform integer in [min, max). */
  nextInt(min: number, max: number): number;
}

/**
 * Mix a seed through SplitMix-style avalanche so adjacent seeds (1, 2, 3...)
 * produce well-separated PRNG streams. Without this, seed=0 and seed=1 would
 * produce very similar outputs for the first few draws.
 */
function mixSeed(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = (x ^ (x >>> 15)) >>> 0;
  return x;
}

export class SeededPrng implements Prng {
  private state: number;

  /**
   * @param seed Any 32-bit integer. Default 0xCAFEF00D for the simulator.
   */
  constructor(seed: number = 0xcafef00d) {
    this.state = mixSeed(seed);
    // Cycle once to move off the seed image — guards against pathological
    // first draws when the mixed seed lands near a fixed point.
    this.nextU32();
  }

  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  nextFloat(): number {
    // Divide by 2^32. Output is uniform in [0, 1) — never hits 1 exactly.
    return this.nextU32() / 4294967296;
  }

  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(`nextInt requires integer bounds, got [${String(min)}, ${String(max)})`);
    }
    if (max <= min) {
      throw new Error(`nextInt requires max > min, got [${String(min)}, ${String(max)})`);
    }
    const range = max - min;
    // For small ranges this introduces negligible bias; for sim work it's fine.
    // If we ever need rejection-sampled uniformity, that's a separate fn.
    return min + Math.floor(this.nextFloat() * range);
  }
}
