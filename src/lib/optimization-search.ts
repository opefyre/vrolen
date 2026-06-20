/**
 * Grid-search optimization — Simul8 OptQuest / Arena Process Analyzer light.
 *
 * Sweeps a small parameter grid (buffer capacity × seed permutations),
 * runs the engine at each, and reports the combo that maximizes the
 * objective (throughput by default). Per-combo we average over a few
 * seeds so the recommendation isn't a lucky single-replication shot.
 *
 * Why this is the "killer feature" in commercial DES tools: it converts
 * the simulation from "what if" into "best of". A buyer can ask 'find me
 * the buffer size that maximizes hourly output' and get an answer with
 * supporting numbers.
 */

import { runChain, SeededPrng, type ChainOptions } from "@/engine";

export interface OptimizationCandidate {
  readonly bufferCapacity: number;
  readonly meanThroughputPerHour: number;
  readonly meanCompleted: number;
  readonly meanTimeInSystemMs: number;
  readonly meanScrapRate: number;
  readonly replications: number;
}

export interface OptimizationSummary {
  readonly candidates: readonly OptimizationCandidate[];
  readonly best: OptimizationCandidate;
  readonly runnerUp: OptimizationCandidate | null;
  readonly currentCapacity: number;
  readonly searchSize: number;
  readonly elapsedMs: number;
}

interface RunOptsLike {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly currentCapacity: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly bufferLevels?: readonly number[];
  /** How many seeds to average per candidate; default 3 for stable means. */
  readonly replicationsPerCandidate?: number;
}

const DEFAULT_BUFFER_LEVELS: readonly number[] = [1, 2, 4, 8, 16, 32, 64];

/**
 * Run the optimization search. For each buffer level, run N replications
 * (different seeds) and average. The candidate with the highest mean
 * throughput wins.
 */
export function runOptimizationSearch(opts: RunOptsLike): OptimizationSummary {
  const t0 = performance.now();
  const levels = opts.bufferLevels ?? DEFAULT_BUFFER_LEVELS;
  const reps = Math.max(1, Math.floor(opts.replicationsPerCandidate ?? 3));
  const candidates: OptimizationCandidate[] = [];
  for (const capacity of levels) {
    let sumTput = 0;
    let sumCompleted = 0;
    let sumTisys = 0;
    let sumScrap = 0;
    for (let i = 0; i < reps; i++) {
      const base = opts.buildBaseOptions();
      const r = runChain({
        ...base,
        interStationBufferCapacity: capacity,
        horizonMs: opts.horizonMs,
        warmupMs: opts.warmupMs,
        prng: new SeededPrng(opts.seed + i * 31),
      });
      sumTput += r.throughputLambda * 3_600_000;
      sumCompleted += r.completed;
      sumTisys += r.avgTimeInSystemW;
      sumScrap += r.lineScrapRate;
    }
    candidates.push({
      bufferCapacity: capacity,
      meanThroughputPerHour: sumTput / reps,
      meanCompleted: sumCompleted / reps,
      meanTimeInSystemMs: sumTisys / reps,
      meanScrapRate: sumScrap / reps,
      replications: reps,
    });
  }
  const sorted = [...candidates].sort((a, b) => b.meanThroughputPerHour - a.meanThroughputPerHour);
  const best = sorted[0]!;
  const runnerUp = sorted[1] ?? null;
  return {
    candidates,
    best,
    runnerUp,
    currentCapacity: opts.currentCapacity,
    searchSize: levels.length * reps,
    elapsedMs: performance.now() - t0,
  };
}
