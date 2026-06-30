/**
 * VROL-1060 — CI-aware pickBest. Unit-tests the picker shapes
 * directly so we don't need to drive the OptimizationCard's Radix
 * Select.
 */
import { describe, expect, it } from "vitest";

import type { OptimizationCandidate, Stats } from "./optimization-search";
import { pickBest, type PickerObjective } from "./opt-pick-best";

function stats(mean: number, halfWidth95: number): Stats {
  return {
    mean,
    stddev: halfWidth95 / 1.96,
    halfWidth95,
    low95: mean - halfWidth95,
    high95: mean + halfWidth95,
  };
}

function candidate(over: Partial<OptimizationCandidate>): OptimizationCandidate {
  return {
    bufferCapacity: 0,
    cycleMultiplier: 1,
    toolPoolDelta: 0,
    targetStationIdx: 0,
    meanThroughputPerHour: 0,
    meanCompleted: 0,
    meanTimeInSystemMs: 0,
    meanScrapRate: 0,
    meanLineOee: 0,
    meanAvgWipL: 0,
    meanGoodPartsPerHour: 0,
    replications: 3,
    meanTotalEnergyJ: 0,
    meanEnergyIntensityJPerPart: 0,
    throughputStats: stats(0, 0),
    timeInSystemStats: stats(0, 0),
    oeeStats: stats(0, 0),
    wipStats: stats(0, 0),
    goodPartsStats: stats(0, 0),
    energyIntensityStats: stats(0, 0),
    ...over,
  };
}

const tputMax: PickerObjective = {
  direction: "max",
  extract: (c) => c.meanThroughputPerHour,
  stats: (c) => c.throughputStats,
};

const wipMin: PickerObjective = {
  direction: "min",
  extract: (c) => c.meanAvgWipL,
  stats: (c) => c.wipStats,
};

const tisMin: PickerObjective = {
  direction: "min",
  extract: (c) => c.meanTimeInSystemMs,
  stats: (c) => c.timeInSystemStats,
};

describe("pickBest (VROL-1060)", () => {
  it("max-direction: prefers higher LOWER bound on overlapping CIs", () => {
    // A: mean 1000 ± 200 → CI [800, 1200]
    // B: mean 1100 ± 400 → CI [700, 1500]
    // B has higher mean, but A's lower bound (800) > B's (700).
    const A = candidate({
      meanThroughputPerHour: 1_000,
      throughputStats: stats(1_000, 200),
    });
    const B = candidate({
      meanThroughputPerHour: 1_100,
      throughputStats: stats(1_100, 400),
    });
    const result = pickBest([A, B], tputMax, new Set([A, B]));
    expect(result.winner).toBe(A);
    expect(result.fromFeasible).toBe(true);
  });

  it("max-direction: falls back to mean when CIs don't overlap", () => {
    const A = candidate({
      meanThroughputPerHour: 1_000,
      throughputStats: stats(1_000, 50),
    });
    const B = candidate({
      meanThroughputPerHour: 1_200,
      throughputStats: stats(1_200, 50),
    });
    const result = pickBest([A, B], tputMax, new Set([A, B]));
    expect(result.winner).toBe(B);
  });

  it("min-direction (WIP): prefers LOWER UPPER bound on overlapping CIs", () => {
    // A: mean 4.0 ± 0.8 → CI [3.2, 4.8]
    // B: mean 3.6 ± 1.5 → CI [2.1, 5.1]
    // B has lower mean, but A's upper bound (4.8) < B's (5.1).
    const A = candidate({ meanAvgWipL: 4.0, wipStats: stats(4.0, 0.8) });
    const B = candidate({ meanAvgWipL: 3.6, wipStats: stats(3.6, 1.5) });
    const result = pickBest([A, B], wipMin, new Set([A, B]));
    expect(result.winner).toBe(A);
  });

  it("min-direction (TIS): falls back to mean when CIs don't overlap", () => {
    // A: mean 5_000 ± 100 → CI [4_900, 5_100]
    // B: mean 4_000 ± 100 → CI [3_900, 4_100]
    // Non-overlapping → B (lower mean) wins by mean.
    const A = candidate({
      meanTimeInSystemMs: 5_000,
      timeInSystemStats: stats(5_000, 100),
    });
    const B = candidate({
      meanTimeInSystemMs: 4_000,
      timeInSystemStats: stats(4_000, 100),
    });
    const result = pickBest([A, B], tisMin, new Set([A, B]));
    expect(result.winner).toBe(B);
  });

  it("halfWidth=0 (single rep): falls back to mean only — no CI to tiebreak on", () => {
    const A = candidate({
      meanThroughputPerHour: 1_000,
      throughputStats: stats(1_000, 0),
    });
    const B = candidate({
      meanThroughputPerHour: 900,
      throughputStats: stats(900, 0),
    });
    const result = pickBest([A, B], tputMax, new Set([A, B]));
    expect(result.winner).toBe(A);
  });

  it("falls back to the full set when nothing is feasible (and marks fromFeasible=false)", () => {
    const A = candidate({
      meanThroughputPerHour: 1_000,
      throughputStats: stats(1_000, 50),
    });
    const B = candidate({
      meanThroughputPerHour: 1_200,
      throughputStats: stats(1_200, 50),
    });
    const result = pickBest([A, B], tputMax, new Set());
    expect(result.winner).toBe(B);
    expect(result.fromFeasible).toBe(false);
  });

  it("respects feasibility — excludes infeasible candidates from the pick", () => {
    const A = candidate({
      meanThroughputPerHour: 1_000,
      throughputStats: stats(1_000, 50),
    });
    const B = candidate({
      meanThroughputPerHour: 1_200,
      throughputStats: stats(1_200, 50),
    });
    // Only A is feasible.
    const result = pickBest([A, B], tputMax, new Set([A]));
    expect(result.winner).toBe(A);
    expect(result.fromFeasible).toBe(true);
  });

  it("max-direction: tiebreak walk stops once a candidate's CI is statistically clear below the leader", () => {
    // Three candidates ordered by mean: B (1100), A (1000), C (800).
    // A vs B overlap; A wins the tiebreak (low=800 > B.low=700).
    // C is non-overlapping with A (high=850 < A.low=800).
    // The walk should stop and not consider C even though C exists.
    const A = candidate({
      bufferCapacity: 2,
      meanThroughputPerHour: 1_000,
      throughputStats: stats(1_000, 200), // CI [800, 1200]
    });
    const B = candidate({
      bufferCapacity: 4,
      meanThroughputPerHour: 1_100,
      throughputStats: stats(1_100, 400), // CI [700, 1500]
    });
    const C = candidate({
      bufferCapacity: 6,
      meanThroughputPerHour: 800,
      throughputStats: stats(800, 50), // CI [750, 850]
    });
    const result = pickBest([A, B, C], tputMax, new Set([A, B, C]));
    expect(result.winner).toBe(A);
  });
});
