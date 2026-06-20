/**
 * Throughput-vs-WIP curve — a textbook factory-physics scan.
 *
 * Sweep inter-station buffer capacity across a range, re-run the engine
 * at each level, and plot throughput. The curve rises, then flattens —
 * the "knee" is the optimal WIP. Past the knee, adding WIP only inflates
 * time-in-system without earning more throughput (Little's Law).
 *
 * Why this matters: Banks et al., Hopp + Spearman "Factory Physics".
 * Most operations leaders inflate WIP "just in case" and burn working
 * capital. This curve makes the tradeoff visible in one chart.
 */

import { runChain, SeededPrng, type ChainOptions } from "@/engine";

export interface WipCurvePoint {
  readonly bufferCapacity: number;
  readonly throughputPerHour: number;
  readonly avgTimeInSystemMs: number;
  readonly completed: number;
}

export interface WipCurveSummary {
  readonly points: readonly WipCurvePoint[];
  readonly bestPoint: WipCurvePoint;
  readonly kneePoint: WipCurvePoint;
  readonly currentCapacity: number;
  readonly elapsedMs: number;
}

const DEFAULT_LEVELS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128];

interface RunWipCurveOpts {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly currentCapacity: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly levels?: readonly number[];
}

/**
 * Find the knee of the curve — the smallest WIP at which throughput
 * reaches ≥95% of the maximum observed throughput. Past this point,
 * adding WIP buys only marginal gain.
 */
function findKnee(points: readonly WipCurvePoint[]): WipCurvePoint {
  if (points.length === 0) {
    return {
      bufferCapacity: 0,
      throughputPerHour: 0,
      avgTimeInSystemMs: 0,
      completed: 0,
    };
  }
  const maxTput = points.reduce((m, p) => Math.max(m, p.throughputPerHour), 0);
  for (const p of points) {
    if (p.throughputPerHour >= maxTput * 0.95) return p;
  }
  return points[points.length - 1]!;
}

export function runWipCurve(opts: RunWipCurveOpts): WipCurveSummary {
  const t0 = performance.now();
  const levels = opts.levels ?? DEFAULT_LEVELS;
  const points: WipCurvePoint[] = [];
  for (const capacity of levels) {
    const base = opts.buildBaseOptions();
    const r = runChain({
      ...base,
      interStationBufferCapacity: capacity,
      horizonMs: opts.horizonMs,
      warmupMs: opts.warmupMs,
      prng: new SeededPrng(opts.seed),
    });
    points.push({
      bufferCapacity: capacity,
      throughputPerHour: r.throughputLambda * 3_600_000,
      avgTimeInSystemMs: r.avgTimeInSystemW,
      completed: r.completed,
    });
  }
  const sorted = [...points].sort((a, b) => b.throughputPerHour - a.throughputPerHour);
  const bestPoint = sorted[0]!;
  const kneePoint = findKnee(points);
  return {
    points,
    bestPoint,
    kneePoint,
    currentCapacity: opts.currentCapacity,
    elapsedMs: performance.now() - t0,
  };
}
