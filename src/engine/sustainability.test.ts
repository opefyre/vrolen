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
});
