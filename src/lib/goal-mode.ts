/**
 * VROL-954 — throughput goal-seek.
 *
 * Given a target throughput (parts/h) and a way to run the engine,
 * binary-searches the smallest cycle-time multiplier (0.5x–1.0x of the
 * baseline) that meets the target. Returns the multiplier, the achieved
 * throughput, and a "cost" proxy = abs(1 - multiplier) so the UI can
 * rank candidates.
 *
 * No engine surgery — the search reuses the same per-station cycle
 * scaling that sensitivity-sweep uses, so behaviour stays consistent.
 */

import { runChain, SeededPrng, type ChainOptions, type Distribution } from "@/engine";
import { scaleDistribution } from "./scale-distribution";

interface GoalOpts {
  readonly targetPerHour: number;
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly stationCycleDistributions: readonly Distribution[];
}

export interface GoalResult {
  /** Cycle-time multiplier applied uniformly to every station's distribution. */
  readonly multiplier: number;
  readonly achievedPerHour: number;
  readonly baselinePerHour: number;
  /** Absolute deviation from baseline (1.0). Used as a sort key. */
  readonly cost: number;
  /** True when the target was unreachable within 0.5..1.0 range. */
  readonly capped: boolean;
}

const LOWER = 0.5;
const UPPER = 1.0;
const ITERATIONS = 14; // 2^-14 ≈ 6e-5 — plenty.

export function findCycleMultiplierForTarget(opts: GoalOpts): GoalResult {
  const runWithMultiplier = (m: number): number => {
    const base = opts.buildBaseOptions();
    const scaled = opts.stationCycleDistributions.map((d) => scaleDistribution(d, m));
    const r = runChain({
      ...base,
      ...(base.topology
        ? {
            topology: {
              ...base.topology,
              nodes: base.topology.nodes.map((n, i) => ({
                ...n,
                cycleTime: scaled[i] ?? n.cycleTime,
              })),
            },
          }
        : {
            stationCycleTimes: scaled,
          }),
      horizonMs: opts.horizonMs,
      warmupMs: opts.warmupMs,
      prng: new SeededPrng(opts.seed),
    });
    return r.throughputLambda * 3_600_000;
  };

  const baselinePerHour = runWithMultiplier(1.0);
  if (baselinePerHour >= opts.targetPerHour) {
    return {
      multiplier: 1.0,
      achievedPerHour: baselinePerHour,
      baselinePerHour,
      cost: 0,
      capped: false,
    };
  }

  const fastestPerHour = runWithMultiplier(LOWER);
  if (fastestPerHour < opts.targetPerHour) {
    return {
      multiplier: LOWER,
      achievedPerHour: fastestPerHour,
      baselinePerHour,
      cost: Math.abs(1 - LOWER),
      capped: true,
    };
  }

  // Binary search: smaller multiplier = faster = more throughput.
  let lo = LOWER;
  let hi = UPPER;
  let bestMultiplier = LOWER;
  let bestPerHour = fastestPerHour;
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const perHour = runWithMultiplier(mid);
    if (perHour >= opts.targetPerHour) {
      // mid is feasible — try slower (larger m).
      bestMultiplier = mid;
      bestPerHour = perHour;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    multiplier: bestMultiplier,
    achievedPerHour: bestPerHour,
    baselinePerHour,
    cost: Math.abs(1 - bestMultiplier),
    capped: false,
  };
}
