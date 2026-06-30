/**
 * VROL-1036 — runOptimizationSearch reports per-candidate energy
 * cost. Builds a tiny 2-station topology, runs the search with a
 * single grid cell + 1 replication, and asserts that
 * meanTotalEnergyJ + meanEnergyIntensityJPerPart round-trip from
 * ChainResult.
 */
import { describe, expect, it } from "vitest";

import { type ChainOptions, type ChainTopology, constant, SeededPrng } from "@/engine";

import { runOptimizationSearch } from "./optimization-search";

function susTopology(): ChainTopology {
  return {
    nodes: [
      { id: "src", cycleTimeMs: constant(100), energyPerCycleJ: 200 },
      { id: "sink", cycleTimeMs: constant(100), energyPerCycleJ: 50 },
    ],
    edges: [{ source: "src", target: "sink" }],
  };
}

function plainTopology(): ChainTopology {
  return {
    nodes: [
      { id: "src", cycleTimeMs: constant(100) },
      { id: "sink", cycleTimeMs: constant(100) },
    ],
    edges: [{ source: "src", target: "sink" }],
  };
}

function buildBaseFactory(topo: ChainTopology): (mult: number) => ChainOptions {
  return () => ({
    topology: topo,
    interStationBufferCapacity: 10,
    horizonMs: 10_000,
    warmupMs: 0,
    prng: new SeededPrng(0x5057),
  });
}

describe("runOptimizationSearch sustainability (VROL-1036)", () => {
  it("populates meanTotalEnergyJ + meanEnergyIntensityJPerPart for each candidate", () => {
    const summary = runOptimizationSearch({
      buildBaseOptions: buildBaseFactory(susTopology()),
      bufferLevels: [10],
      cycleMultipliers: [1],
      toolPoolDeltas: [0],
      replicationsPerCandidate: 1,
      horizonMs: 10_000,
      warmupMs: 0,
      seed: 1,
      targetStationIdx: 0,
      targetStationLabel: "src",
      currentCapacity: 10,
    });
    expect(summary.candidates).toHaveLength(1);
    const c = summary.candidates[0]!;
    expect(c.meanTotalEnergyJ).toBeGreaterThan(0);
    expect(c.meanEnergyIntensityJPerPart).toBeGreaterThan(0);
    // Each part costs (200 + 50) J across both stations → 250 J/part.
    // Partial cycles at horizon-end nudge the divisor; allow ±5 J/part.
    expect(c.meanEnergyIntensityJPerPart).toBeGreaterThan(245);
    expect(c.meanEnergyIntensityJPerPart).toBeLessThan(260);
  });

  it("falls back to 0 when no station declared sustainability inputs", () => {
    const summary = runOptimizationSearch({
      buildBaseOptions: buildBaseFactory(plainTopology()),
      bufferLevels: [10],
      cycleMultipliers: [1],
      toolPoolDeltas: [0],
      replicationsPerCandidate: 1,
      horizonMs: 10_000,
      warmupMs: 0,
      seed: 1,
      targetStationIdx: 0,
      targetStationLabel: "src",
      currentCapacity: 10,
    });
    const c = summary.candidates[0]!;
    expect(c.meanTotalEnergyJ).toBe(0);
    expect(c.meanEnergyIntensityJPerPart).toBe(0);
  });
});

describe("runOptimizationSearch CIs (VROL-1059)", () => {
  it("emits stddev=0 + halfWidth=0 when reps=1 (no variance estimate)", () => {
    const summary = runOptimizationSearch({
      buildBaseOptions: buildBaseFactory(plainTopology()),
      bufferLevels: [10],
      cycleMultipliers: [1],
      toolPoolDeltas: [0],
      replicationsPerCandidate: 1,
      horizonMs: 10_000,
      warmupMs: 0,
      seed: 1,
      targetStationIdx: 0,
      targetStationLabel: "src",
      currentCapacity: 10,
    });
    const c = summary.candidates[0]!;
    expect(c.throughputStddev).toBe(0);
    expect(c.throughputHalfWidth95).toBe(0);
    expect(c.throughputLow95).toBe(c.meanThroughputPerHour);
    expect(c.throughputHigh95).toBe(c.meanThroughputPerHour);
  });

  it("emits stddev > 0 + halfWidth > 0 when reps >= 2 (stochastic distribution)", () => {
    // Use stochastic uniform cycle distribution so per-rep throughput
    // differs across seeds.
    const stochasticTopology = (): ChainTopology => ({
      nodes: [
        { id: "src", label: "Src", cycleTimeMs: { kind: "uniform", min: 50, max: 150 } },
        { id: "sink", label: "Sink", cycleTimeMs: { kind: "uniform", min: 50, max: 150 } },
      ],
      edges: [{ source: "src", target: "sink" }],
    });
    const summary = runOptimizationSearch({
      buildBaseOptions: buildBaseFactory(stochasticTopology()),
      bufferLevels: [10],
      cycleMultipliers: [1],
      toolPoolDeltas: [0],
      replicationsPerCandidate: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      seed: 1,
      targetStationIdx: 0,
      targetStationLabel: "src",
      currentCapacity: 10,
    });
    const c = summary.candidates[0]!;
    expect(c.throughputStddev).toBeGreaterThan(0);
    expect(c.throughputHalfWidth95).toBeGreaterThan(0);
    // Half-width is exactly 1.96 × σ / √n.
    const expected = (1.96 * c.throughputStddev) / Math.sqrt(5);
    expect(c.throughputHalfWidth95).toBeCloseTo(expected, 6);
    // CI brackets the mean.
    expect(c.throughputLow95).toBeLessThan(c.meanThroughputPerHour);
    expect(c.throughputHigh95).toBeGreaterThan(c.meanThroughputPerHour);
  });
});
