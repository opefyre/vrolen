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

  it("VROL-1062 — K=1 (default) → swingStats.halfWidth=0; isSignificant from mean sign", () => {
    const summary = runSensitivitySweep({
      buildBaseOptions: (): ChainOptions => ({
        topology: topology(),
        interStationBufferCapacity: 10,
        horizonMs: 30_000,
        warmupMs: 0,
        seed: 1,
      }),
      stationCycleDistributions: [constant(50), constant(200), constant(50)],
      stationLabels: ["Src", "Mid", "Sink"],
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
    });
    for (const row of summary.rows) {
      expect(row.swingStats.halfWidth95).toBe(0);
      expect(row.swingStats.low95).toBe(row.swingStats.mean);
      expect(row.swingStats.high95).toBe(row.swingStats.mean);
    }
    // K=1 isSignificant is "did the mean move at all" — the 200 ms
    // bottleneck row should clearly move.
    const midRow = summary.rows.find((r) => r.stationLabel === "Mid");
    expect(midRow?.isSignificant).toBe(true);
  });

  it("VROL-1062 — K=5 with stochastic input populates positive halfWidth95 on the bottleneck row", () => {
    const stochasticTopology = (): ChainTopology => ({
      nodes: [
        { id: "src", label: "Src", cycleTimeMs: { kind: "uniform", min: 25, max: 75 } },
        {
          id: "mid",
          label: "Mid",
          cycleTimeMs: { kind: "uniform", min: 100, max: 300 },
          capacity: 1,
        },
        { id: "sink", label: "Sink", cycleTimeMs: { kind: "uniform", min: 25, max: 75 } },
      ],
      edges: [
        { source: "src", target: "mid" },
        { source: "mid", target: "sink" },
      ],
    });
    const summary = runSensitivitySweep({
      buildBaseOptions: (): ChainOptions => ({
        topology: stochasticTopology(),
        interStationBufferCapacity: 10,
        horizonMs: 30_000,
        warmupMs: 0,
        seed: 1,
      }),
      stationCycleDistributions: [
        { kind: "uniform", min: 25, max: 75 },
        { kind: "uniform", min: 100, max: 300 },
        { kind: "uniform", min: 25, max: 75 },
      ],
      stationLabels: ["Src", "Mid", "Sink"],
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
      replicationsPerSwing: 5,
    });
    const midRow = summary.rows.find((r) => r.stationLabel === "Mid");
    expect(midRow).toBeDefined();
    // 5 paired reps of a stochastic bottleneck → real variance.
    expect(midRow!.swingStats.halfWidth95).toBeGreaterThan(0);
    // delta = high(slower) − low(faster) → CI sits entirely BELOW
    // zero on a true bottleneck (mid 200 ms vs 50 ms neighbours):
    // high cycle → fewer parts → negative delta.
    expect(midRow!.swingStats.high95).toBeLessThan(0);
    expect(midRow!.isSignificant).toBe(true);
  });

  it("VROL-1062 — non-bottleneck rows on a line with a hard bottleneck are NOT significant", () => {
    // Mid is a hard constant bottleneck (500 ms). Src + Sink cycle
    // swings barely affect throughput → CI crosses zero →
    // isSignificant=false.
    const balanced = (): ChainTopology => ({
      nodes: [
        { id: "src", label: "Src", cycleTimeMs: { kind: "uniform", min: 50, max: 150 } },
        { id: "mid", label: "Mid", cycleTimeMs: constant(500) },
        { id: "sink", label: "Sink", cycleTimeMs: { kind: "uniform", min: 50, max: 150 } },
      ],
      edges: [
        { source: "src", target: "mid" },
        { source: "mid", target: "sink" },
      ],
    });
    const summary = runSensitivitySweep({
      buildBaseOptions: (): ChainOptions => ({
        topology: balanced(),
        interStationBufferCapacity: 10,
        horizonMs: 30_000,
        warmupMs: 0,
        seed: 1,
      }),
      stationCycleDistributions: [
        { kind: "uniform", min: 50, max: 150 },
        constant(500),
        { kind: "uniform", min: 50, max: 150 },
      ],
      stationLabels: ["Src", "Mid", "Sink"],
      horizonMs: 30_000,
      warmupMs: 0,
      seed: 0x5057,
      replicationsPerSwing: 5,
    });
    const srcRow = summary.rows.find((r) => r.stationLabel === "Src");
    const sinkRow = summary.rows.find((r) => r.stationLabel === "Sink");
    expect(srcRow?.isSignificant).toBe(false);
    expect(sinkRow?.isSignificant).toBe(false);
  });
});
