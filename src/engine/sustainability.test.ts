/**
 * VROL-1014 — per-station sustainability arrays on ChainResult.
 *
 * Verifies that perStationEnergyJ / perStationWaterL / perStationCO2eG
 * are populated and that their sum equals the existing line totals
 * (modulo floating-point noise).
 */
import { describe, expect, it } from "vitest";

import { runChain, type ChainOptions, type ChainTopology } from "./chain-harness";
import { constant } from "./distribution";
import { SeededPrng } from "./prng";

function buildOpts(): ChainOptions {
  const topology: ChainTopology = {
    nodes: [
      { id: "src", cycleTimeMs: constant(100), energyPerCycleJ: 10, waterPerCycleL: 0.1 },
      { id: "mid", cycleTimeMs: constant(200), energyPerCycleJ: 50, co2ePerCycleG: 5 },
      { id: "sink", cycleTimeMs: constant(100) },
    ],
    edges: [
      { source: "src", target: "mid" },
      { source: "mid", target: "sink" },
    ],
  };
  return {
    topology,
    interStationBufferCapacity: 10,
    horizonMs: 60_000,
    warmupMs: 5_000,
    prng: new SeededPrng(0x5057),
  };
}

describe("per-station sustainability arrays (VROL-1014)", () => {
  it("perStationEnergyJ sums to totalEnergyJ", () => {
    const r = runChain(buildOpts());
    const sum = r.perStationEnergyJ.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(r.totalEnergyJ, 6);
  });

  it("perStationWaterL sums to totalWaterL", () => {
    const r = runChain(buildOpts());
    const sum = r.perStationWaterL.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(r.totalWaterL, 6);
  });

  it("perStationCO2eG sums to totalCO2eG", () => {
    const r = runChain(buildOpts());
    const sum = r.perStationCO2eG.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(r.totalCO2eG, 6);
  });

  it("stations without inputs contribute 0 to their per-station entries", () => {
    const r = runChain(buildOpts());
    // sink declared nothing.
    expect(r.perStationEnergyJ[2]).toBe(0);
    expect(r.perStationWaterL[2]).toBe(0);
    expect(r.perStationCO2eG[2]).toBe(0);
    // src declared energy + water but no CO2e.
    expect(r.perStationEnergyJ[0]).toBeGreaterThan(0);
    expect(r.perStationCO2eG[0]).toBe(0);
  });

  it("VROL-1018 — sampler emits per-tick perStationEnergyJ etc.", () => {
    const r = runChain({ ...buildOpts(), sampler: { intervalMs: 5_000 } });
    expect(r.samples.length).toBeGreaterThan(1);
    // Every sample carries the new arrays (aligned with stations).
    for (const s of r.samples) {
      expect(s.perStationEnergyJ.length).toBe(3);
      expect(s.perStationWaterL.length).toBe(3);
      expect(s.perStationCO2eG.length).toBe(3);
    }
    // Cumulative — last sample's per-station values match the final
    // result.perStation* arrays (modulo trailing in-flight cycles).
    const last = r.samples[r.samples.length - 1];
    expect(last).toBeDefined();
    expect(last?.perStationEnergyJ[0]).toBeCloseTo(r.perStationEnergyJ[0] ?? 0, 6);
    expect(last?.perStationWaterL[0]).toBeCloseTo(r.perStationWaterL[0] ?? 0, 6);
    expect(last?.perStationCO2eG[1]).toBeCloseTo(r.perStationCO2eG[1] ?? 0, 6);
    // Monotonic: consecutive samples never go down (cumulative).
    for (let i = 1; i < r.samples.length; i++) {
      const prev = r.samples[i - 1]?.perStationEnergyJ[1] ?? 0;
      const cur = r.samples[i]?.perStationEnergyJ[1] ?? 0;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });
});
