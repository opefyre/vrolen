/**
 * Input Analyzer — fit candidate distributions to a numeric dataset
 * (e.g. measured cycle times from the user's real factory) and rank
 * them by Kolmogorov-Smirnov goodness-of-fit.
 *
 * Mirrors Arena's Input Analyzer in spirit. Pure deterministic — given
 * the same input, always returns the same fits + statistics.
 *
 * Fitting methods:
 *   - Normal:       MLE (mean, stddev with n divisor)
 *   - Lognormal:    MLE on log(X) (positive values only)
 *   - Exponential:  MLE (rate = 1 / mean)
 *   - Weibull:      Newton-Raphson on the MLE shape equation
 *   - Gamma:        Method-of-moments (shape = mean² / var, scale = var / mean)
 *
 * Goodness of fit:
 *   - Kolmogorov-Smirnov D statistic — max distance between empirical CDF
 *     and theoretical CDF. Lower = better. Always in [0, 1].
 */

import type { Distribution } from "@/engine";

export interface FitCandidate {
  readonly distribution: Distribution;
  readonly distributionKind: "normal" | "lognormal" | "exponential" | "weibull" | "gamma";
  /** Display label such as "Lognormal(μ=4.5, σ=0.3)". */
  readonly label: string;
  /** Kolmogorov-Smirnov D statistic against the empirical CDF. */
  readonly ksStatistic: number;
  /** Critical D at α=0.05 (Lillilefors approximation: 1.36 / √n). */
  readonly ksCritical: number;
  /** Whether ks <= critical → fit is consistent with the data. */
  readonly pass: boolean;
}

export interface FitSummary {
  readonly n: number;
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
  readonly candidates: readonly FitCandidate[];
  /** Lowest-KS candidate. */
  readonly best: FitCandidate | null;
}

/**
 * Parse a free-form dataset string into an array of finite numbers.
 * Accepts commas, newlines, tabs, semicolons, whitespace. Drops blanks
 * and NaN tokens. The CSV header (if any) is skipped automatically when
 * the first row has no parseable numbers.
 */
export function parseDataset(raw: string): number[] {
  if (!raw) return [];
  const tokens = raw
    .split(/[,;\s\n\r\t]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const values: number[] = [];
  for (const t of tokens) {
    const n = Number(t);
    if (Number.isFinite(n)) values.push(n);
  }
  return values;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}
function variance(values: readonly number[], m: number): number {
  if (values.length < 2) return 0;
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return s / (values.length - 1);
}

/** Sort ascending, returns new array. */
function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Normal CDF via the Abramowitz-Stegun approximation. */
function normalCdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return x < mu ? 0 : 1;
  const z = (x - mu) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

/** Error function via Abramowitz-Stegun 7.1.26. Max error ~1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function lognormalCdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  return normalCdf(Math.log(x), mu, sigma);
}
function exponentialCdf(x: number, rate: number): number {
  if (x <= 0) return 0;
  return 1 - Math.exp(-rate * x);
}
function weibullCdf(x: number, shape: number, scale: number): number {
  if (x <= 0 || shape <= 0 || scale <= 0) return 0;
  return 1 - Math.exp(-Math.pow(x / scale, shape));
}
/**
 * Gamma CDF via the regularised lower incomplete gamma function P(s, x),
 * computed by series expansion for x < s+1 and continued fraction
 * otherwise. Numerical Recipes 6.2 style.
 */
function gammaCdf(x: number, shape: number, scale: number): number {
  if (x <= 0 || shape <= 0 || scale <= 0) return 0;
  return lowerIncompleteGammaP(shape, x / scale);
}

function lnGamma(z: number): number {
  // Lanczos coefficients (g=7).
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = p[0]!;
  for (let i = 1; i < 9; i++) x += p[i]! / (z + i);
  const t = z + 7 + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function lowerIncompleteGammaP(a: number, x: number): number {
  if (x === 0) return 0;
  const lnGa = lnGamma(a);
  if (x < a + 1) {
    // Series.
    let ap = a;
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 200; n++) {
      ap += 1;
      term *= x / ap;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGa);
  }
  // Continued fraction.
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGa) * h;
}

function ksStatistic(sortedValues: readonly number[], cdf: (x: number) => number): number {
  const n = sortedValues.length;
  if (n === 0) return Infinity;
  let dMax = 0;
  for (let i = 0; i < n; i++) {
    const empAbove = (i + 1) / n;
    const empBelow = i / n;
    const theory = cdf(sortedValues[i]!);
    const d = Math.max(Math.abs(empAbove - theory), Math.abs(empBelow - theory));
    if (d > dMax) dMax = d;
  }
  return dMax;
}

/**
 * Fit Weibull shape via Newton-Raphson on the MLE equation. Returns the
 * shape parameter; scale is then derived from the closed-form. Capped at
 * a few iterations — Weibull MLE converges quadratically.
 */
