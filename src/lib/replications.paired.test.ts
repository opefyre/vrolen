/**
 * VROL-850 — paired-vs-Welch flip + p-value sanity tests.
 *
 * Anchors:
 *   - `seedsMatch` is the gate that picks paired by default; verify edge cases.
 *   - Paired t-test on a known shift: D_i = c → t blows up to ∞ when σ → 0;
 *     for a small SD we should see a clearly significant result.
 *   - Welch: with very different means but unequal sample sizes the two-sided
 *     p-value should drop below 0.05.
 *   - For an identical-distribution comparison both tests should report p ~ 1.
 */

import { describe, expect, it } from "vitest";

import { pairedTConfidence, welchTConfidence } from "./comparison-stats";
import { seedsMatch, summarizeReplications } from "./replications";

import type { ChainResult } from "@/engine";

function fakeRep(throughputPerHr: number, completed = 1000): ChainResult {
  // Only fields the summarizer touches matter; everything else is stub.
  return {
    completed,
    elapsedMs: 60_000,
    averageWipL: 5,
    throughputLambda: throughputPerHr / 3_600_000,
    avgTimeInSystemW: 500,
    perStationCompleted: [],
    perStationScrapped: [],
    perStationReworked: [],
    lineScrapRate: 0,
    lineReworkRate: 0,
    bottlenecks: [],
    perStationOee: [],
    lineOee: 0.7,
    bottleneckStationIdx: 0,
    aggregateBufferWipL: 0,
    perEdgeFlowed: [],
  } as unknown as ChainResult;
}

describe("seedsMatch (VROL-850)", () => {
  it("returns true when both seed lists are identical", () => {
    expect(seedsMatch([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("returns false when lengths differ", () => {
    expect(seedsMatch([1, 2, 3], [1, 2])).toBe(false);
  });

  it("returns false when any element differs", () => {
    expect(seedsMatch([1, 2, 3], [1, 9, 3])).toBe(false);
  });

  it("returns false for undefined or empty seed lists", () => {
    expect(seedsMatch(undefined, [1, 2, 3])).toBe(false);
    expect(seedsMatch([], [])).toBe(false);
  });
});

describe("summarizeReplications carries seeds (VROL-850)", () => {
  it("propagates the seeds array verbatim and falls back to indices when omitted", () => {
    const reps = [fakeRep(1000), fakeRep(1100), fakeRep(900)];
    const withSeeds = summarizeReplications(reps, [42, 59, 76]);
    expect(withSeeds.seeds).toEqual([42, 59, 76]);
    const withoutSeeds = summarizeReplications(reps);
    expect(withoutSeeds.seeds).toEqual([0, 1, 2]);
  });
});

describe("pairedTConfidence — VROL-850 p-value sanity", () => {
  it("reports a tiny p-value for a clearly significant positive shift", () => {
    // Every difference = +5 with mild noise; n=10. Should be hugely significant.
    const a = [100, 102, 98, 101, 99, 103, 97, 100, 102, 98];
    const b = a.map((v, i) => v + 5 + (i % 2 === 0 ? 0.1 : -0.1));
    const r = pairedTConfidence(a, b);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.test).toBe("paired");
    expect(r.meanDelta).toBeCloseTo(5, 1);
    expect(r.significant).toBe(true);
    expect(r.pValue).toBeLessThan(0.01);
  });

  it("reports a large p-value when the two samples are statistically indistinguishable", () => {
    const a = [100, 102, 98, 101, 99, 103, 97, 100, 102, 98];
    const b = [...a]; // perfect overlap — zero diffs, undefined t → p = 1 by convention
    const r = pairedTConfidence(a, b);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.significant).toBe(false);
    expect(r.pValue).toBeGreaterThan(0.5);
  });
});

describe("welchTConfidence — VROL-850 independent samples", () => {
  it("flips to 'welch' as the test and reports a tiny p-value for a big mean shift", () => {
    const a = [100, 102, 98, 101, 99, 103, 97, 100, 102, 98];
    const b = [120, 122, 118, 121, 119, 123, 117, 120, 122, 118];
    const r = welchTConfidence(a, b);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.test).toBe("welch");
    expect(r.meanDelta).toBeGreaterThan(15);
    expect(r.significant).toBe(true);
    expect(r.pValue).toBeLessThan(0.001);
  });

  it("reports a large p-value when the two independent samples overlap heavily", () => {
    const a = [100, 102, 98, 101, 99, 103, 97, 100, 102, 98];
    const b = [101, 99, 100, 102, 98, 100, 101, 99, 100, 102];
    const r = welchTConfidence(a, b);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.significant).toBe(false);
    expect(r.pValue).toBeGreaterThan(0.05);
  });

  it("returns null for n<2 on either side", () => {
    expect(welchTConfidence([1], [1, 2, 3])).toBeNull();
    expect(welchTConfidence([1, 2, 3], [1])).toBeNull();
  });
});
