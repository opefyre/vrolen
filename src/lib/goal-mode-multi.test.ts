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
