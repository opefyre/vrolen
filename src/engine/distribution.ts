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
  | {
      readonly kind: "triangular";
      readonly min: number;
      readonly mode: number;
      readonly max: number;
    }
  | { readonly kind: "exponential"; readonly rate: number };

/** Convenience: build a constant Distribution from a plain number. */
export const constant = (value: number): Distribution => ({ kind: "constant", value });
