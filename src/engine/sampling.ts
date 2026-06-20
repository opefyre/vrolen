/**
 * Distribution samplers.
 *
 * Given a Distribution + a Prng, produce a sample. One entry point —
 * `sample(distribution, prng, options?)` — switches on the discriminator
 * and dispatches to the per-kind sampler.
 *
 * Determinism: every random decision comes from a single PRNG sequence.
 * Same (PRNG state, distribution) → same output. No internal caching that
 * could break reproducibility across runs.
 *
 * Clamping: many engine fields (cycle times, MTBF, MTTR) are physically
 * positive — a Normal(1, 2) could naturally produce negative values.
 * Pass `{ min: 0 }` (or any other bound) at the call site to clamp.
 * The clamp is symmetric across all distribution kinds.
 */

import type { Distribution } from "./distribution";
import type { Prng } from "./prng";

export interface SampleOptions {
  /** Clamp the sampled value to be >= min. */
  readonly min?: number;
  /** Clamp the sampled value to be <= max. */
  readonly max?: number;
}

/** Produce one sample from the distribution using the given PRNG. */
export function sample(d: Distribution, prng: Prng, options?: SampleOptions): number {
  let v: number;
  switch (d.kind) {
    case "constant":
      v = d.value;
      break;
    case "uniform":
      v = d.min + prng.nextFloat() * (d.max - d.min);
      break;
    case "triangular":
      v = sampleTriangular(d.min, d.mode, d.max, prng);
      break;
    case "normal":
      v = sampleNormal(d.mean, d.stddev, prng);
      break;
    case "exponential":
      v = sampleExponential(d.rate, prng);
      break;
    case "lognormal":
      v = Math.exp(sampleNormal(d.mu, d.sigma, prng));
      break;
    case "weibull":
      v = sampleWeibull(d.shape, d.scale, prng);
      break;
    case "gamma":
      v = sampleGamma(d.shape, d.scale, prng);
      break;
    case "empirical":
      v = sampleEmpirical(d.values, prng);
      break;
  }
  if (options?.min !== undefined && v < options.min) v = options.min;
  if (options?.max !== undefined && v > options.max) v = options.max;
  return v;
}

/**
 * Triangular distribution via inverse-CDF.
 *   CDF(x) = (x-min)² / ((max-min)(mode-min))     for min ≤ x ≤ mode
 *          = 1 - (max-x)² / ((max-min)(max-mode))  for mode ≤ x ≤ max
 */
function sampleTriangular(min: number, mode: number, max: number, prng: Prng): number {
  const span = max - min;
  if (span === 0) return min;
  const u = prng.nextFloat();
  const f = (mode - min) / span;
  if (u < f) {
    return min + Math.sqrt(u * span * (mode - min));
  }
  return max - Math.sqrt((1 - u) * span * (max - mode));
}

/**
 * Standard Normal via Box-Muller, scaled and shifted to N(mean, stddev²).
 *
 * No pair-caching: pair-caching is a 2x speedup but introduces hidden state
 * that breaks "same PRNG state → same output" — debugging stale-cache effects
 * across multi-run scenarios isn't worth the speed. Each call burns two PRNG
 * draws. PRNG cost is dominated by the rest of the engine anyway.
 *
 * Guards: u1=0 would mean log(0) = -Infinity. Substitute MIN_VALUE — produces
 * a very large but finite normal sample. Statistically negligible.
 */
function sampleNormal(mean: number, stddev: number, prng: Prng): number {
  let u1 = prng.nextFloat();
  if (u1 === 0) u1 = Number.MIN_VALUE;
  const u2 = prng.nextFloat();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z0;
}

/**
 * Exponential(rate) via inverse-CDF.
 *   F(x) = 1 - exp(-rate * x)
 *   F⁻¹(u) = -ln(1 - u) / rate
 */
function sampleExponential(rate: number, prng: Prng): number {
  // 1 - u is uniformly distributed on (0, 1] (vs u in [0, 1) means 1-u in (0, 1]),
  // so log argument is always positive.
  const u = prng.nextFloat();
  return -Math.log(1 - u) / rate;
}

/**
 * Weibull via inverse-CDF: X = scale * (-ln(1-U))^(1/shape).
 * Reduces to Exponential when shape = 1.
 */
function sampleWeibull(shape: number, scale: number, prng: Prng): number {
  if (shape <= 0 || scale <= 0) return 0;
  let u = prng.nextFloat();
  if (u === 1) u = Number.MIN_VALUE;
  return scale * Math.pow(-Math.log(1 - u), 1 / shape);
}

/**
 * Gamma via Marsaglia-Tsang (2000): for shape >= 1 it's a fast 2-PRNG-draw
 * acceptance-rejection. For shape < 1 we use Gamma(shape+1) * U^(1/shape).
 * Scale just multiplies the result. No external deps.
 */
function sampleGamma(shape: number, scale: number, prng: Prng): number {
  if (shape <= 0 || scale <= 0) return 0;
  if (shape < 1) {
    return sampleGamma(shape + 1, scale, prng) * Math.pow(prng.nextFloat(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(0, 1, prng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = prng.nextFloat();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/**
 * Empirical sampler — pick a position uniformly at random in [0, n-1],
 * linearly interpolate between adjacent sorted values. This produces a
 * smoother CDF than a pure index-bootstrap and is closer to Arena's
 * "empirical continuous" sampler.
 */
function sampleEmpirical(values: readonly number[], prng: Prng): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0]!;
  const u = prng.nextFloat() * (n - 1);
  const lo = Math.floor(u);
  const hi = Math.min(n - 1, lo + 1);
  const frac = u - lo;
  const a = values[lo]!;
  const b = values[hi]!;
  return a + (b - a) * frac;
}
