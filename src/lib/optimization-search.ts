/**
 * Grid-search optimization — Simul8 OptQuest / Arena Process Analyzer light.
 *
 * Sweeps a 2D parameter grid: buffer capacity × cycle-time multiplier on a
 * chosen "target station" (the bottleneck by default). Each cell is run N
 * seeds and averaged so the recommendation isn't a lucky single-replication
 * shot. The candidate with the highest mean throughput wins.
 *
 * Why this is the "killer feature": single-variable opt only answers "what
 * buffer should I pick"; the 2D grid answers "what buffer AND what bottleneck
 * speed-up combo wins", which is what an industrial-engineer audience asks.
 */

import { runChain, SeededPrng, type ChainOptions } from "@/engine";

/**
 * VROL-1060 — replication statistics for one objective on one
 * candidate. Same shape used by every objective so the picker, the
 * tooltip, and the BestSummaryBar share one source of truth.
 *
 * Computation: Bessel-corrected sample stddev × z=1.96 / √n
 * (normal-approx Z). reps=1 → stddev=0, halfWidth=0, low=high=mean.
 */
export interface Stats {
  readonly mean: number;
  readonly stddev: number;
  readonly halfWidth95: number;
  readonly low95: number;
  readonly high95: number;
}

/**
 * VROL-1060 — internal helper. Given a flat array of per-rep samples,
 * computes the Stats shape above.
 */
export function computeStats(samples: readonly number[]): Stats {
  const n = samples.length;
  if (n === 0) {
    return { mean: 0, stddev: 0, halfWidth95: 0, low95: 0, high95: 0 };
  }
  let sum = 0;
  for (const v of samples) sum += v;
  const mean = sum / n;
  if (n < 2) {
    return { mean, stddev: 0, halfWidth95: 0, low95: mean, high95: mean };
  }
  let sqSum = 0;
  for (const v of samples) {
    const d = v - mean;
    sqSum += d * d;
  }
  const stddev = Math.sqrt(sqSum / (n - 1));
  const halfWidth95 = (1.96 * stddev) / Math.sqrt(n);
  return {
    mean,
    stddev,
    halfWidth95,
    low95: mean - halfWidth95,
    high95: mean + halfWidth95,
  };
}

export interface OptimizationCandidate {
  readonly bufferCapacity: number;
  readonly cycleMultiplier: number;
  /**
   * VROL-966 — additive delta applied to every declared tool pool's
   * capacity during this candidate's run. 0 = no change. Use a positive
   * integer to relax pool contention. Defaults to 0 in the cartesian.
   */
  readonly toolPoolDelta: number;
  readonly targetStationIdx: number;
  readonly meanThroughputPerHour: number;
  readonly meanCompleted: number;
  readonly meanTimeInSystemMs: number;
  readonly meanScrapRate: number;
  /**
   * VROL-842 — Line OEE averaged across replications. Sourced from
   * ChainResult.lineOee (already clamped to [0, 1]).
   */
  readonly meanLineOee: number;
  /**
   * VROL-842 — Time-weighted average WIP (parts) across replications.
   * Sourced from ChainResult.averageWipL.
   */
  readonly meanAvgWipL: number;
  /**
   * VROL-842 — Good parts per hour = throughput × quality, where
   * quality = 1 − lineScrapRate. Surfaces the "throughput net of scrap"
   * objective directly so the optimizer doesn't reward a setting that
   * pumps out parts the line then throws away.
   */
  readonly meanGoodPartsPerHour: number;
  readonly replications: number;
  /**
   * VROL-1036 — sustainability cost per candidate. Mean total energy
   * (J) consumed during the run, averaged across replications. Mean
   * intensity (J/part) is derived from energy / completed so the UI
   * can compare candidates on energy footprint and not just
   * throughput. Both are 0 when no station declared sustainability
   * inputs.
   */
  readonly meanTotalEnergyJ: number;
  readonly meanEnergyIntensityJPerPart: number;
  /**
   * VROL-1060 — per-objective replication statistics. Each Stats holds
   * mean + stddev + 95 % half-width + low95 + high95 for that
   * objective. reps=1 → stddev/halfWidth=0; low=high=mean (no CI to
   * report). Replaces the flat throughputStddev/halfWidth/low/high
   * fields added in S1059.
   */
  readonly throughputStats: Stats;
  readonly timeInSystemStats: Stats;
  readonly oeeStats: Stats;
  readonly wipStats: Stats;
  readonly goodPartsStats: Stats;
  /**
   * Energy intensity (J/part) stats. All zeros when no station
   * declared sustainability inputs (intensity = 0 every rep).
   */
  readonly energyIntensityStats: Stats;
}

export interface OptimizationSummary {
  readonly candidates: readonly OptimizationCandidate[];
  readonly best: OptimizationCandidate;
  readonly runnerUp: OptimizationCandidate | null;
  readonly currentCapacity: number;
  readonly targetStationIdx: number;
  readonly targetStationLabel: string;
  readonly bufferLevels: readonly number[];
  readonly cycleMultipliers: readonly number[];
  /** VROL-966 — the tool-pool capacity deltas actually swept. */
  readonly toolPoolDeltas: readonly number[];
  readonly searchSize: number;
  readonly elapsedMs: number;
}

interface RunOptsLike {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly currentCapacity: number;
  readonly targetStationIdx: number;
  readonly targetStationLabel: string;
  /** Build ChainOptions with the target station's cycle distribution scaled. */
  readonly buildBaseOptions: (cycleMultiplier: number) => ChainOptions;
  readonly bufferLevels?: readonly number[];
  readonly cycleMultipliers?: readonly number[];
  /**
   * VROL-966 — additive deltas applied to every declared tool pool's
   * capacity. Defaults to [0] (no sweep). Caller passes [0, 1, 2] to
   * search whether relaxing the pool helps. Cartesian-multiplies the
   * existing cycle × buffer space, so keep arrays small.
   */
  readonly toolPoolDeltas?: readonly number[];
  /** How many seeds to average per (cap, multiplier, delta) cell; default 3. */
  readonly replicationsPerCandidate?: number;
}