function fitWeibull(values: readonly number[]): { shape: number; scale: number } | null {
  const n = values.length;
  if (n === 0) return null;
  // Initial guess: method-of-moments style.
  let shape = 1.2;
  for (let iter = 0; iter < 25; iter++) {
    let sumLogs = 0;
    let sumXk = 0;
    let sumXkLogs = 0;
    let sumXkLogs2 = 0;
    for (const x of values) {
      const lx = Math.log(x);
      const xk = Math.pow(x, shape);
      sumLogs += lx;
      sumXk += xk;
      sumXkLogs += xk * lx;
      sumXkLogs2 += xk * lx * lx;
    }
    const meanLogs = sumLogs / n;
    const f = 1 / shape + meanLogs - sumXkLogs / sumXk;
    const fp =
      -1 / (shape * shape) - (sumXkLogs2 / sumXk - (sumXkLogs * sumXkLogs) / (sumXk * sumXk));
    const next = shape - f / fp;
    if (!Number.isFinite(next) || next <= 0) return null;
    if (Math.abs(next - shape) < 1e-7) {
      shape = next;
      break;
    }
    shape = next;
  }
  let sumXk = 0;
  for (const x of values) sumXk += Math.pow(x, shape);
  const scale = Math.pow(sumXk / n, 1 / shape);
  if (!Number.isFinite(shape) || !Number.isFinite(scale) || shape <= 0 || scale <= 0) {
    return null;
  }
  return { shape, scale };
}

/**
 * Fit four candidate distributions to the dataset and rank by KS.
 * Drops candidates that aren't applicable (e.g. Lognormal on a dataset
 * with non-positive values).
 */
export function fitDistributions(rawValues: readonly number[]): FitSummary | null {
  if (rawValues.length < 5) return null;
  const allValues = rawValues.filter((v) => Number.isFinite(v));
  if (allValues.length < 5) return null;
  const m = mean(allValues);
  const variance_ = variance(allValues, m);
  const stddev = Math.sqrt(Math.max(0, variance_));
  const sortedAll = sorted(allValues);
  const minVal = sortedAll[0]!;
  const maxVal = sortedAll[sortedAll.length - 1]!;
  const n = allValues.length;
  const ksCritical = 1.36 / Math.sqrt(n);
  const candidates: FitCandidate[] = [];

  // Normal — always applicable.
  if (stddev > 0) {
    const ks = ksStatistic(sortedAll, (x) => normalCdf(x, m, stddev));
    candidates.push({
      distribution: { kind: "normal", mean: m, stddev },
      distributionKind: "normal",
      label: `Normal(μ=${m.toFixed(2)}, σ=${stddev.toFixed(2)})`,
      ksStatistic: ks,
      ksCritical,
      pass: ks <= ksCritical,
    });
  }

  const positiveValues = allValues.filter((v) => v > 0);
  if (positiveValues.length >= 5) {
    const sortedPos = sorted(positiveValues);
    const nPos = positiveValues.length;
    const ksCriticalPos = 1.36 / Math.sqrt(nPos);
    // Lognormal.
    const logValues = positiveValues.map((v) => Math.log(v));
    const muL = mean(logValues);
    const sigmaL = Math.sqrt(Math.max(0, variance(logValues, muL)));
    if (sigmaL > 0) {
      const ks = ksStatistic(sortedPos, (x) => lognormalCdf(x, muL, sigmaL));
      candidates.push({
        distribution: { kind: "lognormal", mu: muL, sigma: sigmaL },
        distributionKind: "lognormal",
        label: `Lognormal(μ=${muL.toFixed(2)}, σ=${sigmaL.toFixed(2)})`,
        ksStatistic: ks,
        ksCritical: ksCriticalPos,
        pass: ks <= ksCriticalPos,
      });
    }
    // Exponential.
    const meanPos = mean(positiveValues);
    if (meanPos > 0) {
      const rate = 1 / meanPos;
      const ks = ksStatistic(sortedPos, (x) => exponentialCdf(x, rate));
      candidates.push({
        distribution: { kind: "exponential", rate },
        distributionKind: "exponential",
        label: `Exponential(rate=${rate.toFixed(4)})`,
        ksStatistic: ks,
        ksCritical: ksCriticalPos,
        pass: ks <= ksCriticalPos,
      });
    }
    // Weibull.
    const weibull = fitWeibull(positiveValues);
    if (weibull) {
      const ks = ksStatistic(sortedPos, (x) => weibullCdf(x, weibull.shape, weibull.scale));
      candidates.push({
        distribution: { kind: "weibull", shape: weibull.shape, scale: weibull.scale },
        distributionKind: "weibull",
        label: `Weibull(shape=${weibull.shape.toFixed(2)}, scale=${weibull.scale.toFixed(2)})`,
        ksStatistic: ks,
        ksCritical: ksCriticalPos,
        pass: ks <= ksCriticalPos,
      });
    }
    // Gamma (method of moments).
    if (variance_ > 0) {
      const shape = (meanPos * meanPos) / variance_;
      const scale = variance_ / meanPos;
      if (shape > 0 && scale > 0) {
        const ks = ksStatistic(sortedPos, (x) => gammaCdf(x, shape, scale));
        candidates.push({
          distribution: { kind: "gamma", shape, scale },
          distributionKind: "gamma",
          label: `Gamma(shape=${shape.toFixed(2)}, scale=${scale.toFixed(2)})`,
          ksStatistic: ks,
          ksCritical: ksCriticalPos,
          pass: ks <= ksCriticalPos,
        });
      }
    }
  }

  candidates.sort((a, b) => a.ksStatistic - b.ksStatistic);
  return {
    n,
    mean: m,
    stddev,
    min: minVal,
    max: maxVal,
    candidates,
    best: candidates[0] ?? null,
  };
}
