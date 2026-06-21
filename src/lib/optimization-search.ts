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
  readonly targetStationIdx: number;
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
  readonly targetStationIdx: number;
  readonly targetStationLabel: string;
  readonly bufferLevels: readonly number[];
  readonly cycleMultipliers: readonly number[];
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
  /** How many seeds to average per (cap, multiplier) cell; default 3. */
  readonly replicationsPerCandidate?: number;
}

const DEFAULT_BUFFER_LEVELS: readonly number[] = [2, 4, 8, 16, 32];
const DEFAULT_CYCLE_MULTIPLIERS: readonly number[] = [0.75, 0.9, 1.0];

export function runOptimizationSearch(opts: RunOptsLike): OptimizationSummary {
  const t0 = performance.now();
  const levels = opts.bufferLevels ?? DEFAULT_BUFFER_LEVELS;
  const mults = opts.cycleMultipliers ?? DEFAULT_CYCLE_MULTIPLIERS;
  const reps = Math.max(1, Math.floor(opts.replicationsPerCandidate ?? 3));
  const candidates: OptimizationCandidate[] = [];
  for (const capacity of levels) {
    for (const mult of mults) {
      let sumTput = 0;
      let sumCompleted = 0;
      let sumTisys = 0;
      let sumScrap = 0;
      for (let i = 0; i < reps; i++) {
        const base = opts.buildBaseOptions(mult);
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
        cycleMultiplier: mult,
        targetStationIdx: opts.targetStationIdx,
        meanThroughputPerHour: sumTput / reps,
        meanCompleted: sumCompleted / reps,
        meanTimeInSystemMs: sumTisys / reps,
        meanScrapRate: sumScrap / reps,
        replications: reps,
      });
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
    searchSize: levels.length * mults.length * reps,
    elapsedMs: performance.now() - t0,
  };
}
