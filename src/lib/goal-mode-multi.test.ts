/**
 * VROL-1044 — runMultiLeverGoal covers the capacity dim.
 * Build a 3-station line with a capacity-1 mid bottleneck and assert
 * a non-zero-capacityDelta candidate beats the cap-0 baseline on
 * throughput.
 */
import { describe, expect, it } from "vitest";

import { type ChainOptions, type ChainTopology, constant } from "@/engine";

import { runMultiLeverGoal } from "./goal-mode-multi";

function topology(): ChainTopology {
  return {
    nodes: [
      { id: "src", label: "Src", cycleTimeMs: constant(50) },
      { id: "mid", label: "Mid", cycleTimeMs: constant(200), capacity: 1 },
      { id: "sink", label: "Sink", cycleTimeMs: constant(50) },
    ],
    edges: [
      { source: "src", target: "mid" },
      { source: "mid", target: "sink" },
    ],
  };
}

describe("runMultiLeverGoal — capacity dim (VROL-1044)", () => {
  it("emits candidates with both capacityDelta=0 and capacityDelta=1", () => {
    const summary = runMultiLeverGoal({
      buildBaseOptions: () =>
        ({
          topology: topology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(50), constant(200), constant(50)],
      targetPerHour: 10_000,
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    const deltas = new Set(summary.candidates.map((c) => c.capacityDelta));
    expect(deltas.has(0)).toBe(true);
    expect(deltas.has(1)).toBe(true);
  });

  it("capacityDelta=1 candidates throughput >= capacityDelta=0 (same cycle/buffer/tool)", () => {
    const summary = runMultiLeverGoal({
      buildBaseOptions: () =>
        ({
          topology: topology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(50), constant(200), constant(50)],
      targetPerHour: 10_000,
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    // Compare cap=0 vs cap=1 at cycle=1.0, buffer=0, tool=0.
    const cap0 = summary.candidates.find(
      (c) =>
        c.cycleMultiplier === 1.0 &&
        c.bufferDelta === 0 &&
        c.toolPoolDelta === 0 &&
        c.capacityDelta === 0,
    );
    const cap1 = summary.candidates.find(
      (c) =>
        c.cycleMultiplier === 1.0 &&
        c.bufferDelta === 0 &&
        c.toolPoolDelta === 0 &&
        c.capacityDelta === 1,
    );
    expect(cap0).toBeDefined();
    expect(cap1).toBeDefined();
    // capacity +1 on a saturated mid bottleneck should lift throughput.
    expect(cap1!.perHour).toBeGreaterThan(cap0!.perHour);
  });
});

// VROL-1056 — energy budget constraint. Build a small 2-station line
// with declared energy so candidates carry non-zero intensity, then
// verify the budget gates the winner pick.
function susTopology(): ChainTopology {
  return {
    nodes: [
      { id: "src", label: "Src", cycleTimeMs: constant(100), energyPerCycleJ: 200 },
      { id: "sink", label: "Sink", cycleTimeMs: constant(100), energyPerCycleJ: 50 },
    ],
    edges: [{ source: "src", target: "sink" }],
  };
}

describe("runMultiLeverGoal — energy budget (VROL-1056)", () => {
  it("populates meanEnergyIntensityJPerPart on every candidate", () => {
    const summary = runMultiLeverGoal({
      buildBaseOptions: () =>
        ({
          topology: susTopology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(100), constant(100)],
      targetPerHour: 30_000,
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    // 200 + 50 = 250 J / part baseline. Partial-cycle truncation at
    // horizon-end may nudge it; tolerate ±10 %.
    const c = summary.candidates[0]!;
    expect(c.meanEnergyIntensityJPerPart).toBeGreaterThan(225);
    expect(c.meanEnergyIntensityJPerPart).toBeLessThan(275);
  });

  it("meetsEnergyBudget=true for every candidate when no budget is supplied", () => {
    const summary = runMultiLeverGoal({
      buildBaseOptions: () =>
        ({
          topology: susTopology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(100), constant(100)],
      targetPerHour: 30_000,
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    expect(summary.candidates.every((c) => c.meetsEnergyBudget)).toBe(true);
  });

  it("violating candidates flagged when budget is tighter than baseline intensity", () => {
    const summary = runMultiLeverGoal({
      buildBaseOptions: () =>
        ({
          topology: susTopology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(100), constant(100)],
      targetPerHour: 30_000,
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
      maxEnergyIntensityJPerPart: 100, // tighter than the ~250 J/part baseline.
    });
    expect(summary.candidates.some((c) => !c.meetsEnergyBudget)).toBe(true);
  });

  it("picks the lowest-cost candidate that meets both throughput AND budget when one exists", () => {
    const summary = runMultiLeverGoal({
      buildBaseOptions: () =>
        ({
          topology: susTopology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(100), constant(100)],
      targetPerHour: 30_000,
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
      maxEnergyIntensityJPerPart: 500, // loose enough that every candidate meets.
    });
    expect(summary.best).not.toBeNull();
    expect(summary.best!.meetsTarget).toBe(true);
    expect(summary.best!.meetsEnergyBudget).toBe(true);
  });
});
