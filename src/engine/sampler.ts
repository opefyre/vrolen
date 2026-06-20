/**
 * VROL-76 — Sampler interface. Wraps a `Distribution` + `Prng` into a
 * zero-arg `next()` callable. Useful for code paths that want to mint a
 * stream of samples without re-specifying the distribution at each call
 * site (e.g. cycle executors that pre-build a sampler per station).
 *
 * Functionally equivalent to currying `sample(d, prng)` — the wrapper just
 * makes the relationship between (Distribution, RNG, stream) explicit and
 * easier to mock in tests.
 */

import type { Distribution } from "./distribution";
import type { Prng } from "./prng";
import { sample, type SampleOptions } from "./sampling";

export interface Sampler {
  /** Draw the next value from this distribution + PRNG. */
  next(): number;
  /** Distribution this sampler was built from (read-only). */
  readonly distribution: Distribution;
}

export function makeSampler(d: Distribution, prng: Prng, options?: SampleOptions): Sampler {
  return {
    distribution: d,
    next: (): number => sample(d, prng, options),
  };
}