const DEFAULT_BUFFER_LEVELS: readonly number[] = [2, 4, 8, 16, 32];
const DEFAULT_CYCLE_MULTIPLIERS: readonly number[] = [0.75, 0.9, 1.0];
const DEFAULT_TOOL_POOL_DELTAS: readonly number[] = [0];

export function runOptimizationSearch(opts: RunOptsLike): OptimizationSummary {
  const t0 = performance.now();
  const levels = opts.bufferLevels ?? DEFAULT_BUFFER_LEVELS;
  const mults = opts.cycleMultipliers ?? DEFAULT_CYCLE_MULTIPLIERS;
  const toolDeltas = opts.toolPoolDeltas ?? DEFAULT_TOOL_POOL_DELTAS;
  const reps = Math.max(1, Math.floor(opts.replicationsPerCandidate ?? 3));
  const candidates: OptimizationCandidate[] = [];
  for (const capacity of levels) {
    for (const mult of mults) {
      for (const toolPoolDelta of toolDeltas) {
        let sumCompleted = 0;
        let sumScrap = 0;
        let sumEnergyJ = 0;
        // VROL-1060 — collect per-rep samples for every metric the
        // OptimizationCard exposes as an objective. Bessel-corrected
        // sample stddev × z=1.96 / √n is applied uniformly.
        const tputSamples: number[] = [];
        const tisSamples: number[] = [];
        const oeeSamples: number[] = [];
        const wipSamples: number[] = [];
        const goodPartsSamples: number[] = [];
        const intensitySamples: number[] = [];
        for (let i = 0; i < reps; i++) {
          const base = opts.buildBaseOptions(mult);
          // VROL-966 — apply toolPoolDelta uniformly to every declared pool.
          const adjustedToolPools = base.toolPools
            ? base.toolPools.map((p) => ({
                ...p,
                capacity: Math.max(1, p.capacity + toolPoolDelta),
              }))
            : base.toolPools;
          const r = runChain({
            ...base,
            ...(adjustedToolPools ? { toolPools: adjustedToolPools } : {}),
            interStationBufferCapacity: capacity,
            horizonMs: opts.horizonMs,
            warmupMs: opts.warmupMs,
            prng: new SeededPrng(opts.seed + i * 31),
          });
          const tputPerHour = r.throughputLambda * 3_600_000;
          tputSamples.push(tputPerHour);
          sumCompleted += r.completed;
          tisSamples.push(r.avgTimeInSystemW);
          sumScrap += r.lineScrapRate;
          oeeSamples.push(r.lineOee);
          wipSamples.push(r.averageWipL);
          // VROL-842 — good parts/hour = throughput × quality, with
          // quality = 1 − lineScrapRate. Computed per-replication so the
          // mean across reps is the mean of the per-rep products, not
          // mean(throughput) × mean(quality) which would over- or
          // under-count when the two correlate inside a single rep.
          goodPartsSamples.push(tputPerHour * (1 - r.lineScrapRate));
          // VROL-1036 — sustainability totals. 0 falls through cleanly
          // for scenarios that never declared inputs.
          sumEnergyJ += r.totalEnergyJ ?? 0;
          intensitySamples.push(r.completed > 0 ? (r.totalEnergyJ ?? 0) / r.completed : 0);
        }
        // VROL-1060 — compute Stats for every objective via the shared
        // helper. Each Stats.mean is the canonical value the
        // OptimizationCard exposes; existing meanXxx fields below alias
        // for back-compat with code that already reads them.
        const throughputStats = computeStats(tputSamples);
        const timeInSystemStats = computeStats(tisSamples);
        const oeeStats = computeStats(oeeSamples);
        const wipStats = computeStats(wipSamples);
        const goodPartsStats = computeStats(goodPartsSamples);
        const energyIntensityStats = computeStats(intensitySamples);
        candidates.push({
          bufferCapacity: capacity,
          cycleMultiplier: mult,
          toolPoolDelta,
          targetStationIdx: opts.targetStationIdx,
          meanThroughputPerHour: throughputStats.mean,
          meanCompleted: sumCompleted / reps,
          meanTimeInSystemMs: timeInSystemStats.mean,
          meanScrapRate: sumScrap / reps,
          meanLineOee: oeeStats.mean,
          meanAvgWipL: wipStats.mean,
          meanGoodPartsPerHour: goodPartsStats.mean,
          replications: reps,
          meanTotalEnergyJ: sumEnergyJ / reps,
          meanEnergyIntensityJPerPart: energyIntensityStats.mean,
          throughputStats,
          timeInSystemStats,
          oeeStats,
          wipStats,
          goodPartsStats,
          energyIntensityStats,
        });
      }
    }
  }
  const sorted = [...candidates].sort((a, b) => b.meanThroughputPerHour - a.meanThroughputPerHour);
  const best = sorted[0]!;
  const runnerUp = sorted[1] ?? null;
  return {
    candidates,
    best,
    runnerUp,
    currentCapacity: opts.currentCapacity,
    targetStationIdx: opts.targetStationIdx,
    targetStationLabel: opts.targetStationLabel,
    bufferLevels: levels,
    cycleMultipliers: mults,
    toolPoolDeltas: toolDeltas,
    searchSize: levels.length * mults.length * toolDeltas.length * reps,
    elapsedMs: performance.now() - t0,
  };
}
