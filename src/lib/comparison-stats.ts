/**
 * Two-sample paired-t comparison — the runner-up audit recommendation.
 *
 * Given two equal-length arrays of per-replication observations (e.g.
 * throughput from rep 1..N of scenario A and rep 1..N of scenario B
 * with the SAME seeds — Common Random Numbers), compute the difference
 * vector D_i = B_i - A_i and report mean ± 95 % paired-t CI half-width.
 *
 * Paired beats independent-samples because CRN removes nuisance variance
 * (every seed sees both scenarios) — the same statistical power with far
 * fewer replications.
 */

const T_TABLE: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
};
const Z_95 = 1.96;

function tCritical(df: number): number {
  if (df <= 0) return Infinity;
  if (df >= 30) return Z_95;
  return T_TABLE[df] ?? Z_95;
}

export interface PairedComparisonResult {
  /** Pair count (same as both input arrays' length). */
  readonly n: number;
  /** Mean of the per-pair difference (b - a). */
  readonly meanDelta: number;
  /** Sample stddev of the differences. */
  readonly stddevDelta: number;
  /** 95% CI half-width = t · stddev / √n. */
  readonly halfWidth95: number;
  /** Mean ± half-width bounds. */
  readonly low95: number;
  readonly high95: number;
  /** Statistically distinguishable from zero at α=0.05. */
  readonly significant: boolean;
  /** Crude effect-size proxy: meanDelta / stddev(differences). */
  readonly cohensDz: number;
}

export function pairedTConfidence(
  a: readonly number[],
  b: readonly number[],
): PairedComparisonResult | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push((b[i] ?? 0) - (a[i] ?? 0));
  const mean = diffs.reduce((s, v) => s + v, 0) / n;
  const variance = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, n - 1);
  const stddev = Math.sqrt(variance);
  const halfWidth = (tCritical(n - 1) * stddev) / Math.sqrt(n);
  const significant = Math.abs(mean) > halfWidth;
  const cohensDz = stddev > 0 ? mean / stddev : 0;
  return {
    n,
    meanDelta: mean,
    stddevDelta: stddev,
    halfWidth95: halfWidth,
    low95: mean - halfWidth,
    high95: mean + halfWidth,
    significant,
    cohensDz,
  };
}
