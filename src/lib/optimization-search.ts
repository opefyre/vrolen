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
   * VROL-1059 — sample stddev of throughputPerHour across
   * replications (Bessel-corrected). 0 when reps < 2.
   */
  readonly throughputStddev: number;
  /**
   * VROL-1059 — half-width of the 95% confidence interval on mean
   * throughput, computed as 1.96 × s / √n (normal-approx z). 0 when
   * reps < 2. Same formula as the line-OEE replications card.
   */
  readonly throughputHalfWidth95: number;
  /** VROL-1059 — meanThroughputPerHour − halfWidth (or = mean when reps=1). */
  readonly throughputLow95: number;
  /** VROL-1059 — meanThroughputPerHour + halfWidth (or = mean when reps=1). */
  readonly throughputHigh95: number;
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
        let sumTput = 0;
        let sumCompleted = 0;
        let sumTisys = 0;
        let sumScrap = 0;
        let sumOee = 0;
        let sumWipL = 0;
        let sumGoodPerHour = 0;
        let sumEnergyJ = 0;
        let sumIntensity = 0;
        // VROL-1059 — collect per-rep throughputPerHour so we can
        // compute Bessel-corrected sample stddev + 95 % half-width.
        const tputSamples: number[] = [];
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
          sumTput += tputPerHour;
          sumCompleted += r.completed;
          sumTisys += r.avgTimeInSystemW;
          sumScrap += r.lineScrapRate;
          sumOee += r.lineOee;
          sumWipL += r.averageWipL;
          // VROL-842 — good parts/hour = throughput × quality, with
          // quality = 1 − lineScrapRate. Computed per-replication so the
          // mean across reps is the mean of the per-rep products, not
          // mean(throughput) × mean(quality) which would over- or
          // under-count when the two correlate inside a single rep.
          sumGoodPerHour += tputPerHour * (1 - r.lineScrapRate);
          // VROL-1036 — sustainability totals. 0 falls through cleanly
          // for scenarios that never declared inputs.
          sumEnergyJ += r.totalEnergyJ ?? 0;
          sumIntensity += r.completed > 0 ? (r.totalEnergyJ ?? 0) / r.completed : 0;
        }
        // VROL-1059 — sample stddev + 95 % half-width on throughput.
        // Single-rep run → no variance estimate; expose 0 + low=high=mean.
        const meanTput = sumTput / reps;
        let throughputStddev = 0;
        let throughputHalfWidth95 = 0;
        if (reps > 1) {
          let variance = 0;
          for (const t of tputSamples) {
            const d = t - meanTput;
            variance += d * d;
          }
          variance /= reps - 1; // Bessel-corrected.
          throughputStddev = Math.sqrt(variance);
          throughputHalfWidth95 = (1.96 * throughputStddev) / Math.sqrt(reps);
        }
        candidates.push({
          bufferCapacity: capacity,
          cycleMultiplier: mult,
          toolPoolDelta,
          targetStationIdx: opts.targetStationIdx,
          meanThroughputPerHour: meanTput,
          meanCompleted: sumCompleted / reps,
          meanTimeInSystemMs: sumTisys / reps,
          meanScrapRate: sumScrap / reps,
          meanLineOee: sumOee / reps,
          meanAvgWipL: sumWipL / reps,
          meanGoodPartsPerHour: sumGoodPerHour / reps,
          replications: reps,
          meanTotalEnergyJ: sumEnergyJ / reps,
          meanEnergyIntensityJPerPart: sumIntensity / reps,
          throughputStddev,
          throughputHalfWidth95,
          throughputLow95: meanTput - throughputHalfWidth95,
          throughputHigh95: meanTput + throughputHalfWidth95,
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
