/**
 * VROL-735 — small cycle-time aggregate helpers derived from ChainResult.
 * Median across stations is a useful sanity check next to the bottleneck's
 * cycle since the average can be skewed by a single very-slow station.
 */

import type { ChainResult } from "@/engine";

export interface CycleStats {
  readonly meanMs: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

export function cycleStats(result: ChainResult): CycleStats {
  const cycles = result.perStationOee.map((o) => o.idealCycleTimeMs).filter((n) => n > 0);
  if (cycles.length === 0) {
    return { meanMs: 0, medianMs: 0, minMs: 0, maxMs: 0 };
  }
  const sum = cycles.reduce((a, b) => a + b, 0);
  const sorted = [...cycles].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return {
    meanMs: sum / cycles.length,
    medianMs: median,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}
