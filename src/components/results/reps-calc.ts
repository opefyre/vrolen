/**
 * VROL-844 — required-replications formula extracted into its own module
 * so the React component file can stay export-only-components (avoids the
 * `react-refresh/only-export-components` lint warning).
 *
 * Formula: n* = ceil((z · σ / (d · μ))²)
 * where d = target relative half-width (half-width / mean) and z is the
 * two-sided normal critical value for the chosen confidence level. The
 * normal approx is used (not Student-t) — for *planning* a future run,
 * the textbook answer assumes the asymptotic distribution and avoids a
 * chicken-and-egg dependency on n itself.
 */

/** Confidence level → two-sided normal critical value. */
export const CONFIDENCE_Z: Record<90 | 95 | 99, number> = {
  90: 1.645,
  95: 1.96,
  99: 2.576,
};

export type ConfidenceLevel = 90 | 95 | 99;

/**
 * Required replications to hit a target relative precision on the mean.
 *
 * @param mean Sample mean μ. If ≤ 0, the formula has no meaningful
 *   answer (you cannot hit a *relative* tolerance around zero); we
 *   return null so the caller can render a friendly hint instead of
 *   ∞ or NaN.
 * @param stddev Sample standard deviation σ. If 0, any n ≥ 1 already
 *   hits the target (no variability), so we return 1.
 * @param targetRelHalfWidth Desired half-width-over-mean (e.g. 0.05 for
 *   ±5%). Must be > 0; we return null otherwise.
 * @param confidence Confidence level: 90, 95, or 99.
 */
export function requiredReplications(
  mean: number,
  stddev: number,
  targetRelHalfWidth: number,
  confidence: ConfidenceLevel,
): number | null {
  if (!Number.isFinite(mean) || !Number.isFinite(stddev) || !Number.isFinite(targetRelHalfWidth)) {
    return null;
  }
  if (mean <= 0) return null;
  if (targetRelHalfWidth <= 0) return null;
  if (stddev <= 0) return 1;
  const z = CONFIDENCE_Z[confidence];
  const ratio = (z * stddev) / (targetRelHalfWidth * mean);
  const n = Math.ceil(ratio * ratio);
  return Math.max(1, n);
}
