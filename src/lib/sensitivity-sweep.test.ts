/**
 * VROL-1040 — runSensitivitySweep covers station parallel-capacity.
 * Build a tiny line where the first station is the bottleneck with
 * capacity=1, run the sweep, and assert a stationCapacity row is
 * emitted with non-zero swing (capacity=2 has to lift throughput
 * relative to capacity=1).
 */
import { describe, expect, it } from "vitest";

import { type ChainOptions, type ChainTopology, constant } from "@/engine";

import { runSensitivitySweep } from "./sensitivity-sweep";

// 3-station fixture: src (fast) → mid (slow, capacity-constrained) →
// sink (fast). Mid is the bottleneck; doubling its capacity should
// roughly double throughput.
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

describe("runSensitivitySweep — station capacity (VROL-1040)", () => {
  it("emits a stationCapacity row with non-zero swing for a capacity-1 mid-chain bottleneck", () => {
    const summary = runSensitivitySweep({
      buildBaseOptions: () =>
        ({
          topology: topology(),
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(50), constant(200), constant(50)],
      stationLabels: ["Src", "Mid", "Sink"],
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    const capRows = summary.constraintRows.filter((r) => r.kind === "stationCapacity");
    expect(capRows.length).toBeGreaterThan(0);
    const mid = capRows.find((r) => r.label.startsWith("Mid"));
    expect(mid).toBeDefined();
    // Capacity 2 should roughly double throughput vs capacity 1.
    expect(mid!.swingPerHour).toBeGreaterThan(0);
  });

  it("skips stations without a declared capacity field", () => {
    const noCap: ChainTopology = {
      nodes: [
        { id: "src", label: "Src", cycleTimeMs: constant(50) },
        { id: "mid", label: "Mid", cycleTimeMs: constant(200) },
        { id: "sink", label: "Sink", cycleTimeMs: constant(50) },
      ],
      edges: [
        { source: "src", target: "mid" },
        { source: "mid", target: "sink" },
      ],
    };
    const summary = runSensitivitySweep({
      buildBaseOptions: () =>
        ({
          topology: noCap,
          interStationBufferCapacity: 10,
        }) as unknown as ChainOptions,
      stationCycleDistributions: [constant(50), constant(200), constant(50)],
      stationLabels: ["Src", "Mid", "Sink"],
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    const capRows = summary.constraintRows.filter((r) => r.kind === "stationCapacity");
    expect(capRows.length).toBe(0);
  });
});
