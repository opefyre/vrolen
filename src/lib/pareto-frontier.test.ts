/**
 * VROL-842 — unit tests for the Pareto-frontier helper.
 *
 * Axes:
 *   • throughput per hour — maximize
 *   • time-in-system ms   — minimize
 *
 * Each test builds a minimal OptimizationCandidate fixture (only the two
 * axes matter for the dominance check) and verifies which candidates the
 * frontier returns.
 */

import { describe, expect, it } from "vitest";

import type { OptimizationCandidate } from "@/lib/optimization-search";
import { isOnFrontier, paretoFrontier } from "@/lib/pareto-frontier";

function makeCandidate(overrides: {
  readonly tput: number;
  readonly tis: number;
}): OptimizationCandidate {
  return {
    bufferCapacity: 0,
    cycleMultiplier: 1,
    targetStationIdx: 0,
    meanThroughputPerHour: overrides.tput,
    meanCompleted: overrides.tput,
    meanTimeInSystemMs: overrides.tis,
    meanScrapRate: 0,
    meanLineOee: 0.5,
    meanAvgWipL: 1,
    meanGoodPartsPerHour: overrides.tput,
    replications: 1,
    // VROL-1036 — default to 0 (no sustainability inputs) for the
    // pareto frontier fixture; that helper sorts on throughput / WIP,
    // not energy.
    meanTotalEnergyJ: 0,
    meanEnergyIntensityJPerPart: 0,
    toolPoolDelta: 0,
  } satisfies OptimizationCandidate;
}

describe("paretoFrontier (VROL-842)", () => {
  it("returns an empty array for an empty input", () => {
    expect(paretoFrontier([])).toEqual([]);
  });

  it("returns a single-element input unchanged", () => {
    const only = makeCandidate({ tput: 1_000, tis: 5_000 });
    expect(paretoFrontier([only])).toEqual([only]);
  });

  it("drops a candidate that is strictly worse on both axes", () => {
    const winner = makeCandidate({ tput: 1_500, tis: 4_000 });
    const loser = makeCandidate({ tput: 1_000, tis: 6_000 });
    const frontier = paretoFrontier([winner, loser]);
    expect(frontier).toEqual([winner]);
    expect(isOnFrontier(winner, frontier)).toBe(true);
    expect(isOnFrontier(loser, frontier)).toBe(false);
  });

  it("keeps both candidates when they trade off on the two axes", () => {
    const fast = makeCandidate({ tput: 1_500, tis: 8_000 });
    const lean = makeCandidate({ tput: 1_000, tis: 3_000 });
    const frontier = paretoFrontier([fast, lean]);
    expect(frontier).toHaveLength(2);
    expect(frontier).toContain(fast);
    expect(frontier).toContain(lean);
  });

  it("computes the frontier of a 3-D mixed grid (the spec's worked example)", () => {
    // Five candidates: a-b-c form the trade-off frontier (each dominates
    // none of the others); d is strictly worse than a; e ties a on TIS
    // but loses on throughput so it gets dropped too.
    const a = makeCandidate({ tput: 1_500, tis: 4_000 });
    const b = makeCandidate({ tput: 1_200, tis: 3_000 });
    const c = makeCandidate({ tput: 1_000, tis: 2_500 });
    const d = makeCandidate({ tput: 1_000, tis: 5_000 });
    const e = makeCandidate({ tput: 800, tis: 4_000 });
    const frontier = paretoFrontier([a, b, c, d, e]);
    expect(frontier).toHaveLength(3);
    expect(frontier).toContain(a);
    expect(frontier).toContain(b);
    expect(frontier).toContain(c);
    expect(frontier).not.toContain(d);
    expect(frontier).not.toContain(e);
  });

  it("treats ties correctly — duplicate candidates both survive (neither strictly dominates the other)", () => {
    const a = makeCandidate({ tput: 1_000, tis: 5_000 });
    const b = makeCandidate({ tput: 1_000, tis: 5_000 });
    const frontier = paretoFrontier([a, b]);
    // Neither dominates the other (no strict improvement on either axis),
    // so both stay on the frontier. The card then renders them on the same
    // dot — that's the right visual story for a tie.
    expect(frontier).toHaveLength(2);
  });

  it("preserves input order in the returned frontier", () => {
    const a = makeCandidate({ tput: 1_500, tis: 4_000 });
    const b = makeCandidate({ tput: 1_200, tis: 3_000 });
    const c = makeCandidate({ tput: 1_000, tis: 2_500 });
    expect(paretoFrontier([c, a, b])).toEqual([c, a, b]);
    expect(paretoFrontier([b, c, a])).toEqual([b, c, a]);
  });
});
