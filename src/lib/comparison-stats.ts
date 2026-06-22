/**
 * Two-sample t-comparisons — paired (CRN) + Welch (independent).
 *
 * Paired-t (VROL-722, audit follow-up): given two equal-length arrays of
 * per-replication observations (e.g. throughput from rep 1..N of scenario
 * A and rep 1..N of scenario B with the SAME seeds — Common Random
 * Numbers), compute the difference vector D_i = B_i - A_i and report
 * mean ± 95 % paired-t CI half-width. Paired beats independent-samples
 * because CRN removes nuisance variance — same statistical power with
 * far fewer replications.
 *
 * Welch-t (VROL-850): when the two samples come from runs with DIFFERENT
 * seed lists, treat them as independent. Welch uses unequal variances
 * and the Welch–Satterthwaite df approximation. Less powerful than
 * paired but appropriate when the seeds don't line up.
 *
 * Both helpers report a two-sided p-value via a tail approximation that
 * leans on the well-behaved abs(t)→p map for the symmetric t distribution.
 * Math: t = meanDelta / SE; for large df the tail collapses to a normal,
 * for small df we adjust using an interpolation through the t-table.
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

/**
 * Two-sided p-value approximation for a t-statistic with the given df.
 *
 * For df ≥ 30 we fall back to the standard-normal survival function via
 * Abramowitz & Stegun 26.2.17 — a 5-decimal approximation that's plenty
 * for displaying "p = 0.034" next to a CI. For 1 ≤ df < 30 we squeeze
 * the same normal tail outward using the ratio t_crit(df) / 1.96 — a
 * crude but monotonic correction that preserves ordering at the α=0.05
 * boundary (i.e. the displayed p stays consistent with the existing
 * "significant" flag from CI inclusion of zero).
 */
function twoSidedTPValue(tStat: number, df: number): number {
  if (!Number.isFinite(tStat)) return 0;
  if (df <= 0) return 1;
  const absT = Math.abs(tStat);
  // For df ≥ 30 the t distribution is indistinguishable from normal at
  // chart resolution. Use Abramowitz & Stegun's polynomial approximation
  // for the standard-normal CDF Φ(x) — error < 7.5e-8 across all x.
  const normalTail = (x: number): number => {
    const sign = x < 0 ? -1 : 1;
    const xAbs = Math.abs(x) / Math.SQRT2;
    // erf approx
    const t = 1 / (1 + 0.3275911 * xAbs);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-xAbs * xAbs);
    const erf = sign * y;
    return 0.5 * (1 - erf);
  };
  const normalP = 2 * normalTail(absT);
  if (df >= 30) return Math.min(1, Math.max(0, normalP));
  // Small-df correction: shrink absT by the inflation factor t_crit / 1.96.
  // This stretches the tail outward (higher p for the same t when df is
  // small), matching the qualitative t→normal limit.
  const inflate = tCritical(df) / Z_95;
  const scaled = absT / inflate;
  const adjusted = 2 * normalTail(scaled);
  return Math.min(1, Math.max(0, adjusted));
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
  /** Two-sided p-value of the difference. */
  readonly pValue: number;
  /** Which test produced this result — for UX disclosure. */
  readonly test: "paired" | "welch";
}

export function pairedTConfidence(
  a: readonly number[],
  b: readonly number[],
): PairedComparisonResult | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  // VROL-850 — t-statistic derivation:
  //   d_i  = b_i − a_i
  //   mean = (1/n) Σ d_i
  //   sd   = sqrt(Σ (d_i − mean)² / (n − 1))
  //   t    = mean / (sd / √n), df = n − 1
  // The half-width 95 % CI is t_crit · sd / √n. Significance ⇔ |t| > t_crit
  // which is equivalent to "the CI excludes zero".
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push((b[i] ?? 0) - (a[i] ?? 0));
  const mean = diffs.reduce((s, v) => s + v, 0) / n;
  const variance = diffs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, n - 1);
  const stddev = Math.sqrt(variance);
  const se = stddev / Math.sqrt(n);
  const halfWidth = tCritical(n - 1) * se;
  const significant = Math.abs(mean) > halfWidth;
  const cohensDz = stddev > 0 ? mean / stddev : 0;
  const tStat = se > 0 ? mean / se : 0;
  const pValue = twoSidedTPValue(tStat, n - 1);
  return {
    n,
    meanDelta: mean,
    stddevDelta: stddev,
    halfWidth95: halfWidth,
    low95: mean - halfWidth,
    high95: mean + halfWidth,
    significant,
    cohensDz,
    pValue,
    test: "paired",
  };
}

/**
 * Welch's t-test — two independent samples with possibly unequal
 * variances. Computes the same shape of result as pairedTConfidence so
 * the UI can swap between them transparently.
 *
 * SE_W = √(s_a² / n_a + s_b² / n_b)
 * df   = (s_a² / n_a + s_b² / n_b)² / ((s_a²/n_a)² / (n_a−1) + (s_b²/n_b)² / (n_b−1))
 * t    = (mean_b − mean_a) / SE_W
 */
export function welchTConfidence(
  a: readonly number[],
  b: readonly number[],
): PairedComparisonResult | null {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return null;
  const meanA = a.reduce((s, v) => s + v, 0) / na;
  const meanB = b.reduce((s, v) => s + v, 0) / nb;
  const varA = a.reduce((s, v) => s + (v - meanA) * (v - meanA), 0) / (na - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) * (v - meanB), 0) / (nb - 1);
  const meanDelta = meanB - meanA;
  const seSquared = varA / na + varB / nb;
  const se = Math.sqrt(seSquared);
  // Welch–Satterthwaite df approximation; guard the degenerate zero-var case.
  const numerator = seSquared * seSquared;
  const denom = (varA / na) ** 2 / Math.max(1, na - 1) + (varB / nb) ** 2 / Math.max(1, nb - 1);
  const dfRaw = denom > 0 ? numerator / denom : Math.min(na, nb) - 1;
  const df = Math.max(1, Math.floor(dfRaw));
  const halfWidth = tCritical(df) * se;
  const significant = Math.abs(meanDelta) > halfWidth;
  // Pooled stddev for the effect-size denominator (matches Cohen's d for
  // independent samples — not d_z).
  const pooledStd = Math.sqrt((varA + varB) / 2);
  const cohensD = pooledStd > 0 ? meanDelta / pooledStd : 0;
  const tStat = se > 0 ? meanDelta / se : 0;
  const pValue = twoSidedTPValue(tStat, df);
  return {
    n: Math.min(na, nb),
    meanDelta,
    // For UI parity we report a "stddev of the gap" — the Welch SE × √n
    // collapses to the same units the paired result uses.
    stddevDelta: se * Math.sqrt(Math.min(na, nb)),
    halfWidth95: halfWidth,
    low95: meanDelta - halfWidth,
    high95: meanDelta + halfWidth,
    significant,
    cohensDz: cohensD,
    pValue,
    test: "welch",
  };
}
