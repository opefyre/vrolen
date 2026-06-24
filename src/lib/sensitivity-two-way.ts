/**
 * VROL-984 — pairwise (two-way) sensitivity sweep on the top-K stations
 * surfaced by the one-at-a-time tornado.
 *
 * Why: a tornado plot tells you which lever moves throughput the most
 * IN ISOLATION. It does NOT tell you that speeding up Filler PLUS
 * growing the buffer after it has 1.6× the lift of either alone.
 * Pairwise sensitivity catches that interaction.
 *
 * Search shape (deliberately small to stay runnable):
 *   - Pick top K = min(3, stations) by OAT swing magnitude.
 *   - For each unordered pair (i, j), sweep 3×3 cells over
 *     cycle-multiplier ∈ {0.8, 1.0, 1.2}.
 *   - Score interaction = |best-corner-throughput − (OAT_i + OAT_j)|.
 *
 * Total runs cap: K_pairs × 9 cells × 1 seed = 27 for K=3. Pure data;
 * caller renders.
 */

import { runChain, SeededPrng, type ChainOptions, type Distribution } from "@/engine";
import { scaleDistribution } from "./scale-distribution";
import type { SensitivityRow } from "./sensitivity-sweep";

interface TwoWayOpts {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly stationCycleDistributions: readonly Distribution[];
  readonly stationLabels: readonly string[];
  /** Output of a prior runSensitivitySweep. Used to pick top dimensions. */
  readonly oneWayRows: readonly SensitivityRow[];
}

export interface InteractionPair {
  readonly aIdx: number;
  readonly aLabel: string;
  readonly bIdx: number;
  readonly bLabel: string;
  readonly baselinePerHour: number;
  readonly bestCornerPerHour: number;
  readonly bestCornerMultipliers: readonly [number, number];
  /** Sum of one-way swings (positive = both speed-ups helped individually). */
  readonly oatSumLift: number;
  /** Actual combined lift at the best corner − OAT-sum. Higher = more interaction. */
  readonly interactionStrength: number;
}

export interface TwoWaySummary {
  readonly baselinePerHour: number;
  readonly pairs: readonly InteractionPair[];
  readonly searchSize: number;
  readonly elapsedMs: number;
}

const MULTIPLIERS: readonly number[] = [0.8, 1.0, 1.2];
const MAX_K = 3;

export function runTwoWaySensitivity(opts: TwoWayOpts): TwoWaySummary {
  const t0 = performance.now();
  // Pick top-K dimensions by absolute swing in the OAT result.
  const ranked = [...opts.oneWayRows].sort((a, b) => b.swingPerHour - a.swingPerHour);
  const topK = ranked.slice(0, MAX_K);
  const baseline = runChain({
    ...opts.buildBaseOptions(),
    horizonMs: opts.horizonMs,
    warmupMs: opts.warmupMs,
    prng: new SeededPrng(opts.seed),
  });
  const baselinePerHour = baseline.throughputLambda * 3_600_000;

  const runPair = (a: number, b: number, ma: number, mb: number): number => {
    const arr = [...opts.stationCycleDistributions];
    const distA = arr[a];
    const distB = arr[b];
    if (!distA || !distB) return baselinePerHour;
    arr[a] = scaleDistribution(distA, ma);
    arr[b] = scaleDistribution(distB, mb);
    const base = opts.buildBaseOptions();
    const r = runChain({
      ...base,
      ...(base.topology
        ? {
            topology: {
              ...base.topology,
              nodes: base.topology.nodes.map((n, idx) =>
                idx === a
                  ? { ...n, cycleTime: arr[a]! }
                  : idx === b
                    ? { ...n, cycleTime: arr[b]! }
                    : n,
              ),
            },
          }
        : { stationCycleTimes: arr }),
      horizonMs: opts.horizonMs,
      warmupMs: opts.warmupMs,
      prng: new SeededPrng(opts.seed),
    });
    return r.throughputLambda * 3_600_000;
  };

  const pairs: InteractionPair[] = [];
  for (let i = 0; i < topK.length; i++) {
    for (let j = i + 1; j < topK.length; j++) {
      const a = topK[i]!;
      const b = topK[j]!;
      let bestCorner = -Infinity;
      let bestM: [number, number] = [1, 1];
      for (const ma of MULTIPLIERS) {
        for (const mb of MULTIPLIERS) {
          const p = runPair(a.stationIdx, b.stationIdx, ma, mb);
          if (p > bestCorner) {
            bestCorner = p;
            bestM = [ma, mb];
          }
        }
      }
      // OAT-sum lift = (best OAT at a) + (best OAT at b) − baseline.
      const oatA = Math.max(a.lowPerHour, a.highPerHour);
      const oatB = Math.max(b.lowPerHour, b.highPerHour);
      const oatSumLift = oatA - baselinePerHour + (oatB - baselinePerHour);
      const combinedLift = bestCorner - baselinePerHour;
      const interactionStrength = combinedLift - oatSumLift;
      pairs.push({
        aIdx: a.stationIdx,
        aLabel: a.stationLabel,
        bIdx: b.stationIdx,
        bLabel: b.stationLabel,
        baselinePerHour,
        bestCornerPerHour: bestCorner,
        bestCornerMultipliers: bestM,
        oatSumLift,
        interactionStrength,
      });
    }
  }
  pairs.sort((p, q) => q.interactionStrength - p.interactionStrength);
  const searchSize = pairs.length * MULTIPLIERS.length * MULTIPLIERS.length;
  return {
    baselinePerHour,
    pairs,
    searchSize,
    elapsedMs: performance.now() - t0,
  };
}
