/**
 * Distribution — a tagged-union TYPE used by numeric fields that can be either
 * deterministic or stochastic (cycle times, defect rates, MTBF, MTTR, ...).
 *
 * This file owns the TYPE only. The schema (Zod) lands in VROL-69 and the
 * sampler implementation (sample(rng) -> number) lands in VROL-76/VROL-101.
 *
 * Defining the type here in VROL-65 because every Station subtype references
 * it; trying to bolt on Distribution later would force a refactor across
 * every entity. Easier to ship the shape up-front, fill in semantics next.
 */
export type Distribution =
  | { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "uniform"; readonly min: number; readonly max: number }
  | { readonly kind: "normal"; readonly mean: number; readonly stddev: number }
  /**
   * VROL-976 — Normal with explicit truncation. Re-samples until a draw
   * falls in [min, max]; after a cap of attempts (50) the sample is
   * clamped to the nearest bound and `onClamp` fires (via SampleOptions).
   * Use this when the underlying physical quantity is bounded (cycle
   * times can't be negative, station-fed temperatures have a spec
   * window) and you want the engine to bias-correct rather than
   * silently shift the mean upward via a one-sided clamp.
   */
  | {
      readonly kind: "truncatedNormal";
      readonly mean: number;
      readonly stddev: number;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "triangular";
      readonly min: number;
      readonly mode: number;
      readonly max: number;
    }
  | { readonly kind: "exponential"; readonly rate: number }
  /**
   * Lognormal — heavy-tailed positive distribution that matches almost every
   * real-world cycle-time histogram. Parameterised by the mean and stddev
   * of log(X), not X itself, to match Arena's convention.
   */
  | { readonly kind: "lognormal"; readonly mu: number; readonly sigma: number }
  /**
   * Weibull — flexible failure-time / cycle-time distribution. shape > 1
   * grows monotonically (typical for cycle times); shape < 1 decays.
   * Reduces to Exponential when shape = 1.
   */
  | { readonly kind: "weibull"; readonly shape: number; readonly scale: number }
  /**
   * Gamma — also flexible positive-only; arises from sums of exponentials.
   * Mean = shape × scale.
   */
  | { readonly kind: "gamma"; readonly shape: number; readonly scale: number }
  /**
   * Empirical — sampled directly from a user-supplied dataset. We store the
   * sorted values; sampling picks one uniformly at random with linear
   * interpolation between neighbours (smoother than pure step bootstrap).
   * Captures any real-world distribution, no parametric assumption.
   */
  | { readonly kind: "empirical"; readonly values: readonly number[] };

/** Convenience: build a constant Distribution from a plain number. */
export const constant = (value: number): Distribution => ({ kind: "constant", value });

/** Analytical mean of a Distribution. Used by OEE for ideal cycle time. */
export function meanOf(d: Distribution): number {
  switch (d.kind) {
    case "constant":
      return d.value;
    case "uniform":
      return (d.min + d.max) / 2;
    case "normal":
      return d.mean;
    case "triangular":
      return (d.min + d.mode + d.max) / 3;
    case "exponential":
      return 1 / d.rate;
    case "lognormal":
      // E[X] = exp(mu + sigma^2 / 2) for X ~ Lognormal(mu, sigma).
      return Math.exp(d.mu + (d.sigma * d.sigma) / 2);
    case "weibull":
      // E[X] = scale * Gamma(1 + 1/shape). We approximate Gamma via Stirling
      // / Lanczos so the engine has no extra deps. For typical shape >= 1,
      // a 4-term Stirling is accurate to <0.1%.
      return d.scale * gammaFn(1 + 1 / d.shape);
    case "gamma":
      // E[X] = shape * scale.
      return d.shape * d.scale;
    case "empirical": {
      if (d.values.length === 0) return 0;
      let sum = 0;
      for (const v of d.values) sum += v;
      return sum / d.values.length;
    }
  }
}

/**
 * Lanczos approximation to the Gamma function. Accurate to ~1e-15 for
 * positive real arguments. We only need it for the Weibull / Gamma means
 * here; the samplers don't call it.
 */
function gammaFn(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  }
  z -= 1;
  let x = p[0]!;
  for (let i = 1; i < g + 2; i++) x += p[i]! / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
