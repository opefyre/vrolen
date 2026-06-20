import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { cycleStats } from "./cycle-stats";

function makeResult(ideal: number[]): ChainResult {
  return {
    perStationOee: ideal.map((m) => ({
      idealCycleTimeMs: m,
      availability: 1,
      performance: 1,
      quality: 1,
      oee: 1,
      runTimeMs: 0,
      downTimeMs: 0,
      goodParts: 0,
      totalParts: 0,
    })),
  } as unknown as ChainResult;
}

describe("cycleStats", () => {
  it("returns zeros when no cycles", () => {
    expect(cycleStats(makeResult([]))).toEqual({ meanMs: 0, medianMs: 0, minMs: 0, maxMs: 0 });
  });

  it("computes mean / median / min / max", () => {
    const s = cycleStats(makeResult([100, 200, 300]));
    expect(s.meanMs).toBe(200);
    expect(s.medianMs).toBe(200);
    expect(s.minMs).toBe(100);
    expect(s.maxMs).toBe(300);
  });

  it("averages the two middle values for even length", () => {
    expect(cycleStats(makeResult([10, 20, 30, 40])).medianMs).toBe(25);
  });

  it("filters zero-cycle stations", () => {
    const s = cycleStats(makeResult([0, 100, 200]));
    expect(s.meanMs).toBe(150);
    expect(s.minMs).toBe(100);
  });
});
