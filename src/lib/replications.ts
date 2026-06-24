/**
 * Multi-replication statistics — the feature that separates a credible
 * DES tool from a toy. Run the same scenario N times with different
 * PRNG seeds, aggregate per-KPI mean ± 95% confidence interval.
 *
 * Reference: Banks et al., "Discrete-Event System Simulation" Ch. 12;
 * Arena uses the same t-distribution half-width on every reported KPI.
 *
 * VROL-850 — `seeds: number[]` now ride along on the summary so the
 * Replications card can decide between a paired t-test (matched seeds)
 * vs a Welch t-test (independent samples) when comparing to a baseline.
 */

import type { ChainResult } from "@/engine";

export interface ReplicationKpi {
  /** Display label for the KPI ("Throughput (parts/h)"). */
  readonly label: string;
  /** Raw per-replication observations. */
  readonly values: readonly number[];
  /** Sample mean. */
  readonly mean: number;
  /** Sample standard deviation (n-1 divisor). */
  readonly stddev: number;
  /** 95 % CI half-width (t · stddev / √n). */
  readonly halfWidth95: number;
  /** Lower / upper 95 % bound. */
  readonly low95: number;
  readonly high95: number;
  /** Formatter so callers don't re-derive units. */
  readonly format: (n: number) => string;
}

export interface PerStationCi {
  readonly idx: number;
  readonly label: string;
  /** Mean OEE (0..1) across replications. */
  readonly meanOee: number;
  /** 95 % half-width on OEE (same scale as meanOee). */
  readonly halfWidth95Oee: number;
  /** Component means for the breakdown UI. */
  readonly meanAvailability: number;
  readonly meanPerformance: number;
  readonly meanQuality: number;
  readonly halfWidth95Availability: number;
  readonly halfWidth95Performance: number;
  readonly halfWidth95Quality: number;
}

export interface ReplicationSummary {
  /** How many replications were averaged. */
  readonly n: number;
  /**
   * PRNG seed used for each replication, aligned 1:1 with each KPI's
   * `values` array. Lets the consumer decide paired vs independent stats.
   */
  readonly seeds: readonly number[];
  readonly kpis: readonly ReplicationKpi[];
  /**
   * VROL-936 — per-station OEE means + CIs across replications. Aligned
   * with result.perStationOee by index of the first replication. Empty
   * when n < 2 or perStationOee shape differs across replications.
   */
  readonly perStation: readonly PerStationCi[];
}

// Two-sided 95 % t-critical values, by degrees of freedom.
// df = n - 1. We use 1.96 for df ≥ 30 (large-sample normal approx).
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

function tCritical(df: number): number {
  if (df <= 0) return Infinity;
  if (df >= 30) return 1.96;
  return T_TABLE[df] ?? 1.96;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sq = values.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(sq / (values.length - 1));
}

function buildKpi(
  label: string,
  values: readonly number[],
  format: (n: number) => string,
): ReplicationKpi {
  const m = mean(values);
  const s = stddev(values);
  const t = tCritical(values.length - 1);
  const halfWidth = values.length > 0 ? (t * s) / Math.sqrt(values.length) : 0;
  return {
    label,
    values,
    mean: m,
    stddev: s,
    halfWidth95: halfWidth,
    low95: m - halfWidth,
    high95: m + halfWidth,
    format,
  };
}

/**
 * Summarise a batch of replications. The first replication is treated as
 * canonical for the canvas/playback layers; this function only crunches
 * cross-replication stats for the UI to display.
 *
 * `seeds` MUST be aligned 1:1 with `results`. If callers omit it (legacy
 * path), we fall back to indices so paired-vs-Welch flip still works
 * deterministically (each entry is unique).
 */
export function summarizeReplications(
  results: readonly ChainResult[],
  seeds?: readonly number[],
): ReplicationSummary {
  const n = results.length;
  const completed = results.map((r) => r.completed);
  const throughputPerHr = results.map((r) => r.throughputLambda * 3_600_000);
  const oee = results.map((r) => r.lineOee * 100);
  const tisys = results.map((r) => r.avgTimeInSystemW);
  const scrap = results.map((r) => r.lineScrapRate * 100);
  const intFmt = (x: number) => Math.round(x).toLocaleString();
  const ms = (x: number) => `${Math.round(x).toLocaleString()} ms`;
  const pct = (x: number) => `${x.toFixed(1)}%`;
  const perHr = (x: number) => `${Math.round(x).toLocaleString()} /h`;
  const seedList: readonly number[] =
    seeds && seeds.length === n ? [...seeds] : Array.from({ length: n }, (_, i) => i);

  // VROL-936 — per-station OEE means + CIs. Aligned by index against the
  // first replication's perStationOee. Bail to [] when any replication has
  // a different per-station-count (shouldn't happen with the same scenario,
  // defensive against drift).
  const perStation: PerStationCi[] = [];
  if (n > 0 && results[0]) {
    const m = results[0].perStationOee.length;
    const shapesAlign = results.every((r) => r.perStationOee.length === m);
    if (shapesAlign && m > 0) {
      const labels = results[0].perStationLabels ?? [];
      for (let s = 0; s < m; s++) {
        const oeeVals = results.map((r) => r.perStationOee[s]?.oee ?? 0);
        const aVals = results.map((r) => r.perStationOee[s]?.availability ?? 0);
        const pVals = results.map((r) => r.perStationOee[s]?.performance ?? 0);
        const qVals = results.map((r) => r.perStationOee[s]?.quality ?? 0);
        const halfFor = (vs: readonly number[]) => {
          const sd = stddev(vs);
          const t = tCritical(vs.length - 1);
          return vs.length > 0 ? (t * sd) / Math.sqrt(vs.length) : 0;
        };
        perStation.push({
          idx: s,
          label: labels[s] ?? `Station ${String(s)}`,
          meanOee: mean(oeeVals),
          halfWidth95Oee: halfFor(oeeVals),
          meanAvailability: mean(aVals),
          meanPerformance: mean(pVals),
          meanQuality: mean(qVals),
          halfWidth95Availability: halfFor(aVals),
          halfWidth95Performance: halfFor(pVals),
          halfWidth95Quality: halfFor(qVals),
        });
      }
    }
  }
  return {
    n,
    seeds: seedList,
    kpis: [
      buildKpi("Completed", completed, intFmt),
      buildKpi("Throughput", throughputPerHr, perHr),
      buildKpi("Line efficiency", oee, pct),
      buildKpi("Time-in-system", tisys, ms),
      buildKpi("Scrap rate", scrap, pct),
    ],
    perStation,
  };
}

/**
 * Coefficient of variation for the throughput KPI — useful as a quick
 * "is this scenario noisy enough to warrant more reps?" signal.
 */
export function noisinessSignal(summary: ReplicationSummary): number {
  const throughput = summary.kpis.find((k) => k.label === "Throughput");
  if (!throughput) return 0;
  if (throughput.mean === 0) return 0;
  return throughput.stddev / throughput.mean;
}

/**
 * VROL-850 — does the seed list on each side match exactly (same values
 * in the same order)? Used by the Replications card to pick paired-t by
 * default when both runs used the same seeds (CRN), Welch otherwise.
 */
export function seedsMatch(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  if (a.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
